import { navigateToSection } from './fixtures/navigation';
import { I18N_RESOURCES } from '../../shared/i18n/resources';
import { expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Image generation settings page', () => {
  async function unlockDeveloperMode(page: import('@playwright/test').Page) {
    await navigateToSection(page, 'advanced');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('sidebar-nav-image-generation')).toHaveCount(0);
    await navigateToSection(page, 'models');
    await expect(page.getByTestId('models-page')).toBeVisible();
    await page.getByTestId('models-tab-image-generation').click();
    await page.getByTestId('image-generation-configure').click();
  }

  test('shows image generation only in the developer-gated Models tab after skipping setup', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await navigateToSection(page, 'models');

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-image-generation')).toHaveCount(0);
    await expect(page.getByTestId('models-tab-image-generation')).toHaveCount(0);

    await navigateToSection(page, 'advanced');
    await page.getByTestId('settings-dev-mode-switch').click();
    await page.evaluate(() => {
      window.location.hash = '#/image-generation';
    });

    await expect(page.getByTestId('image-generation-page')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-image-generation')).toHaveCount(0);
    await page.evaluate(() => {
      window.location.hash = '#/models';
    });
    await expect(page.getByTestId('models-page')).toBeVisible();
    await page.getByTestId('models-tab-image-generation').click();
    await page.getByTestId('image-generation-configure').click();
    await expect(page.getByTestId('image-generation-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-config-dialog')).toHaveAccessibleName(I18N_RESOURCES.en.dashboard.imageGeneration.title);
    await expect(page.getByTestId('image-generation-relay-enabled')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-relay-model')).toBeVisible();
    await expect(page.getByTestId('image-generation-relay-model')).not.toHaveAttribute('aria-describedby');
    await expect(page.getByTestId('image-generation-openai-relay')).toBeVisible();
    await expect(page.getByTestId('image-generation-auto-sync')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-primary')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-fallbacks')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-save')).toBeVisible();
    const navigation = await page.getByTestId('image-generation-config-sections').boundingBox();
    const advanced = await page.getByTestId('image-generation-advanced').boundingBox();
    expect(navigation).not.toBeNull();
    expect(advanced).not.toBeNull();
    expect(navigation!.y + navigation!.height - (advanced!.y + advanced!.height)).toBeLessThanOrEqual(16);
    await page.getByTestId('image-generation-advanced').click();
    await expect(page.getByTestId('image-generation-config-dialog').getByTestId('image-generation-clear')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-refresh')).toHaveCount(0);
  });

  test('keeps saved state separate from an editable configuration dialog', async ({ page }) => {
    await page.getByTestId('setup-skip-button').click();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await unlockDeveloperMode(page);
    const dialog = page.getByTestId('image-generation-config-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('image-generation-settings-surface')).not.toHaveClass(/bg-surface-input/);
    await page.setViewportSize({ width: 540, height: 568 });
    const save = dialog.getByTestId('image-generation-save');
    const model = dialog.getByTestId('image-generation-relay-model');
    await model.fill('provider/example-model');
    await dialog.getByTestId('image-generation-advanced').click();
    await expect(save).toBeInViewport();
    await save.click();
    await expect(dialog.getByTestId('image-generation-endpoint-section')).toHaveAttribute('aria-pressed', 'true');
    await expect(model).toHaveAccessibleDescription(I18N_RESOURCES.en.dashboard.imageGeneration.errors.relayModelInvalid);
    await expect(save).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('image-generation-summary')).toBeVisible();
    await expect(page.getByTestId('image-generation-configure')).toBeFocused();
  });

  test('configures an independent OpenAI-compatible image endpoint', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await unlockDeveloperMode(page);

    await expect(page.getByTestId('image-generation-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-relay-base-url')).toBeVisible();
    await page.getByTestId('image-generation-relay-base-url').fill('https://api.example.com/v1');
    await page.getByTestId('image-generation-relay-model').fill('gpt-image-2');
    await page.getByTestId('image-generation-relay-api-key').fill('sk-test-image');

    await expect(page.getByTestId('image-generation-relay-model')).toHaveValue('gpt-image-2');
    await expect(page.getByTestId('image-generation-save')).toBeEnabled();
  });

  test('shows configured image API key like custom language model keys', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/media/image-generation","GET"]': {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              config: {
                primary: 'clawx-openai-image/gpt-image-2',
                fallbacks: [],
                timeoutMs: 180000,
              },
              autoProviderFallback: false,
              defaultAgentId: 'default',
              agents: [
                {
                  id: 'default',
                  name: 'Default',
                  isDefault: true,
                  provider: 'clawx-openai-image',
                  configured: true,
                },
              ],
              openAiRelay: {
                enabled: true,
                baseUrl: 'https://api.example.com/v1',
                model: 'gpt-image-2',
                providerKey: 'clawx-openai-image',
                apiKeyConfigured: true,
              },
            },
          },
        },
      },
    });

    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await unlockDeveloperMode(page);

    await expect(page.getByTestId('image-generation-relay-api-key')).toHaveValue('');
    await expect(page.getByLabel(I18N_RESOURCES.en.settings.aiProviders.dialog.apiKey, { exact: true })).toBeVisible();
    await expect(page.getByTestId('image-generation-api-key-status')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-relay-api-key')).toHaveAttribute('placeholder', I18N_RESOURCES.en.settings.aiProviders.dialog.replaceApiKeyHelp);
    await expect(page.getByTestId('image-generation-relay-api-key')).not.toHaveAttribute('placeholder', /[.。]$/);
  });

  test('clears configured image generation settings after confirmation', async ({ electronApp, page }) => {
    const configuredResponse = {
      success: true,
      config: {
        primary: 'clawx-openai-image/gpt-image-2',
        fallbacks: [],
        timeoutMs: 180000,
      },
      autoProviderFallback: false,
      defaultAgentId: 'default',
      agents: [
        {
          id: 'default',
          name: 'Default',
          isDefault: true,
          provider: null,
          configured: false,
        },
      ],
      openAiRelay: {
        enabled: true,
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-image-2',
        providerKey: 'clawx-openai-image',
        apiKeyConfigured: true,
      },
    };
    const clearedResponse = {
      ...configuredResponse,
      config: {
        primary: null,
        fallbacks: [],
        timeoutMs: 180000,
      },
      openAiRelay: {
        enabled: false,
        baseUrl: '',
        model: 'gpt-image-2',
        providerKey: undefined,
        apiKeyConfigured: false,
      },
    };

    await installIpcMocks(electronApp, {
      hostApi: {
        '["/api/media/image-generation","GET"]': {
          ok: true,
          data: { status: 200, ok: true, json: configuredResponse },
        },
        '["/api/media/image-generation","PUT"]': {
          ok: true,
          data: { status: 200, ok: true, json: { success: true, ...clearedResponse } },
        },
      },
    });

    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await unlockDeveloperMode(page);

    await expect(page.getByTestId('image-generation-relay-base-url')).toHaveValue('https://api.example.com/v1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('image-generation-config-dialog')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-summary').getByTestId('image-generation-clear')).toBeEnabled();

    await page.getByTestId('image-generation-clear').click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByTestId('image-generation-config-dialog')).toHaveCount(0);
    await page.getByTestId('image-generation-configure').click();
    await expect(page.getByTestId('image-generation-relay-base-url')).toHaveValue('');
    await expect(page.getByTestId('image-generation-clear')).toHaveCount(0);
  });
});
