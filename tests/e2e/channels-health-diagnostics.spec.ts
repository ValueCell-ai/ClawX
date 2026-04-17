import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Channels health diagnostics', () => {
  test('shows degraded banner, restarts gateway, and copies diagnostics', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        restartCount: 0,
        diagnosticsCount: 0,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eChannelHealth = state;

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (globalThis as any).__clawxE2eChannelHealth as typeof state;

        if (path === '/api/channels/accounts' && method === 'GET') {
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                gatewayHealth: {
                  state: 'degraded',
                  reasons: ['channels_status_timeout'],
                  consecutiveHeartbeatMisses: 1,
                },
                channels: [
                  {
                    channelType: 'feishu',
                    defaultAccountId: 'default',
                    status: 'degraded',
                    statusReason: 'channels_status_timeout',
                    accounts: [
                      {
                        accountId: 'default',
                        name: 'Primary Account',
                        configured: true,
                        status: 'degraded',
                        statusReason: 'channels_status_timeout',
                        isDefault: true,
                      },
                    ],
                  },
                ],
              },
            },
          };
        }

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

        if (path === '/api/gateway/restart' && method === 'POST') {
          current.restartCount += 1;
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true },
            },
          };
        }

        if (path === '/api/diagnostics/gateway-snapshot' && method === 'GET') {
          current.diagnosticsCount += 1;
          return {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                capturedAt: 123,
                platform: 'darwin',
                gateway: {
                  state: 'degraded',
                  reasons: ['channels_status_timeout'],
                  consecutiveHeartbeatMisses: 1,
                },
                channels: [],
                clawxLogTail: 'clawx-log',
                gatewayLogTail: 'gateway-log',
                gatewayErrLogTail: '',
              },
            },
          };
        }

        return {
          ok: false,
          error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` },
        };
      });
    });

    await completeSetup(page);

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (value: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__copiedDiagnostics = value;
            return Promise.resolve();
          },
        },
        configurable: true,
      });
    });

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByTestId('channels-health-banner')).toBeVisible();
    await expect(page.getByText(/Gateway degraded|网关状态异常|ゲートウェイ劣化/)).toBeVisible();
    await expect(page.locator('div.rounded-2xl').getByTitle(/Degraded|异常降级|劣化中/).first()).toBeVisible();

    await page.getByTestId('channels-restart-gateway').click();
    await page.getByTestId('channels-copy-diagnostics').click();
    await page.getByTestId('channels-toggle-diagnostics').click();

    await expect(page.getByTestId('channels-diagnostics')).toBeVisible();

    const result = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (globalThis as any).__clawxE2eChannelHealth as { restartCount: number; diagnosticsCount: number };
      return {
        restartCount: state.restartCount,
        diagnosticsCount: state.diagnosticsCount,
      };
    });

    expect(result.restartCount).toBe(1);
    expect(result.diagnosticsCount).toBeGreaterThanOrEqual(1);

    const copied = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__copiedDiagnostics as string;
    });
    expect(copied).toContain('"platform": "darwin"');
  });
});
