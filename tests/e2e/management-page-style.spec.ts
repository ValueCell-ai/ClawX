import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, test } from './fixtures/electron';

test('management pages share compact headings, gutters and contained scrolling', async ({ page }, testInfo) => {
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-settings').click();
  await navigateToSection(page, 'advanced');
  await page.getByTestId('settings-dev-mode-switch').click();
  await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 650 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), viewport.width === 900);
    for (const name of ['skills', 'models', 'agents', 'channels', 'cron', 'settings', 'computer-use']) {
      await navigateToSection(page, name);
      const surface = page.getByTestId(`${name}-page`);
      const heading = surface.locator('h1');
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS('font-size', '24px');
      await expect(heading).toHaveCSS('font-weight', '500');
      if (name === 'models') {
        const primary = page.getByTestId('providers-add-button');
        const contrast = async () => primary.evaluate((element) => {
          const style = getComputedStyle(element);
          const luminance = (color: string) => {
            const channels = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(value => {
              const channel = Number(value) / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          };
          const a = luminance(style.color);
          const b = luminance(style.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        expect(await contrast()).toBeGreaterThanOrEqual(4.5);
        await primary.hover();
        expect(await contrast()).toBeGreaterThanOrEqual(4.5);
      }
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
