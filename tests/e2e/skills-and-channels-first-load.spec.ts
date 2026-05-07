import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Skills and Channels first-load responsiveness', () => {
  test('renders channels immediately and keeps skills navigation responsive while clawhub list is slow', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';

        if (path === '/api/gateway/status' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789 },
            },
          };
        }

        if (path === '/api/agents' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [] },
            },
          };
        }

        if (path === '/api/channels/accounts' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                gatewayHealth: {
                  state: 'healthy',
                  reasons: [],
                  consecutiveHeartbeatMisses: 0,
                },
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

        if (path === '/api/skills/configs' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {},
            },
          };
        }

        if (path === '/api/clawhub/list' && method === 'GET') {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                results: [
                  {
                    slug: 'market-skill',
                    version: '1.2.3',
                    source: 'openclaw-managed',
                    baseDir: '/tmp/market-skill',
                  },
                ],
              },
            },
          };
        }

        return {
          ok: false,
          error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` },
        };
      });

      ipcMain.removeHandler('gateway:rpc');
      ipcMain.handle('gateway:rpc', async (_event, method: string) => {
        if (method === 'skills.status') {
          return {
            success: true,
            result: {
              skills: [
                {
                  skillKey: 'demo-skill',
                  slug: 'demo-skill',
                  name: 'Demo Skill',
                  description: 'Gateway-backed skill',
                  disabled: false,
                  version: '1.0.0',
                  source: 'openclaw-bundled',
                },
              ],
            },
          };
        }

        return {
          success: true,
          result: {},
        };
      });
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByText('Demo Skill')).toBeVisible();
  });
});
