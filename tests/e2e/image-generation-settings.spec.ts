import { expect, installIpcMocks, test } from './fixtures/electron';

test.describe('Image generation settings page', () => {
  async function unlockDeveloperMode(page: import('@playwright/test').Page) {
    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('sidebar-nav-image-generation')).toBeVisible();
  }

  test('shows image generation only as a developer-mode page after skipping setup', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-image-generation')).toHaveCount(0);

    await unlockDeveloperMode(page);
    await page.getByTestId('sidebar-nav-image-generation').click();

    await expect(page.getByTestId('image-generation-page')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings')).toBeVisible();
    await expect(page.getByTestId('image-generation-settings-title')).toBeVisible();
    await expect(page.getByTestId('image-generation-relay-enabled')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-relay-model')).toBeVisible();
    await expect(page.getByTestId('image-generation-openai-relay')).toBeVisible();
    await expect(page.getByTestId('image-generation-auto-sync')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-primary')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-fallbacks')).toHaveCount(0);
    await expect(page.getByTestId('image-generation-save')).toBeVisible();
    await expect(page.getByTestId('image-generation-clear')).toBeDisabled();
  });

  test('configures an independent OpenAI-compatible image endpoint', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await unlockDeveloperMode(page);
    await page.getByTestId('sidebar-nav-image-generation').click();

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
    await page.getByTestId('sidebar-nav-image-generation').click();

    await expect(page.getByTestId('image-generation-relay-api-key')).toHaveValue('');
    await expect(page.getByTestId('image-generation-api-key-status')).not.toBeEmpty();
    await expect(page.getByTestId('image-generation-relay-api-key')).toHaveAttribute('placeholder', /.+/);
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
    await page.getByTestId('sidebar-nav-image-generation').click();

    await expect(page.getByTestId('image-generation-relay-base-url')).toHaveValue('https://api.example.com/v1');
    await expect(page.getByTestId('image-generation-clear')).toBeEnabled();

    await page.getByTestId('image-generation-clear').click();
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Clear', exact: true }).click();

    await expect(page.getByTestId('image-generation-relay-base-url')).toHaveValue('');
    await expect(page.getByTestId('image-generation-clear')).toBeDisabled();
  });
});
