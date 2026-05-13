import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('chat history backpressure', () => {
  test('does not call chat.history for derived sidebar labels', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
          gatewayReady: true,
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                state: 'running',
                port: 18789,
                pid: 12345,
                connectedAt: Date.now(),
                gatewayReady: true,
              },
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

      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        (globalThis as typeof globalThis & { __chatHistoryCalls?: number }).__chatHistoryCalls = 0;

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: {
                sessions: [
                  { key: 'agent:main:main', displayName: 'main', updatedAt: Date.now() },
                  ...Array.from({ length: 40 }, (_, index) => ({
                    key: `agent:main:session-${index}`,
                    derivedTitle: `Derived sidebar title ${index}`,
                    updatedAt: Date.now() - index,
                  })),
                ],
              },
            };
          }
          if (method === 'chat.history') {
            (globalThis as typeof globalThis & { __chatHistoryCalls?: number }).__chatHistoryCalls! += 1;
            return { success: true, result: { messages: [] } };
          }
          if (method === 'sessions.preview') {
            throw new Error(`sessions.preview should not be needed when sessions.list provides derived titles: ${JSON.stringify(params)}`);
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
      await expect(page.getByText('Derived sidebar title 0')).toBeVisible();
      await expect(page.getByText('RPC timeout: chat.history')).toHaveCount(0);

      const chatHistoryCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatHistoryCalls?: number }).__chatHistoryCalls ?? 0
      ));
      expect(chatHistoryCalls).toBeLessThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
