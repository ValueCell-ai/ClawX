import { expect, test } from './fixtures/electron';

test.describe('Image generation settings on Models page', () => {
  test('shows image generation section after skipping setup', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings-title')).toBeVisible();
    await expect(page.getByTestId('image-generation-primary')).toBeVisible();
    await expect(page.getByTestId('image-generation-save')).toBeVisible();
  });
});
