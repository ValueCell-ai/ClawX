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
    await expect(page.getByRole('switch', { name: 'Enable PDF' })).toBeVisible();
    await expect(page.getByTestId('skill-card').first()).not.toContainText('/tmp/');
    await page.getByRole('button', { name: 'View PDF details' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Local PDF tools');
    await expect(page.getByRole('dialog').getByText('User Installed', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Files and technical details', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: /^(Uninstall|Disable|Enable)$/ })).toHaveCount(0);
    const sourceRow = page.getByTestId('skill-detail-source');
    const headingBox = await sourceRow.getByRole('heading').boundingBox();
    const badgeBox = await sourceRow.getByText('Managed', { exact: true }).boundingBox();
    expect(badgeBox!.x).toBeGreaterThan(headingBox!.x + headingBox!.width);
    expect(Math.abs(badgeBox!.y + badgeBox!.height / 2 - headingBox!.y - headingBox!.height / 2)).toBeLessThan(2);
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('/tmp/.openclaw/skills/pdf');
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('tab', { name: 'Discover skills' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add skills' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Skills Folder' })).toBeVisible();

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
    await expect(page.getByRole('button', { name: /Disable|禁用|無効化|Выключить/i })).toHaveCount(0);
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


test('discovers skills with an available marketplace and adapts to narrow dark windows', async ({ electronApp, page }, testInfo) => {
  await completeSetup(page);
  await installIpcMocks(electronApp, {
    hostApi: {
      '["skills","clawhubCapability",null]': { success: true, capability: { canSearch: true, canInstall: true } },
      '["skills","clawhubSearch",{"query":""}]': { success: true, results: [{ slug: 'catalog-skill', name: 'Catalog skill', description: 'Original catalog description' }] },
      '["skills","clawhubSearch",{"query":"missing"}]': { success: true, results: [] },
    },
  });
  await page.getByTestId('sidebar-nav-skills').click();
  await page.getByRole('tab', { name: 'Discover skills' }).click();
  await expect(page.getByRole('heading', { name: 'Catalog skill' })).toBeVisible();
  await expect(page.getByText('Original catalog description')).toBeVisible();
  await page.getByRole('textbox', { name: /Search marketplace/i }).fill('missing');
  await expect(page.getByRole('heading', { name: 'Catalog skill' })).toHaveCount(0);
  await page.getByRole('tab', { name: /My skills/ }).click();
  await expect(page.getByRole('button', { name: 'Open Skills Folder', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skills', exact: true }).locator('svg')).toBeVisible();
  await page.getByTestId('skills-filter-disabled').click();
  await expect(page.getByTestId('skills-empty-state')).toBeVisible();
  const contentBox = await page.getByTestId('skills-list-scroll').boundingBox();
  const emptyBox = await page.getByTestId('skills-empty-state').boundingBox();
  expect(Math.abs((emptyBox!.x + emptyBox!.width / 2) - (contentBox!.x + contentBox!.width / 2))).toBeLessThan(6);
  expect(Math.abs((emptyBox!.y + emptyBox!.height / 2) - (contentBox!.y + contentBox!.height / 2))).toBeLessThan(2);
  const selectedStyles = await page.getByTestId('skills-filter-disabled').getAttribute('class');
  await page.getByTestId('skills-filter-all').click();
  await expect(page.getByTestId('skills-filter-all')).toHaveAttribute('class', selectedStyles!);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.getByRole('tab', { name: /My skills/ })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bottomGap = await page.getByTestId('skills-list-scroll').evaluate((element) =>
    window.innerHeight - element.getBoundingClientRect().bottom);
  expect(bottomGap).toBeGreaterThanOrEqual(32);
  expect(bottomGap).toBeLessThanOrEqual(34);
  await page.screenshot({ path: testInfo.outputPath('skills-narrow-dark.png'), animations: 'disabled' });
});
