import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Channels first-load resilience', () => {
  test('renders the channels page shell while the accounts request is still pending', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ skipSetup: true });

    try {
      await electronApp.evaluate(({ ipcMain }) => {
        const state = {
          calls: 0,
        };

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
          const method = request?.method ?? 'GET';
          const path = request?.path ?? '';

          if (path === '/api/channels/accounts' && method === 'GET') {
            state.calls += 1;
            if (state.calls === 1) {
              return {
                ok: true,
                data: {
                  status: 200,
                  ok: true,
                  json: {
                    success: true,
                    runtimeStatusPending: true,
                    channels: [
                      {
                        channelType: 'telegram',
                        defaultAccountId: 'default',
                        status: 'connecting',
                        accounts: [
                          {
                            accountId: 'default',
                            name: 'Integration Bot',
                            configured: true,
                            status: 'connecting',
                            isDefault: true,
                            agentId: 'main',
                          },
                        ],
                      },
                    ],
                  },
                },
              };
            }

            return {
              ok: true,
              data: {
                status: 200,
                ok: true,
                json: {
                  success: true,
                  runtimeStatusPending: false,
                  channels: [
                    {
                      channelType: 'telegram',
                      defaultAccountId: 'default',
                      status: 'connected',
                      accounts: [
                        {
                          accountId: 'default',
                          name: 'Integration Bot',
                          configured: true,
                          status: 'connected',
                          isDefault: true,
                          agentId: 'main',
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
                  agents: [
                    { id: 'main', name: 'Main' },
                  ],
                },
              },
            };
          }

          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true },
            },
          };
        });
      });

      const page = await getStableWindow(electronApp);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-channels').click();

      await expect(page.getByTestId('channels-page')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Messaging Channels' })).toBeVisible();
      await expect(page.getByText('Integration Bot')).toBeVisible();
      await expect(page.locator('[class*="bg-yellow-500"]').first()).toBeVisible();
      await expect(page.locator('button', { hasText: 'Telegram' })).toBeHidden();

      await expect(page.locator('[class*="bg-green-500"]').first()).toBeVisible({ timeout: 7000 });
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
