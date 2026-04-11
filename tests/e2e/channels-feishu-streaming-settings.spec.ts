import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Feishu streaming settings', () => {
  test('persists official plugin streaming and reply mode options', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      hostApi: {
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              channels: [
                {
                  channelType: 'feishu',
                  defaultAccountId: 'default',
                  status: 'connected',
                  accounts: [
                    {
                      accountId: 'default',
                      name: 'Primary Account',
                      configured: true,
                      status: 'connected',
                      isDefault: true,
                    },
                  ],
                },
              ],
            },
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              agents: [],
            },
          },
        },
        [stableStringify(['/api/channels/config/feishu?accountId=default', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              values: {
                appId: 'cli_existing',
                appSecret: 'secret_existing',
                streaming: 'true',
                replyModeDefault: 'streaming',
                replyModeGroup: 'streaming',
              },
            },
          },
        },
      },
    });

    await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxFeishuConfigBodies = [];
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const previousHandler = ipcMain;
      previousHandler.removeHandler('hostapi:fetch');
      previousHandler.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string | null }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';

        if (path === '/api/channels/accounts' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                channels: [
                  {
                    channelType: 'feishu',
                    defaultAccountId: 'default',
                    status: 'connected',
                    accounts: [
                      {
                        accountId: 'default',
                        name: 'Primary Account',
                        configured: true,
                        status: 'connected',
                        isDefault: true,
                      },
                    ],
                  },
                ],
              },
            },
          };
        }

        if (path === '/api/agents' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [],
              },
            },
          };
        }

        if (path === '/api/channels/config/feishu?accountId=default' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                values: {
                  appId: 'cli_existing',
                  appSecret: 'secret_existing',
                  streaming: 'true',
                  replyModeDefault: 'streaming',
                  replyModeGroup: 'streaming',
                },
              },
            },
          };
        }

        if (path === '/api/channels/config' && method === 'POST') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxFeishuConfigBodies.push(request?.body ?? null);
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
              },
            },
          };
        }

        return {
          ok: true,
          data: { status: 200, ok: true, json: {} },
        };
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();

    await page.getByRole('button', { name: /configure|update|dialog\.updateTitle/i }).first().click();

    const streamingSelect = page.locator('#streaming');
    const replyModeSelect = page.locator('#replyMode');
    const replyModeGroupSelect = page.locator('#replyModeGroup');

    await expect(streamingSelect).toHaveValue('true');
    await expect(replyModeSelect).toHaveValue('streaming');
    await expect(replyModeGroupSelect).toHaveValue('streaming');

    await replyModeSelect.selectOption('streaming');
    await replyModeGroupSelect.selectOption('auto');

    await page.getByRole('button', { name: /Update & Reconnect|dialog\.updateAndReconnect/i }).click();

    await expect
      .poll(async () => {
        return await electronApp.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return ((globalThis as any).__clawxFeishuConfigBodies as Array<string | null>).length;
        });
      })
      .toBeGreaterThan(0);

    const savedBody = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (globalThis as any).__clawxFeishuConfigBodies as Array<string | null>;
      return entries.at(-1) ?? null;
    });

    expect(savedBody).not.toBeNull();
    const parsed = JSON.parse(savedBody!) as {
      config: Record<string, unknown>;
    };

    expect(parsed.config).toMatchObject({
      streaming: 'true',
      replyMode: 'streaming',
      replyModeGroup: 'auto',
    });
  });
});
