import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('hover-only scrollbar visibility', () => {
  test('hides scrollbars until a scroll container is hovered', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      const scrollContainer = page.locator('[data-testid="models-page"] .overflow-y-auto').first();
      await expect(scrollContainer).toBeVisible();

      const beforeHover = await scrollContainer.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const thumbStyle = window.getComputedStyle(element, '::-webkit-scrollbar-thumb');
        return {
          scrollbarWidth: style.scrollbarWidth,
          thumbBackground: thumbStyle.backgroundColor,
        };
      });

      await expect(scrollContainer).toHaveCSS('scrollbar-width', 'thin');
      expect(beforeHover.thumbBackground).toBe('rgba(0, 0, 0, 0)');

      await scrollContainer.hover();

      const afterHover = await scrollContainer.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const thumbStyle = window.getComputedStyle(element, '::-webkit-scrollbar-thumb');
        return {
          scrollbarWidth: style.scrollbarWidth,
          thumbBackground: thumbStyle.backgroundColor,
        };
      });

      expect(afterHover.scrollbarWidth).toBe('thin');
      expect(afterHover.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');
    } finally {
      await closeElectronApp(app);
    }
  });
});
