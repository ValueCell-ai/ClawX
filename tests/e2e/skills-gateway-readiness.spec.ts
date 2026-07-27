import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Skills page gateway readiness', () => {
  test('shows local skills even when gateway is stopped', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
      gatewayRpc: {
        '["skills.status",null]': { success: false, error: 'Gateway not connected' },
      },
      hostApi: {
        '["skills","status",null]': { skills: [] },
        '["skills","clawhubCapability",null]': {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
        '["skills","local",null]': {
          success: true,
          skills: [{
            id: 'pdf',
            slug: 'pdf',
            name: 'PDF',
            description: 'Local PDF tools',
            enabled: true,
            source: 'openclaw-managed',
            baseDir: '/tmp/.openclaw/skills/pdf',
          }, {
            id: 'xlsx',
            slug: 'xlsx',
            name: 'XLSX',
            description: 'Local spreadsheet tools',
            enabled: false,
            source: 'openclaw-managed',
            baseDir: '/tmp/.openclaw/skills/xlsx',
          }],
        },
      },
    });

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PDF' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'XLSX' })).toBeVisible();
    await expect(page.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'stopped', { timeout: 3_500 });
    await expect(page.getByRole('button', { name: /Install Skills/i })).toHaveCount(0);

    await page.getByTestId('skills-filter-enabled').click();
    await expect(page.getByRole('heading', { name: 'PDF' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'XLSX' })).toHaveCount(0);

    await page.getByTestId('skills-filter-disabled').click();
    await expect(page.getByRole('heading', { name: 'PDF' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'XLSX' })).toBeVisible();
  });

  test('hides uninstall for plugin-provided skills', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
      gatewayRpc: {
        '["skills.status",null]': { success: false, error: 'Gateway not connected' },
      },
      hostApi: {
        '["skills","status",null]': { skills: [] },
        '["skills","clawhubCapability",null]': {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
        '["skills","local",null]': {
          success: true,
          skills: [{
            id: 'browser-automation',
            slug: 'browser-automation',
            name: 'Browser Automation',
            description: 'Plugin skill',
            enabled: true,
            source: 'openclaw-plugin',
            baseDir: '/tmp/.openclaw/plugin-skills/browser-automation',
          }],
        },
      },
    });

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByRole('heading', { name: 'Browser Automation' })).toBeVisible();
    await page.getByText('Browser Automation').click();
    await expect(page.getByRole('button', { name: /Uninstall|卸载|アンインストール|Удалить/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Disable|禁用|無効化|Выключить/i })).toBeVisible();
  });

  test('clears stale startup banner once local skills load while runtime rpc is still starting', async ({ electronApp, page }) => {
    await completeSetup(page);

    await installIpcMocks(electronApp, {
      gatewayRpc: {
        '["skills.status",null]': { success: false, error: 'Gateway not connected' },
      },
      hostApi: {
        '["skills","status",null]': { skills: [] },
        '["skills","clawhubCapability",null]': {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
        '["skills","local",null]': {
          success: true,
          skills: [],
        },
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

    await expect(page.getByTestId('sidebar-gateway-restarting')).toHaveAttribute('data-state', 'visible');
    await expect(page.getByTestId('skills-gateway-banner')).toHaveCount(0, { timeout: 3_500 });

    await installIpcMocks(electronApp, {
      gatewayRpc: {
        '["skills.status",null]': { success: true, result: { skills: [] } },
      },
      hostApi: {
        '["skills","status",null]': { skills: [] },
        '["skills","local",null]': { success: true, skills: [] },
        '["skills","clawhubCapability",null]': {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
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
