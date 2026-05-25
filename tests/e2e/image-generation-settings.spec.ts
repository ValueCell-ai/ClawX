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
    await expect(page.getByTestId('image-generation-relay-model')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-openai-relay')).toBeVisible();
    await expect(page.getByTestId('image-generation-auto-sync')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-primary')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-fallbacks')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-save')).toBeVisible();
  });

  test('configures an independent OpenAI-compatible image endpoint', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('image-generation-settings')).toBeVisible();
    await page.getByTestId('image-generation-relay-enabled').click();
    await expect(page.getByTestId('image-generation-relay-base-url')).toBeVisible();
    await page.getByTestId('image-generation-relay-base-url').fill('https://taolat.com/v1');
    await page.getByTestId('image-generation-relay-model').fill('gpt-image-2');
    await page.getByTestId('image-generation-relay-api-key').fill('sk-test-image');

    await expect(page.getByTestId('image-generation-relay-model')).toHaveValue('gpt-image-2');
    await expect(page.getByTestId('image-generation-save')).toBeEnabled();
  });
});
