import { navigateToSection } from './fixtures/navigation';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

for (const theme of ['light', 'dark']) {
  test(`scrollbars stay narrow and appear on hover in ${theme} mode`, async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        hostApi: { '["/api/settings","GET"]': { language: 'en', setupComplete: true, theme } },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await navigateToSection(page, 'models');
      const scrollContainer = page.locator('[data-testid="models-page"] .overflow-y-auto').first();
      await expect(scrollContainer).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b).*$/);
      await page.mouse.move(0, 0);
      const before = await scrollContainer.evaluate(element => {
        const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
        const scrollbar = getComputedStyle(element, '::-webkit-scrollbar');
        return {
          clientWidth: element.clientWidth,
          width: scrollbar.width,
          height: scrollbar.height,
          thumb: thumb.backgroundColor,
          border: thumb.borderLeftWidth,
          clip: thumb.backgroundClip,
          track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
        };
      });
      // Standard non-auto properties would override the six-pixel Chromium rule.
      await expect(scrollContainer).toHaveCSS('scrollbar-width', 'auto');
      await expect(scrollContainer).toHaveCSS('scrollbar-color', 'auto');
      expect(before).toMatchObject({ width: '6px', height: '6px', thumb: 'rgba(0, 0, 0, 0)', border: '1px', clip: 'padding-box', track: 'rgba(0, 0, 0, 0)' });
      await scrollContainer.hover();
      await expect(scrollContainer).toHaveCSS('scrollbar-color', 'auto');
      const after = await scrollContainer.evaluate(element => ({
        clientWidth: element.clientWidth,
        thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
        track: getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor,
      }));
      expect(after.clientWidth).toBe(before.clientWidth);
      expect(after.thumb).not.toBe('rgba(0, 0, 0, 0)');
      expect(after.track).toBe('rgba(0, 0, 0, 0)');
      await page.mouse.move(0, 0);
      await expect.poll(() => scrollContainer.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    } finally {
      await closeElectronApp(app);
    }
  });
}
