import type { ElectronApplication } from '@playwright/test';

import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function installSlashCommandReplyMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, sessionKey) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: { message?: string };
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    let replySequence = 0;

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        const command = request.payload?.message?.trim();
        const text = command === '/status'
          ? 'OpenClaw status: connected'
          : command === '/compact'
            ? 'Compaction complete'
            : `Unexpected command: ${command ?? ''}`;
        replySequence += 1;
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey,
            generation: 1,
            notification: {
              sessionId: sessionKey,
              update: {
                sessionUpdate: 'agent_message_chunk',
                messageId: `slash-command-reply-${replySequence}`,
                content: { type: 'text', text },
              },
            },
          });
        }
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, SESSION_KEY);
}

test.describe('ClawX ACP slash-command replies', () => {
  test('shows replies for /status and /compact in the chat timeline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
            },
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
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: SESSION_KEY }],
              },
            },
          },
        },
      });
      await installSlashCommandReplyMock(app);

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      const input = page.getByTestId('chat-composer-input');

      await input.fill('/status');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('acp-assistant-message').filter({ hasText: 'OpenClaw status: connected' }))
        .toBeVisible({ timeout: 30_000 });

      await input.fill('/compact');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('acp-assistant-message').filter({ hasText: 'Compaction complete' }))
        .toBeVisible({ timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
