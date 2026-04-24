import { completeSetup, expect, test } from './fixtures/electron';

test.describe('ClawX developer-mode gated UI', () => {
  test('keeps developer-only configuration hidden until dev mode is enabled', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('sidebar-open-dev-console')).toHaveCount(0);

    await page.getByTestId('sidebar-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expect(page.getByTestId('add-provider-model-id-input')).toHaveCount(0);
    await page.getByTestId('add-provider-close-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();
    await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
    await expect(page.getByTestId('sidebar-open-dev-console')).toBeVisible();

    await page.getByTestId('sidebar-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expect(page.getByTestId('add-provider-model-id-input')).toBeVisible();
  });
});
