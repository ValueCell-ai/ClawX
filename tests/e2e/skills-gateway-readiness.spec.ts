import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Skills page gateway readiness', () => {
  test('clears stale startup banner once runtime skills RPC succeeds', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      gatewayRpc: {
        '["skills.status",null]': { success: false, error: 'Gateway not connected' },
      },
    });

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'stopped', { timeout: 3_500 });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 12345,
        connectedAt: 1,
        gatewayReady: false,
      });
    });

    await expect(page.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'starting', { timeout: 3_500 });

    await installIpcMocks(electronApp, {
      gatewayRpc: {
        '["skills.status",null]': { success: true, result: { skills: [] } },
      },
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 12345,
        connectedAt: 2,
        gatewayReady: false,
      });
    });

    await expect(page.getByTestId('skills-gateway-banner')).toHaveCount(0, { timeout: 2_000 });
  });
});
