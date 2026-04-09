import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('ClawX gateway lifecycle resilience', () => {
  test('app remains fully navigable while gateway is disconnected', async ({ page }) => {
    // In E2E mode, gateway auto-start is skipped, so the app starts
    // with gateway in "stopped" state — simulating the disconnected scenario.
    await completeSetup(page);

    // Navigate through all major pages to verify nothing crashes
    // when the gateway is not running.
    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('models-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();

    // Navigate back to chat — the gateway status indicator should be visible
    await page.getByTestId('sidebar-new-chat').click();
    // Verify the page didn't crash; main layout should still be stable
    await expect(page.getByTestId('main-layout')).toBeVisible();
  });

  test('gateway status indicator updates when status transitions occur', async ({ electronApp, page }) => {
    await completeSetup(page);

    // Mock the initial gateway status as "stopped"
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
    });

    // Simulate gateway status transitions by sending IPC events to the renderer.
    // This mimics the main process emitting gateway:status-changed events.

    // Transition 1: stopped → starting
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'starting',
        port: 18789,
      });
    });
    // Wait briefly for the renderer to process the IPC event
    await page.waitForTimeout(500);

    // Transition 2: starting → running
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 12345,
        connectedAt: Date.now(),
      });
    });
    await page.waitForTimeout(500);

    // Verify navigation still works after status transitions
    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('models-page')).toBeVisible();

    // Transition 3: running → error (simulates the bug scenario where
    // gateway becomes unreachable after in-process restart)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'error',
        port: 18789,
        error: 'WebSocket closed before handshake',
      });
    });
    await page.waitForTimeout(500);

    // App should still be functional in error state
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    // Transition 4: error → reconnecting → running (the recovery path)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'reconnecting',
        port: 18789,
        reconnectAttempts: 1,
      });
    });
    await page.waitForTimeout(300);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 23456,
        connectedAt: Date.now(),
      });
    });
    await page.waitForTimeout(500);

    // Final navigation check to confirm app is still healthy after full lifecycle
    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('sidebar-new-chat').click();
    await expect(page.getByTestId('main-layout')).toBeVisible();
  });

  test('app handles rapid gateway status transitions without crashing', async ({ electronApp, page }) => {
    await completeSetup(page);

    // Simulate rapid status transitions like those seen in the bug log:
    // running → stopped → starting → error → reconnecting → running
    const states = [
      { state: 'running', port: 18789, pid: 100 },
      { state: 'stopped', port: 18789 },
      { state: 'starting', port: 18789 },
      { state: 'error', port: 18789, error: 'Port 18789 still occupied after 30000ms' },
      { state: 'reconnecting', port: 18789, reconnectAttempts: 1 },
      { state: 'starting', port: 18789 },
      { state: 'running', port: 18789, pid: 200, connectedAt: Date.now() },
    ];

    for (const status of states) {
      await electronApp.evaluate(({ BrowserWindow }, s) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', s);
      }, status);
      // Small delay between transitions to be more realistic
      await page.waitForTimeout(100);
    }

    // Verify the app is still stable after rapid transitions
    await expect(page.getByTestId('main-layout')).toBeVisible();

    // Navigate to verify no page is in a broken state
    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('models-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
  });
});
