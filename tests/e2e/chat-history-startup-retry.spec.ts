import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX startup chat history recovery', () => {
  test('retries an initial chat.history timeout and eventually renders history', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
        gatewayRpc: {},
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: Date.now() },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
        },
      });

      await app.evaluate(async ({ app: _app }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        let chatHistoryCallCount = 0;

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, payload: unknown) => {
          const stableStringify = (value: unknown): string => {
            if (value == null || typeof value !== 'object') return JSON.stringify(value);
            if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
            const entries = Object.entries(value as Record<string, unknown>)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
            return `{${entries.join(',')}}`;
          };

          const key = stableStringify([method, payload ?? null]);
          if (key === stableStringify(['sessions.list', {}])) {
            return {
              success: true,
              result: {
                sessions: [{ key: 'agent:main:main', displayName: 'main' }],
              },
            };
          }
          if (key === stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])) {
            chatHistoryCallCount += 1;
            if (chatHistoryCallCount === 1) {
              return {
                success: false,
                error: 'RPC timeout: chat.history',
              };
            }
            return {
              success: true,
              result: {
                messages: [
                  { role: 'user', content: 'hello', timestamp: 1000 },
                  { role: 'assistant', content: 'history restored after retry', timestamp: 1001 },
                ],
              },
            };
          }
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByText('history restored after retry')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('RPC timeout: chat.history')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
