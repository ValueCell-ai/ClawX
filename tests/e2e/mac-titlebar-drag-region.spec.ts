import { expect, test } from './fixtures/electron';
import {
  MAC_SIDEBAR_CHROME_HEIGHT,
  SIDEBAR_COLLAPSED_WIDTH,
} from '../../shared/sidebar-layout';

test.describe('macOS frameless chrome', () => {
  test.skip(process.platform !== 'darwin', 'macOS drag-region chrome only');

  test('keeps a draggable strip above non-chat pages and stacks chat above it', async ({ page }) => {
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
    expect(box!.height).toBe(MAC_SIDEBAR_CHROME_HEIGHT);

    const sidebarChrome = page.getByTestId('mac-sidebar-chrome');
    await expect(sidebarChrome).toBeVisible();
    await expect(sidebarChrome).toHaveCSS('-webkit-app-region', 'drag');

    const chromeBox = await sidebarChrome.boundingBox();
    expect(chromeBox).not.toBeNull();
    expect(chromeBox!.height).toBe(MAC_SIDEBAR_CHROME_HEIGHT);

    const sidebar = page.getByTestId('sidebar');
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBe(SIDEBAR_COLLAPSED_WIDTH);

    const chatPage = page.getByTestId('chat-page');
    await expect(chatPage).toBeVisible();
    await expect(chatPage).toHaveCSS('z-index', '20');
  });
});
