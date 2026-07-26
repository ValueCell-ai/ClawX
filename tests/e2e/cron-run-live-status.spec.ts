import type { ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getRecordedHostInvocations,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const CRON_BASE_KEY = 'agent:main:cron:job-cron-live';
const CRON_TRIGGER_TEXT = '[cron:job-cron-live] Summarize today important AI news';
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

const cronTriggerUpdate: AcpSessionUpdate = {
  sessionUpdate: 'user_message',
  messageId: 'cron-trigger',
  content: [{ type: 'text', text: CRON_TRIGGER_TEXT }],
};

function acpLoadMocks(sessionKey: string) {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
      success: true,
      generation: 1,
    },
    [stableStringify(['chat', 'loadAcpSession', { sessionKey, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
      success: true,
      generation: 1,
    },
  };
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  sessionKey: string,
  updates: AcpSessionUpdate[],
  historical = false,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: 1,
            ...(payload.historical ? { historical: true } : {}),
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey, updates, historical },
  );
}

test.describe('ClawX cron run live status', () => {
  test('renders ACP live status for a cron run without switching sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const cronSession = {
        key: CRON_BASE_KEY,
        displayName: 'Cron: 早报',
        label: 'Cron: 早报',
        updatedAt: Date.now(),
      };

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                cronSession,
              ],
            },
          },
        },
        hostApi: {
          ...acpLoadMocks(MAIN_SESSION_KEY),
          ...acpLoadMocks(CRON_BASE_KEY),
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main', workspace: DEFAULT_WORKSPACE, mainSessionKey: MAIN_SESSION_KEY }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      // Open the cron session (default startup lands on the main session).
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();

      // Transcript replay now arrives through ACP; the legacy execution graph stays absent.
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [cronTriggerUpdate], true);
      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [{
        sessionUpdate: 'tool_call',
        toolCallId: 'call-web-search',
        title: 'web_search',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: 'AI news June 2026' } }],
        locations: [],
      }]);

      await expect(page.getByTestId('acp-tool-call-card')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('web_search');
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [{
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-web-search',
        title: 'web_search',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'Search complete' } }],
        locations: [],
      }]);

      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows cron run summaries when ACP replay is empty', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const cronSession = {
        key: CRON_BASE_KEY,
        displayName: 'Cron: 喝水提醒',
        label: 'Cron: 喝水提醒',
        updatedAt: Date.now(),
      };

      await installIpcMocks(app, {
        recordHostInvocations: true,
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                cronSession,
              ],
            },
          },
        },
        hostApi: {
          ...acpLoadMocks(MAIN_SESSION_KEY),
          ...acpLoadMocks(CRON_BASE_KEY),
          [stableStringify(['cron', 'sessionHistory', { sessionKey: CRON_BASE_KEY, limit: 200 }])]: {
            messages: [
              { id: 'cron-prompt', role: 'user', content: '提醒我喝水', timestamp: Date.now() - 5000 },
              { id: 'cron-result', role: 'assistant', content: '该喝水了！💧', timestamp: Date.now() },
            ],
          },
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main', workspace: DEFAULT_WORKSPACE, mainSessionKey: MAIN_SESSION_KEY }] } },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();

      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'cron'
        && call.action === 'sessionHistory'
        && call.payload?.sessionKey === CRON_BASE_KEY
      ))).toBe(true);
      await expect(page.getByText('提醒我喝水')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('该喝水了！💧')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-chat-empty-state')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('adopts an already-running cron run joined mid-flight (no run.started received)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const cronSession = {
        key: CRON_BASE_KEY,
        displayName: 'Cron: 早报',
        label: 'Cron: 早报',
        updatedAt: Date.now(),
      };

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                cronSession,
              ],
            },
          },
        },
        hostApi: {
          ...acpLoadMocks(MAIN_SESSION_KEY),
          ...acpLoadMocks(CRON_BASE_KEY),
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main', workspace: DEFAULT_WORKSPACE, mainSessionKey: MAIN_SESSION_KEY }] } },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [cronTriggerUpdate], true);
      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      // Simulate joining a run already in progress: the first ACP update the
      // renderer sees is a tool card, and it still renders live in the current session.
      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [{
        sessionUpdate: 'tool_call',
        toolCallId: 'call-read-skill',
        title: 'read',
        status: 'in_progress',
        content: [{ type: 'content', content: { type: 'text', text: '~/.openclaw/skills/docx/SKILL.md' } }],
        locations: [],
      }]);

      await expect(page.getByTestId('acp-tool-call-card')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('read');
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      await emitAcpSessionUpdates(app, CRON_BASE_KEY, [{
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-read-skill',
        title: 'read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'Read complete' } }],
        locations: [],
      }]);

      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
