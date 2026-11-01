import { I18N_RESOURCES } from '../../shared/i18n/resources';
import { navigateToSection } from './fixtures/navigation';
import { expectQuietFieldFocus } from './fixtures/field-focus';
import { settleFloatingSurface } from './fixtures/floating-ui';
import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stableKey(item)}`).join(',')}}`;
}

for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
  test(`models show real defaults and consistent configuration, preserving usage browsing in ${language}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    const text = I18N_RESOURCES[language];
    const accountId = 'custom-alpha123';
    const key = (module: string, action: string, payload: unknown = null) => stableKey([module, action, payload]);
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        recordHostInvocations: true,
        hostApi: {
          [key('settings', 'getAll')]: { language, setupComplete: true, devModeUnlocked: true, theme: 'light' },
          [key('providers', 'accounts')]: [
            { id: accountId, vendorId: 'custom', label: 'Work API', baseUrl: 'https://work.example/v1', metadata: { customModels: ['model-alpha', 'model-beta', 'gpt-5.5'] }, enabled: true, authMode: 'api_key', updatedAt: '2026-11-01' },
            { id: 'custom-beta1234', vendorId: 'custom', label: 'Other API', baseUrl: 'https://other.example/v1', model: 'model-other', enabled: true, authMode: 'api_key', updatedAt: '2026-11-01' },
          ],
          [key('providers', 'accountKeyInfo')]: [{ accountId, hasKey: true }, { accountId: 'custom-beta1234', hasKey: true }],
          [key('providers', 'getDefaultAccount')]: { accountId: 'custom-beta1234' },
          [key('providers', 'setDefaultModel', { accountId, modelId: 'model-beta' })]: { success: true, modelRef: `${accountId}/model-beta` },
          [key('providers', 'setDefaultModel', { accountId, modelId: 'model-alpha' })]: { success: false, error: 'Model write rejected' },
          [key('providers', 'vendors')]: [],
          [key('agents', 'list')]: { success: true, agents: [], defaultAgentId: 'main', defaultModelRef: `${accountId}/model-alpha` },
          [key('asr', 'getConfig')]: { configured: false, config: null, hasApiKey: false },
          [key('media', 'imageGenerationSettings')]: {
            success: true, config: { primary: 'clawx-openai-image/gpt-image-2', fallbacks: [], timeoutMs: 180000 }, defaultAgentId: 'main',
            openAiRelay: { enabled: true, baseUrl: 'https://images.example/v1', model: 'gpt-image-2', apiKeyConfigured: true, providerKey: 'clawx-openai-image' },
            agents: [{ id: 'main', name: 'Main Agent', isDefault: true, provider: 'clawx-openai-image', configured: true }],
          },
          [key('usage', 'recentTokenHistory', { limit: undefined })]: Array.from({ length: 11 }, (_, index) => ({
            sessionId: `layout-${index}`, timestamp: new Date(Date.now() - index * 60000).toISOString(), model: `test-model-${index}`, provider: 'Test', agentId: 'main',
            inputTokens: 120, outputTokens: 30, cacheReadTokens: 10, cacheWriteTokens: 5, totalTokens: 165, costUsd: 0.0123, content: `Usage detail ${index}`,
            usageStatus: index === 1 ? 'missing' : index === 2 ? 'error' : 'available',
          })),
        },
      });
      await app.evaluate(({ app: _app }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<{ data?: Record<string, unknown> }>> })._invokeHandlers;
        const original = handlers.get('host:invoke')!;
        let globalModel = 'custom-alpha123/model-alpha';
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request) => {
          const response = await original(event, request);
          if (request.module === 'providers' && request.action === 'setDefaultModel' && response.data?.success) globalModel = String(response.data.modelRef);
          if (request.module === 'agents' && request.action === 'list' && response.data) response.data.defaultModelRef = globalModel;
          return response;
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      await navigateToSection(page, 'models');
      const table = page.getByTestId('token-usage-table');
      await expect(table).toHaveCount(0);
      for (const tab of ['chat', 'voice', 'image-generation', 'usage']) await expect(page.getByTestId(`models-tab-${tab}`).locator('svg')).toBeVisible();
      await expect(page.getByTestId('models-default-value')).toContainText('model-alpha');
      await expect(page.getByTestId(`provider-set-default-${accountId}`)).toHaveCount(0);
      const card = page.getByTestId(`provider-card-${accountId}`);
      await expect(card).toContainText('work.example');
      await expect(card).toContainText('model-beta');
      expect((await card.boundingBox())!.height).toBeLessThan(110);
      await page.screenshot({ path: testInfo.outputPath(`model-services-${language}.png`), animations: 'disabled' });

      const more = page.getByTestId(`provider-more-${accountId}`);
      await more.click();
      await page.getByTestId(`provider-edit-${accountId}`).click();
      const edit = page.getByTestId(`provider-edit-dialog-${accountId}`);
      await expect(edit).toHaveAccessibleName(text.settings.modelManagement.editService);
      const configuredModels = edit.getByRole('list', { name: text.settings.aiProviders.dialog.configuredModels, exact: true });
      await expect(configuredModels.getByRole('listitem')).toHaveText(['model-alpha', 'model-beta', 'gpt-5.5']);
      await expect(edit.locator('input[id$="-model"]')).toHaveCount(0);
      await expect(page.getByTestId('models-default-value')).toContainText('model-alpha');
      await expect(edit.getByTestId(`provider-edit-key-input-${accountId}`)).toHaveValue('');
      await expect(edit.getByTestId(`provider-edit-cancel-${accountId}`)).toHaveAccessibleName(text.settings.aiProviders.dialog.cancel);
      await edit.getByLabel(text.settings.aiProviders.dialog.displayName, { exact: true }).fill('Renamed API');
      await page.screenshot({ path: testInfo.outputPath(`model-edit-${language}.png`), animations: 'disabled' });
      await edit.getByTestId(`provider-edit-cancel-${accountId}`).click();
      await expect(edit).toHaveCount(0);
      await expect(more).toBeFocused();
      await expect(card).toContainText('Work API');

      const add = page.getByTestId('providers-add-button');
      await add.click();
      await page.getByTestId('add-provider-type-custom').click();
      const dialog = page.getByTestId('add-provider-dialog');
      await expect(dialog.getByTestId('add-provider-model-id-input')).toBeEnabled();
      await expect(dialog.getByTestId('add-provider-model-id-input')).toHaveAccessibleDescription(text.settings.aiProviders.dialog.singleModelHint);
      await expect(dialog.getByTestId('add-provider-base-url-input')).toHaveCSS('height', '36px');
      await dialog.getByTestId('add-provider-base-url-input').focus();
      await expectQuietFieldFocus(dialog.getByTestId('add-provider-base-url-input'));
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(add).toBeFocused();

      const globalDefault = page.getByTestId('global-model-picker-button');
      await globalDefault.click();
      const globalMenu = page.getByTestId('global-model-picker-menu');
      const globalTriggerId = await globalDefault.getAttribute('id');
      expect(globalTriggerId).toBeTruthy();
      await expect(globalMenu).toHaveAttribute('aria-labelledby', globalTriggerId!);
      await expect(globalMenu).toHaveCSS('animation-name', 'clawx-floating-in');
      await settleFloatingSurface(globalMenu);
      const workModels = globalMenu.getByRole('group', { name: 'Work API', exact: true });
      await expect(globalMenu.getByText('Work API', { exact: true })).toHaveCount(1);
      await expect(workModels.getByRole('menuitemradio')).toHaveText(['model-alpha', 'model-beta', 'gpt-5.5']);
      await expect(workModels.getByRole('menuitemradio', { name: 'gpt-5.5', exact: true }).getByTestId('global-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'openai');
      await expect(globalDefault.getByTestId('global-model-picker-current-icon')).toBeVisible();
      expect((await workModels.getByRole('menuitemradio').first().boundingBox())!.height).toBe(28);
      await page.screenshot({ path: testInfo.outputPath(`global-model-picker-${language}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(globalMenu).toHaveCount(0);
      await expect(globalDefault).toBeFocused();
      await globalDefault.click();
      await page.getByRole('heading', { level: 1 }).click();
      await expect(globalMenu).toHaveCount(0);
      await globalDefault.press('ArrowDown');
      await expect(globalMenu).toBeVisible();
      await page.keyboard.press('End');
      await expect(workModels.getByRole('menuitemradio', { name: 'gpt-5.5', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(workModels.getByRole('menuitemradio', { name: 'model-beta', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(globalDefault).toContainText('model-beta');
      await expect(globalDefault).toBeEnabled();
      await expect(globalDefault).toBeFocused();
      await globalDefault.click();
      await page.getByRole('menuitemradio', { name: 'model-alpha', exact: true }).click();
      await expect(page.getByText(/Model write rejected/)).toBeVisible();
      await expect(globalDefault).toContainText('model-beta');
      await expect(globalDefault).toBeFocused();
      expect((await getRecordedHostInvocations(app)).filter(call => call.module === 'agents' && call.action === 'updateModel')).toHaveLength(0);

      await page.getByTestId('models-tab-voice').click();
      await expect(page.getByTestId('asr-summary')).toContainText(text.settings.modelManagement.needsConfiguration);
      await expect(page.getByTestId('asr-model-input')).toHaveCount(0);
      const voiceConfigure = page.getByTestId('asr-configure');
      await voiceConfigure.click();
      const voiceDialog = page.getByTestId('asr-config-dialog');
      await expect(voiceDialog).toBeVisible();
      await expect(voiceDialog.getByTestId('asr-base-url-input')).not.toBeVisible();
      await voiceDialog.getByTestId('asr-preset-select').click();
      await page.getByRole('option', { name: text.settings.asr.presets.bailian, exact: true }).click();
      await expect(voiceDialog.getByTestId('asr-model-input')).toHaveValue('qwen3-asr-flash');
      await voiceDialog.locator('summary').click();
      await expect(voiceDialog.getByTestId('asr-protocol-select')).toHaveAttribute('value', 'chat');
      await page.keyboard.press('Escape');
      await expect(voiceDialog).toHaveCount(0);
      await expect(voiceConfigure).toBeFocused();

      await page.getByTestId('models-tab-image-generation').click();
      await expect(page.getByTestId('image-generation-summary')).toContainText('gpt-image-2');
      await page.getByTestId('image-generation-configure').click();
      const imageDialog = page.getByTestId('image-generation-config-dialog');
      await expect(imageDialog.getByTestId('image-generation-save')).toBeDisabled();
      await expect(imageDialog.getByTestId('image-generation-relay-api-key')).toHaveValue('');
      await expect(imageDialog.getByTestId('image-generation-agent-auth-table')).not.toBeVisible();
      await imageDialog.locator('summary').click();
      await expect(imageDialog.getByTestId('image-generation-agent-row-main')).toContainText(text.dashboard.imageGeneration.authConfigured);
      await page.keyboard.press('Escape');
      await expect(imageDialog).toHaveCount(0);

      await page.getByTestId('models-tab-usage').click();
      await expect(table).toBeVisible();
      const rows = table.getByTestId('token-usage-entry');
      await expect(rows).toHaveCount(10);
      await expect(rows.nth(1)).toContainText('—');
      await expect(rows.nth(2)).toContainText('✕');
      await page.getByRole('button', { name: text.dashboard.recentTokenHistory.next, exact: true }).click();
      await expect(rows.first()).toContainText('test-model-10');
      const callsBefore = (await getRecordedHostInvocations(app)).filter(call => call.module === 'usage').length;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(async () => (await getRecordedHostInvocations(app)).filter(call => call.module === 'usage').length).toBeGreaterThan(callsBefore);
      await expect(rows.first()).toContainText('test-model-10');
      const contentButton = rows.first().getByRole('button', { name: text.dashboard.recentTokenHistory.viewContent, exact: true });
      await contentButton.click();
      const contentDialog = page.getByTestId('usage-content-dialog');
      await expect(contentDialog).toHaveAccessibleName(text.dashboard.recentTokenHistory.contentDialogTitle);
      await expect(contentDialog).toContainText('Usage detail 10');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="usage-content-dialog"]'))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(contentDialog).toHaveCount(0);
      await expect(contentButton).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`model-usage-${language}.png`), animations: 'disabled' });
      await page.setViewportSize({ width: 900, height: 650 });
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.getByTestId('models-tab-chat').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await globalDefault.click();
      const menuBounds = await globalMenu.boundingBox();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(900);
      expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(650);
      await expect(globalMenu.getByRole('menuitemradio', { name: 'gpt-5.5', exact: true })).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(globalDefault).toBeFocused();
      await page.getByTestId('models-tab-image-generation').click();
      await page.getByTestId('image-generation-configure').click();
      const bounds = await imageDialog.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(650 * 0.85 + 1);
      await expect(imageDialog.getByTestId('image-generation-save')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`model-config-narrow-${language}.png`), animations: 'disabled' });
    } finally { await closeElectronApp(app); }
  });
}
