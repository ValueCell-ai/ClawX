import { expect, test } from './fixtures/electron';

test.describe('macOS frameless chrome', () => {
  test.skip(process.platform !== 'darwin', 'macOS drag-region chrome only');

  test('keeps a draggable strip above the right content pane', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('main-layout')).toHaveAttribute('data-platform', 'darwin');

    const mainDragRegion = page.getByTestId('mac-main-drag-region');
    await expect(mainDragRegion).toBeVisible();
    await expect(mainDragRegion).toHaveCSS('-webkit-app-region', 'drag');

    const box = await mainDragRegion.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });
});
