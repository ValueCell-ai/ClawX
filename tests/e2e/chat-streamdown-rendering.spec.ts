import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
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

async function emitAcpSessionUpdates(
  app: ElectronApplication,
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
    { sessionKey: SESSION_KEY, updates, historical },
  );
}

async function deferAcpPrompt(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostRequest = { id?: string; module?: string; action?: string };
    type HostInvokeHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const currentHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, HostInvokeHandler>;
    })._invokeHandlers?.get('host:invoke');
    const pending = globalThis as typeof globalThis & { resolveStreamdownPrompt?: () => void };

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return await new Promise((resolve) => {
          pending.resolveStreamdownPrompt = () => resolve({
            id: request.id,
            ok: true,
            data: { success: true, generation: 1 },
          });
        });
      }
      return currentHostInvoke?.(event, request) ?? { ok: true, data: {} };
    });
  });
}

async function resolveAcpPrompt(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const pending = globalThis as typeof globalThis & { resolveStreamdownPrompt?: () => void };
    const resolvePrompt = pending.resolveStreamdownPrompt;
    if (!resolvePrompt) throw new Error('Deferred Streamdown prompt was not pending');
    delete pending.resolveStreamdownPrompt;
    resolvePrompt();
  });
}

test.describe('ClawX streaming Markdown rendering', () => {
  test('repairs and animates only the pending assistant response, then settles without a caret', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }] },
          },
        },
        hostApi: {
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: {
            success: true,
            generation: 1,
          },
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
              json: { success: true, agents: [{ id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: SESSION_KEY }] },
            },
          },
        },
      });
      await deferAcpPrompt(app);

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message',
        messageId: 'completed-assistant',
        content: [{ type: 'text', text: 'Earlier completed answer.' }],
      }], true);
      await expect(page.getByText('Earlier completed answer.')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('Stream a Markdown response');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Stop');

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'streamdown-assistant',
        content: { type: 'text', text: 'Streaming **bold' },
      }]);

      const activeMessage = page.getByTestId('acp-assistant-message').filter({ hasText: 'Streaming' });
      const completedMessage = page.getByTestId('acp-assistant-message').filter({ hasText: 'Earlier completed answer.' });
      await expect(activeMessage.locator('strong')).toHaveText('bold', { timeout: 30_000 });
      await expect(page.locator('.clawx-streamdown[style*="--streamdown-caret"]')).toHaveCount(1);
      await expect(completedMessage.locator('[style*="--streamdown-caret"]')).toHaveCount(0);

      const firstWord = activeMessage.locator('[data-sd-animate]').filter({ hasText: /^Streaming$/ });
      await expect(firstWord).toHaveCount(1);
      await expect(firstWord).toHaveCSS('--sd-duration', '140ms');

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'streamdown-assistant',
        content: {
          type: 'text',
          text: '** words with `inlineCode()`, https://example.com。后续, [docs](https://example.org), and <script>rawAlert()</script>',
        },
      }]);
      await expect(activeMessage.locator('code').filter({ hasText: 'inlineCode()' })).toBeVisible();
      await expect(activeMessage.getByText('https://example.com', { exact: true })).toBeVisible();
      await expect(activeMessage).toContainText('。后续');
      const newWord = activeMessage.locator('[data-sd-animate]').filter({ hasText: /^words$/ });
      await expect(newWord).toHaveCount(1);
      await expect(newWord).toHaveCSS('--sd-duration', '140ms');
      await expect(firstWord).toHaveCount(1);
      await expect(firstWord).toHaveCSS('--sd-duration', '0ms');
      await expect(activeMessage.locator('a')).toHaveCount(0);
      await expect(activeMessage.getByText('docs', { exact: true })).toBeVisible();
      await expect(activeMessage).toContainText('<script>rawAlert()</script>');
      await expect(activeMessage.locator('script')).toHaveCount(0);

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'streamdown-assistant',
        content: { type: 'text', text: '\n\n```javascript\nconst answer = 42;' },
      }]);
      await expect(activeMessage).toContainText('Streaming bold words');
      const incompleteCodeBlock = activeMessage.locator('[data-streamdown="code-block"][data-incomplete="true"]');
      await expect(incompleteCodeBlock).toBeVisible();
      await expect(incompleteCodeBlock).toContainText('const answer = 42;');

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'streamdown-assistant',
        content: { type: 'text', text: '\n```' },
      }]);
      await expect(activeMessage.locator('[data-streamdown="code-block"][data-incomplete="true"]')).toHaveCount(0);
      await expect(activeMessage.locator('pre span[style*="--sdm-c"]').first()).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'streamdown-assistant',
        content: { type: 'text', text: '\n\nFinal streamed text.' },
      }]);
      await expect(activeMessage).toContainText('Final streamed text.');
      await expect(page.locator('.clawx-streamdown[style*="--streamdown-caret"]')).toHaveCount(1);

      await resolveAcpPrompt(app);
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', 'Send');
      await expect(page.locator('.clawx-streamdown[style*="--streamdown-caret"]')).toHaveCount(0);
      await expect(activeMessage.locator('[data-sd-animate]')).toHaveCount(0);
      await expect(activeMessage).toContainText('Streaming bold words');
      await expect(activeMessage).toContainText('Final streamed text.');
    } finally {
      await closeElectronApp(app);
    }
  });
});
