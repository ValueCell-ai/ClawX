import { completeSetup, expect, test } from './fixtures/electron';

test('management pages share compact headings, gutters and contained scrolling', async ({ page }, testInfo) => {
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-dev-mode-switch').click();
  await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 650 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), viewport.width === 900);
    for (const name of ['skills', 'models', 'agents', 'channels', 'cron', 'settings', 'computer-use']) {
      await page.getByTestId(`sidebar-nav-${name}`).click();
      const surface = page.getByTestId(`${name}-page`);
      const heading = surface.locator('h1');
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS('font-size', '24px');
      await expect(heading).toHaveCSS('font-weight', '500');
      const body = surface.locator(':scope > div').first();
      await expect(body).toHaveCSS('padding-bottom', '32px');
      await expect(body).toHaveCSS('padding-top', '32px');
      const mainBox = await page.getByTestId('main-content').boundingBox();
      const surfaceBox = await surface.boundingBox();
      expect(Math.abs(surfaceBox!.y + surfaceBox!.height - mainBox!.y - mainBox!.height)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.width}.png`), animations: 'disabled' });
    }
  }
});
