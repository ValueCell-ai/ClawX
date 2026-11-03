import { I18N_RESOURCES } from '../../shared/i18n/resources';
import { navigateToSection } from './fixtures/navigation';
import { expectQuietFieldFocus } from './fixtures/field-focus';
import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stableKey(item)}`).join(',')}}`;
}

for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
  test(`models show a provider catalog without defaults, preserving configuration and usage browsing in ${language}`, async ({ launchElectronApp }, testInfo) => {
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
      const page = await getStableWindow(app);
      await page.reload();
      await navigateToSection(page, 'models');
      const table = page.getByTestId('token-usage-table');
      await expect(table).toHaveCount(0);
      for (const tab of ['chat', 'voice', 'image-generation', 'usage']) await expect(page.getByTestId(`models-tab-${tab}`).locator('svg')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('providers-settings-description')).toHaveText(text.settings.aiProviders.description);
      await expect(page.getByTestId('providers-settings-description')).toHaveCSS('font-size', '14px');
      await expect(page.getByTestId('models-default-summary')).toHaveCount(0);
      await expect(page.getByTestId('global-model-picker-button')).toHaveCount(0);
      await expect(page.getByTestId(`provider-set-default-${accountId}`)).toHaveCount(0);
      const card = page.getByTestId(`provider-card-${accountId}`);
      await expect(card).toContainText('work.example');
      await expect(card).toContainText('model-beta');
      expect((await card.boundingBox())!.height).toBeLessThan(110);
      await page.screenshot({ path: testInfo.outputPath(`model-services-${language}.png`), animations: 'disabled' });

      await expect(page.getByTestId(`provider-more-${accountId}`)).toHaveCount(0);
      const editTrigger = page.getByTestId(`provider-edit-${accountId}`);
      const deleteTrigger = page.getByTestId(`provider-delete-${accountId}`);
      await expect(editTrigger).toBeVisible();
      await expect(deleteTrigger).toBeVisible();
      await expect(editTrigger).toHaveAccessibleName(text.settings.aiProviders.card.editKey);
      await expect(deleteTrigger).toHaveAccessibleName(text.settings.aiProviders.card.delete);
      await page.getByTestId('models-page-title').hover();
      await editTrigger.hover();
      const editTooltip = page.getByRole('tooltip', { name: text.settings.aiProviders.card.editKey, exact: true });
      await expect(editTooltip).toBeVisible();
      await deleteTrigger.hover();
      await expect(page.getByRole('tooltip', { name: text.settings.aiProviders.card.delete, exact: true })).toBeVisible();
      await expect(editTooltip).toHaveCount(0);
      await editTrigger.focus();
      await editTrigger.press('Enter');
      const edit = page.getByTestId(`provider-edit-dialog-${accountId}`);
      await expect(edit).toHaveAccessibleName(text.settings.modelManagement.editService);
      const configuredModels = edit.getByRole('list', { name: text.settings.aiProviders.dialog.configuredModels, exact: true });
      await expect(configuredModels.getByRole('listitem')).toHaveText(['model-alpha', 'model-beta', 'gpt-5.5']);
      await expect(configuredModels).not.toHaveAttribute('aria-describedby');
      await expect(edit.getByTestId(`provider-edit-key-status-${accountId}`)).toHaveCount(0);
      await expect(edit.locator('input[id$="-model"]')).toHaveCount(0);
      await expect(page.getByTestId('models-default-summary')).toHaveCount(0);
      await expect(page.getByTestId('global-model-picker-button')).toHaveCount(0);
      await expect(edit.getByTestId(`provider-edit-key-input-${accountId}`)).toHaveValue('');
      await expect(edit.getByTestId(`provider-edit-cancel-${accountId}`)).toHaveAccessibleName(text.settings.aiProviders.dialog.cancel);
      await edit.getByLabel(text.settings.aiProviders.dialog.displayName, { exact: true }).fill('Renamed API');
      await page.screenshot({ path: testInfo.outputPath(`model-edit-${language}.png`), animations: 'disabled' });
      await edit.getByTestId(`provider-edit-cancel-${accountId}`).click();
      await expect(edit).toHaveCount(0);
      await expect(editTrigger).toBeFocused();
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

      const browsingCalls = await getRecordedHostInvocations(app);
      expect(browsingCalls.filter(call => call.module === 'agents' && ['create', 'updateModel'].includes(call.action))).toHaveLength(0);
      expect(browsingCalls.filter(call => call.module === 'providers' && ['setDefaultModel', 'setDefaultAccount', 'setDefault'].includes(call.action))).toHaveLength(0);

      await page.getByTestId('models-tab-voice').click();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('asr-settings-description')).toHaveText(text.settings.modelManagement.voiceDescription);
      await expect(page.getByTestId('asr-summary')).toContainText(text.settings.modelManagement.needsConfiguration);
      await expect(page.getByTestId('asr-model-input')).toHaveCount(0);
      const voiceConfigure = page.getByTestId('asr-summary').getByTestId('asr-configure');
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
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('image-generation-settings-description')).toHaveText(text.settings.modelManagement.imageDescription);
      await expect(page.getByTestId('image-generation-summary')).toContainText('gpt-image-2');
      await page.screenshot({ path: testInfo.outputPath(`model-image-summary-${language}.png`), animations: 'disabled' });
      await page.getByTestId('image-generation-summary').getByTestId('image-generation-configure').click();
      const imageDialog = page.getByTestId('image-generation-config-dialog');
      await expect(imageDialog.getByTestId('image-generation-save')).toBeDisabled();
      await expect(imageDialog.getByTestId('image-generation-relay-api-key')).toHaveValue('');
      await expect(imageDialog.getByTestId('image-generation-agent-auth-table')).not.toBeVisible();
      await imageDialog.locator('summary').click();
      await expect(imageDialog.getByTestId('image-generation-agent-row-main')).toContainText(text.dashboard.imageGeneration.authConfigured);
      await page.keyboard.press('Escape');
      await expect(imageDialog).toHaveCount(0);

      await page.getByTestId('models-tab-usage').click();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('models-usage-description')).toHaveText(text.dashboard.recentTokenHistory.sourceHint);
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
      await page.getByTestId('models-tab-image-generation').click();
      await expect(page.getByTestId('image-generation-settings-description')).toBeVisible();
      await expect(page.getByTestId('image-generation-summary').getByTestId('image-generation-configure')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByTestId('image-generation-configure').click();
      const bounds = await imageDialog.boundingBox();
      expect(bounds!.height).toBeLessThanOrEqual(650 * 0.85 + 1);
      await expect(imageDialog.getByTestId('image-generation-save')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`model-config-narrow-${language}.png`), animations: 'disabled' });
    } finally { await closeElectronApp(app); }
  });
}
