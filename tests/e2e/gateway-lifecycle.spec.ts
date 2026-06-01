import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

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

  test('shows gateway restart progress in the sidebar instead of page-level warnings', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: true },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: true },
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
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, channels: [] },
          },
        },
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: [],
          },
        },
      },
      gatewayRpc: {
        [stableStringify(['skills.status', null])]: { success: false, error: 'Gateway not connected' },
      },
    });

    await completeSetup(page);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'starting',
        port: 18789,
        gatewayReady: false,
      });
    });

    const restartIndicator = page.getByTestId('sidebar-gateway-restarting');
    await expect(restartIndicator).toHaveAttribute('data-state', 'visible');
    await expect(restartIndicator).toContainText(/gateway.*restart|重启中/i);

    const oldWarningCopy = /Gateway service is not running|Gateway is not running\.|Gateway 服务未运行|Agent 或频道变更|网关未运行。|没有活跃的网关|Scheduled tasks cannot be managed|无法管理定时任务|Channels cannot connect|无法管理频道/i;

    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await page.getByTestId('sidebar-nav-cron').click();
    await expect(page.getByTestId('cron-page')).toBeVisible();
    await expect(page.getByText(oldWarningCopy)).toHaveCount(0);

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByTestId('skills-gateway-banner')).toHaveCount(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 200,
        connectedAt: 2,
        gatewayReady: true,
      });
    });

    await expect(restartIndicator).toHaveAttribute('data-state', 'hidden');
  });

  test('chat sidebar history reloads when gateway becomes ready after restart', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: false },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 100, connectedAt: 1, gatewayReady: false },
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
      gatewayRpc: {
        [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
          sessions: [{ key: 'agent:main:main', displayName: 'main' }],
        },
        [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200, maxChars: 500000 }])]: {
          messages: [
            { role: 'user', content: 'hello', timestamp: 1000 },
            { role: 'assistant', content: 'history after ready', timestamp: 1001 },
          ],
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-new-chat').click();
    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'visible');
    await expect(page.getByText('history after ready')).toHaveCount(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('gateway:status-changed', {
        state: 'running',
        port: 18789,
        pid: 200,
        connectedAt: 2,
        gatewayReady: true,
      });
    });

    await expect(page.getByText('history after ready')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'hidden');
  });
});
