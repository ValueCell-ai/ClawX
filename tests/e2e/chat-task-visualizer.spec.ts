import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const PROJECT_MANAGER_SESSION_KEY = 'agent:main:main';
const PROJECT_MANAGER_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function baseHostApiMocks(loadResult: Record<string, unknown> = { success: true, generation: 1 }) {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: PROJECT_MANAGER_SESSION_KEY, workspaceRoot: PROJECT_MANAGER_WORKSPACE, cwd: PROJECT_MANAGER_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: PROJECT_MANAGER_SESSION_KEY, workspaceRoot: PROJECT_MANAGER_WORKSPACE, cwd: PROJECT_MANAGER_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: PROJECT_MANAGER_SESSION_KEY, workspaceRoot: '/', cwd: '/' }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: PROJECT_MANAGER_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: PROJECT_MANAGER_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'main',
            workspace: PROJECT_MANAGER_WORKSPACE,
            mainSessionKey: PROJECT_MANAGER_SESSION_KEY,
          }],
        },
      },
    },
  };
}

async function installAcpChatMocks(
  app: ElectronApplication,
  loadResult: Record<string, unknown> = { success: true, generation: 1 },
) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [{ key: PROJECT_MANAGER_SESSION_KEY, displayName: 'main' }],
        },
      },
    },
    hostApi: baseHostApiMocks(loadResult),
  });
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  generation = 1,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: payload.generation,
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: PROJECT_MANAGER_SESSION_KEY, generation, updates },
  );
}

async function emitAcpPermissionRequest(app: ElectronApplication, generation = 1) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('chat:acp-permission-request', {
          sessionKey: payload.sessionKey,
          generation: payload.generation,
          requestId: 'approve-edit',
          request: {
            sessionId: payload.sessionKey,
            toolCall: { toolCallId: 'edit-file', title: 'Allow edit?' },
            options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow' }],
          },
        });
      }
    },
    { sessionKey: PROJECT_MANAGER_SESSION_KEY, generation },
  );
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  return page;
}

const longRunPrompt = 'Inspect the workspace and summarize the result';
const longRunProcessSegments = Array.from({ length: 9 }, (_, index) => `Checked source ${index + 1}.`);
const longRunSummary = 'Here is the summary.';
const longRunReplyText = `${longRunProcessSegments.join(' ')} ${longRunSummary}`;

test.describe('ClawX ACP chat timeline', () => {
  test('renders inline ACP thought, tool, permission, and plan blocks from mocked IPC', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'msg-user',
          content: [{ type: 'text', text: 'Read the file and propose changes' }],
        },
        {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'assistant-run',
          content: { type: 'text', text: 'Need to inspect the current implementation first.' },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-file',
          title: 'Read file',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Loaded src/pages/Chat/index.tsx' } }],
          locations: [],
        },
      ]);
      await emitAcpPermissionRequest(app);
      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'plan',
          entries: [{ content: 'Update Chat page tests', status: 'pending' }],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'msg-assistant',
          content: [{ type: 'text', text: 'The Chat page now renders ACP timeline blocks inline.' }],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('acp-thought-block')).toContainText('Need to inspect the current implementation first.');
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read file');
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Loaded src/pages/Chat/index.tsx');
      await expect(page.getByTestId('acp-permission-card')).toContainText('Allow edit?');
      await expect(page.getByTestId('acp-plan-item')).toContainText('Update Chat page tests');
      await expect(page.getByText('The Chat page now renders ACP timeline blocks inline.')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders long ACP process history inline and keeps the final answer separate', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'long-run-user',
          content: [{ type: 'text', text: longRunPrompt }],
        },
        ...longRunProcessSegments.map((segment, index) => ({
          sessionUpdate: 'agent_message',
          messageId: `long-run-step-${index + 1}`,
          content: [{ type: 'text', text: segment }],
        })),
        {
          sessionUpdate: 'agent_message',
          messageId: 'long-run-final',
          content: [{ type: 'text', text: longRunSummary }],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByText(longRunProcessSegments[0], { exact: true })).toBeVisible();
      await expect(page.getByText(longRunProcessSegments.at(-1)!, { exact: true })).toBeVisible();
      await expect(page.getByText(longRunSummary, { exact: true })).toBeVisible();
      await expect(page.getByText(longRunReplyText, { exact: true })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('surfaces ACP load errors and does not render stale graph thinking state', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app, { success: false, error: '404 Resource not found', generation: 1 });
      const page = await openChat(app);

      const errorBanner = page.getByTestId('acp-error-banner');
      await expect(errorBanner).toBeVisible({ timeout: 30_000 });
      await expect(errorBanner).toContainText('404 Resource not found');
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-step-thinking-trailing')).toHaveCount(0);

      await page.getByRole('button', { name: 'Dismiss' }).click();
      await expect(errorBanner).toHaveCount(0);
      await expect(page.getByText('404 Resource not found')).toHaveCount(0);
      await page.getByTestId('chat-composer-input').fill('retry');
      await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });
});
