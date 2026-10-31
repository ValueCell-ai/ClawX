import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';
import { executeInWebBrowserGuest, getWebBrowserMainSnapshot } from './fixtures/web-browser';
import { pathToFileURL } from 'node:url';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.describe('Skills page gateway readiness', () => {
  test('shows local skills and centered details even when gateway is stopped', async ({ electronApp, page }, testInfo) => {
    await completeSetup(page);
    const candidate = join(await electronApp.evaluate(({ app }) => app.getPath('userData')), 'skill-reader-fixture');
    await mkdir(candidate, { recursive: true });
    const skillRoot = await realpath(candidate);
    await writeFile(join(skillRoot, 'SKILL.md'), '---\nname: pdf\ndescription: Local PDF tools\nmetadata:\n  tools: [read, write]\n---\n\n# Read-only skill instructions');
    await mkdir(join(skillRoot, 'assets'), { recursive: true });
    await writeFile(join(skillRoot, 'assets', 'sample.html'), '<!doctype html><title>Skill HTML preview</title><h1>Skill HTML preview</h1>');

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
            description: 'Local PDF tools. '.repeat(100),
            enabled: true,
            source: 'openclaw-managed',
            baseDir: skillRoot,
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

    await navigateToSection(page, 'skills');
    await expect(page.getByTestId('skills-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PDF' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'XLSX' })).toBeVisible();
    await expect(page.getByTestId('skills-gateway-banner')).toHaveAttribute('data-state', 'stopped', { timeout: 3_500 });
    await expect(page.getByRole('switch', { name: 'Enable PDF' })).toBeVisible();
    await expect(page.getByTestId('skill-card').first()).not.toContainText('/tmp/');
    await expect(page.getByTestId('skill-card').first().getByTestId('skill-source-badge')).toHaveText('Managed');
    await expect(page.getByRole('tab', { name: /My skills/ })).toHaveCount(0);
    const toggle = page.getByRole('switch', { name: 'Enable PDF' });
    const trackBox = await toggle.boundingBox();
    const thumbBox = await toggle.locator('span').boundingBox();
    expect(thumbBox!.x).toBeGreaterThanOrEqual(trackBox!.x);
    expect(thumbBox!.x + thumbBox!.width).toBeLessThanOrEqual(trackBox!.x + trackBox!.width);
    await page.getByRole('button', { name: 'View PDF details' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText('Local PDF tools');
    const dialog = page.getByTestId('skill-detail-dialog');
    const dialogBox = await dialog.boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(dialogBox!.y + dialogBox!.height / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(dialogBox!.width).toBeLessThanOrEqual(672);
    expect(dialogBox!.height).toBeLessThanOrEqual(viewport.height * 0.85 + 1);
    await expect(page.getByRole('dialog').getByText('User Installed', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Files and technical details', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: /^(Uninstall|Disable|Enable)$/ })).toHaveCount(0);
    const sourceRow = page.getByTestId('skill-detail-source');
    const headingBox = await sourceRow.getByRole('heading').boundingBox();
    const badgeBox = await sourceRow.getByText('Managed', { exact: true }).boundingBox();
    expect(badgeBox!.x).toBeGreaterThan(headingBox!.x + headingBox!.width);
    expect(Math.abs(badgeBox!.y + badgeBox!.height / 2 - headingBox!.y - headingBox!.height / 2)).toBeLessThan(2);
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(skillRoot);
    await expect(dialog.getByRole('button', { name: /SKILL\.md/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('skill-details-centered.png'), animations: 'disabled' });
    const fileButton = dialog.getByRole('button', { name: /SKILL\.md/ });
    await fileButton.scrollIntoViewIfNeeded();
    const detailContent = page.getByTestId('skill-detail-content');
    const scrollTop = await detailContent.evaluate(element => element.scrollTop);
    await fileButton.click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const reader = page.getByTestId('skill-file-reader');
    await expect(reader).toContainText('Read-only skill instructions');
    await expect(reader.getByTestId('file-preview-filename')).toHaveText('SKILL.md');
    const metadata = reader.getByTestId('markdown-frontmatter');
    const metadataContent = metadata.getByTestId('markdown-frontmatter-content');
    await expect(metadata).toHaveAttribute('open', '');
    await expect(metadataContent).toBeVisible();
    await metadata.locator('summary').focus();
    await page.keyboard.press('Space');
    await expect(metadataContent).toBeHidden();
    await expect(metadataContent).toHaveText('name: pdf\ndescription: Local PDF tools\nmetadata:\n  tools: [read, write]');
    await page.keyboard.press('Enter');
    await expect(metadataContent).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveAccessibleName('SKILL.md');
    await expect(dialog).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(async () => {
      const bounds = await reader.boundingBox();
      return Math.abs(bounds!.x + bounds!.width - viewport.width + 8);
    }).toBeLessThan(2);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await reader.getByTestId('file-preview-actions').click();
    await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reader).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('skill-shared-reader-drawer.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(reader).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveAccessibleName('PDF');
    await expect(detailContent).toBeVisible();
    await expect(fileButton).toBeFocused();
    expect(await detailContent.evaluate(element => element.scrollTop)).toBe(scrollTop);

    await dialog.getByRole('button', { name: /sample\.html/ }).click();
    await expect(reader.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(async () => (await getWebBrowserMainSnapshot(electronApp)).url).toBe(pathToFileURL(`${skillRoot}/assets/sample.html`).href);
    const guestId = (await getWebBrowserMainSnapshot(electronApp)).guestId!;
    await expect.poll(() => executeInWebBrowserGuest<string>(electronApp, guestId, 'document.body.innerText')).toContain('Skill HTML preview');
    const htmlBounds = await reader.getByTestId('html-preview-host').boundingBox();
    await page.mouse.click(htmlBounds!.x + 30, htmlBounds!.y + 30);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await reader.getByRole('tab', { name: 'Source', exact: true }).click();
    await expect(reader.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'true');
    await reader.getByRole('tab', { name: 'Preview', exact: true }).click();
    await expect(reader.getByTestId('html-preview-host')).toHaveAttribute('aria-hidden', 'false');
    await reader.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveAccessibleName('PDF');
    await expect(detailContent).toBeVisible();
    await expect(page.getByTestId('html-preview-host')).toHaveCount(0);
    await dialog.getByRole('button', { name: /sample\.html/ }).click();
    await expect(reader).toBeVisible();
    await reader.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /sample\.html/ })).toBeFocused();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('html-preview-host')).toHaveCount(0);
    await expect.poll(async () => (await getWebBrowserMainSnapshot(electronApp)).matchingGuestCount).toBe(0);
    const detailTrigger = page.getByRole('button', { name: 'View PDF details' });
    await expect(detailTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(detailContent).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(detailTrigger).toBeFocused();

    await page.setViewportSize({ width: 900, height: 650 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await detailTrigger.click();
    await expect(dialog).toBeVisible();
    const narrowBox = await dialog.boundingBox();
    expect(Math.abs(narrowBox!.x + narrowBox!.width / 2 - 450)).toBeLessThan(2);
    expect(narrowBox!.height).toBeLessThanOrEqual(650 * 0.85 + 1);
    await page.screenshot({ path: testInfo.outputPath('skill-details-narrow-dark.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: /SKILL\.md/ }).click();
    await expect(reader).toBeVisible();
    await expect.poll(async () => {
      const bounds = await reader.boundingBox();
      return Math.abs(bounds!.x + bounds!.width - 900 + 8);
    }).toBeLessThan(2);
    const narrowReader = await reader.boundingBox();
    expect(narrowReader!.height).toBeLessThanOrEqual(634);
    await page.screenshot({ path: testInfo.outputPath('skill-reader-drawer-narrow-dark.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(reader).toHaveCount(0);
    await expect(fileButton).toBeFocused();
    await page.mouse.click(10, 10);
    await expect(dialog).toHaveCount(0);
    await expect(detailTrigger).toBeFocused();
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

    await navigateToSection(page, 'skills');
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

    await navigateToSection(page, 'skills');
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
  await navigateToSection(page, 'skills');
  await page.getByTestId('skills-filter-disabled').click();
  await page.getByRole('button', { name: 'Add skills', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Install Skills' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catalog skill' })).toBeVisible();
  await expect(page.getByText('Original catalog description')).toBeVisible();
  await page.getByRole('textbox', { name: /Search marketplace/i }).fill('missing');
  await expect(page.getByRole('heading', { name: 'Catalog skill' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add skills', exact: true })).toBeFocused();
  await expect(page.getByTestId('skills-filter-disabled')).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByTestId('sidebar-nav-skills')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Add skills', exact: true }).click();
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox!.width).toBeLessThanOrEqual(868);
  expect(dialogBox!.height).toBeLessThanOrEqual(602);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bottomGap = await page.getByTestId('skills-list-scroll').evaluate((element) =>
    window.innerHeight - element.getBoundingClientRect().bottom);
  expect(bottomGap).toBeGreaterThanOrEqual(32);
  expect(bottomGap).toBeLessThanOrEqual(34);
  await page.screenshot({ path: testInfo.outputPath('skills-narrow-dark.png'), animations: 'disabled' });
});
