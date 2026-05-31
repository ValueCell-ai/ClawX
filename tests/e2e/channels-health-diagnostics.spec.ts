import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Channels health diagnostics', () => {
  test('does not flash a stale gateway-not-running banner while status is running', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, {
            success: true,
            gatewayHealth: {
              state: 'degraded',
              reasons: ['gateway_not_running'],
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
          });
        }

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [] });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();
    await expect(page.getByTestId('channels-health-banner')).toHaveCount(0);
    await expect(page.getByText(/Gateway degraded|状态波动|ゲートウェイ劣化/)).toHaveCount(0);
    await expect(page.getByText(/Gateway is not running|网关当前未运行|ゲートウェイは起動していません/)).toHaveCount(0);
  });

  test('shows degraded banner, restarts gateway, and copies diagnostics', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        restartCount: 0,
        diagnosticsCount: 0,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eChannelHealth = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (globalThis as any).__clawxE2eChannelHealth as typeof state;

        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, {
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
          });
        }

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [] });
        }

        if (request?.module === 'gateway' && request.action === 'restart') {
          current.restartCount += 1;
          return respond(request.id, { success: true });
        }

        if (request?.module === 'diagnostics' && request.action === 'gatewaySnapshot') {
          current.diagnosticsCount += 1;
          return respond(request.id, {
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
          });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
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
    await expect(page.getByText(/Gateway degraded|状态波动|ゲートウェイ劣化/)).toBeVisible();
    await expect(page.locator('div.rounded-2xl').getByText(/Degraded|状态波动|劣化中/).first()).toBeVisible();

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
