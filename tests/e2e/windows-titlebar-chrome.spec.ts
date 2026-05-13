import { expect, test } from './fixtures/electron';

test.describe('Windows frameless chrome', () => {
  test.skip(process.platform !== 'win32', 'Windows custom title bar only');

  test('uses sidebar-toned shell and no top border on the main panel', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('main-layout')).toHaveAttribute('data-platform', 'win32');

    const shell = page.getByTestId('main-layout');
    await expect(shell).toHaveClass(/bg-surface-sidebar/);

    const titleBar = page.getByTestId('windows-titlebar');
    await expect(titleBar).toBeVisible();
    await expect(titleBar).toHaveClass(/bg-surface-sidebar/);

    const main = page.getByTestId('main-content');
    await expect(main).not.toHaveClass(/border-t/);
  });
});
