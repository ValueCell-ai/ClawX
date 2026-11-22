import { I18N_RESOURCES } from '../../shared/i18n/resources';
import type { Locator } from '@playwright/test';
import { navigateToSection } from './fixtures/navigation';
import { expectQuietFieldFocus } from './fixtures/field-focus';
import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stableKey(item)}`).join(',')}}`;
}

function modelDialogBounds(dialog: Locator) {
  const actions = dialog.locator('footer').getByRole('button');
  return Promise.all([dialog.boundingBox(), actions.first().boundingBox(), actions.last().boundingBox()]);
}

test('keeps usage filters available when the selected time window is empty', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const key = (module: string, action: string, payload: unknown = null) => stableKey([module, action, payload]);
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      hostApi: {
        [key('settings', 'getAll')]: { language: 'en', setupComplete: true, theme: 'light' },
        [key('usage', 'recentTokenHistory', { limit: undefined })]: [{
          sessionId: 'old-usage', timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), model: 'older-model', provider: 'Test', agentId: 'main',
          inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15,
        }],
      },
    });
    const page = await getStableWindow(app);
    await page.reload();
    await navigateToSection(page, 'models');
    await page.getByTestId('models-tab-usage').click();
    const labels = I18N_RESOURCES.en.dashboard.recentTokenHistory;
    await expect(page.getByText(labels.emptyForWindow)).toBeVisible();
    await page.getByRole('button', { name: labels.viewLast30Days, exact: true }).click();
    await expect(page.getByRole('button', { name: labels.last30Days, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('token-usage-table')).toContainText('older-model');
  } finally {
    await closeElectronApp(app);
  }
});

test('keeps chart controls independent from usage details and fits the table in a narrow window', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  const labels = I18N_RESOURCES.en.dashboard.recentTokenHistory;
  const key = (module: string, action: string, payload: unknown = null) => stableKey([module, action, payload]);
  const now = new Date(2026, 10, 22, 12).getTime();
  const entries = Array.from({ length: 12 }, (_, index) => {
    const totalTokens = index === 0 ? 1_000_000 : index === 11 ? 101 : 200;
    return {
      sessionId: `usage-${index}`,
      timestamp: new Date(now - (index === 11 ? 3 * 24 * 60 * 60_000 : index * 60_000)).toISOString(),
      model: index === 0 ? 'glm-5.3-flash' : 'gpt-test-shared',
      provider: index === 11 ? 'Other API' : 'Work API',
      agentId: 'main',
      inputTokens: totalTokens - 25,
      outputTokens: 10,
      cacheReadTokens: 12,
      cacheWriteTokens: 3,
      totalTokens,
      costUsd: 0.0142,
      content: `Usage detail ${index}`,
    };
  });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      hostApi: {
        [key('settings', 'getAll')]: { language: 'en', setupComplete: true, devModeUnlocked: true, theme: 'light' },
        [key('usage', 'recentTokenHistory', { limit: undefined })]: entries,
      },
    });
    const page = await getStableWindow(app);
    await page.reload();
    await page.clock.setFixedTime(new Date(now + 1_000));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigateToSection(page, 'models');
    await page.getByTestId('models-tab-usage').click();

    const table = page.getByTestId('token-usage-table');
    const rows = table.getByTestId('token-usage-entry');
    const chart = page.getByRole('group', { name: labels.chart });
    const firstMode = chart.getByRole('button').first();
    await expect(firstMode).toHaveText(labels.groupByTime);
    await expect(firstMode).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('usage-time-chart')).toBeVisible();
    await expect(rows.first().locator('[data-model-icon="zai"]')).toBeVisible();
    await chart.getByRole('button', { name: labels.groupByModel, exact: true }).click();
    await expect(page.getByTestId('usage-model-chart').locator('[data-model-icon="zai"]')).toBeVisible();
    const bars = page.getByTestId('usage-model-bar');
    await expect(bars).toHaveCount(3);
    const widths = await bars.evaluateAll((items) => items.map((item) => Number.parseFloat((item as HTMLElement).style.width)));
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeCloseTo(0.2, 5);
    expect(widths[2]).toBeCloseTo(0.0101, 5);

    await page.setViewportSize({ width: 1280, height: 800 });
    const range = page.getByRole('group', { name: labels.timeRange });
    const usageSummary = page.getByTestId('usage-summary');
    await expect(usageSummary.getByTitle('1,002,101', { exact: true })).toHaveText('1 M');
    await expect(usageSummary.getByTitle('120', { exact: true })).toHaveText('< 0.01 M');
    const [rangeBounds, summaryBounds] = await Promise.all([range.boundingBox(), usageSummary.boundingBox()]);
    expect(summaryBounds!.x).toBeGreaterThan(rangeBounds!.x + rangeBounds!.width);
    expect(summaryBounds!.y + summaryBounds!.height / 2).toBeCloseTo(rangeBounds!.y + rangeBounds!.height / 2, 0);

    await page.setViewportSize({ width: 760, height: 650 });
    await expect(usageSummary).toBeInViewport({ ratio: 1 });
    const narrowBounds = await usageSummary.boundingBox();
    expect(narrowBounds!.y).toBeGreaterThan((await range.boundingBox())!.y);
    const tabScroller = page.getByTestId('models-content-scroll');
    const main = page.getByTestId('main-content');
    await expect.poll(() => tabScroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    const nextPage = page.getByRole('button', { name: labels.next, exact: true });
    await nextPage.scrollIntoViewIfNeeded();
    await expect(nextPage).toBeInViewport();
    expect(await tabScroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await main.evaluate((el) => el.scrollTop)).toBe(0);
    await nextPage.click();
    await expect(rows).toHaveCount(2);
    const secondPage = await rows.allTextContents();
    await page.getByRole('button', { name: labels.groupByTime, exact: true }).click();
    const dateBuckets = page.getByTestId('usage-time-bucket');
    await expect(dateBuckets).toHaveCount(8);
    await expect(page.locator('[data-testid="usage-time-bucket"][data-tokens="0"]')).not.toHaveCount(0);
    expect(await rows.allTextContents()).toEqual(secondPage);

    const summary = await usageSummary.textContent();
    const filter = page.getByTestId('usage-model-filter-button');
    const menu = page.getByTestId('usage-model-filter-menu');
    await expect(filter).toHaveAccessibleName(labels.allModels);
    await filter.press('Enter');
    const allModels = menu.getByRole('menuitemradio', { name: labels.allModels, exact: true });
    await expect(allModels).toHaveAttribute('aria-checked', 'true');
    await expect(allModels.locator('[data-slot="menu-selection-indicator"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(filter).toBeFocused();
    await filter.click();
    const otherModel = menu.getByRole('group', { name: 'Other API', exact: true })
      .getByRole('menuitemradio', { name: 'gpt-test-shared', exact: true });
    await expect(menu.getByRole('group', { name: 'Work API', exact: true })
      .getByRole('menuitemradio', { name: 'gpt-test-shared', exact: true })).toBeVisible();
    await expect(otherModel.locator('[data-model-icon="openai"]')).toBeVisible();
    await otherModel.click();
    await expect(filter.locator('[data-model-icon="openai"]')).toBeVisible();
    await expect(filter).toHaveAccessibleName('Other API / gpt-test-shared');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Other API');
    await expect(usageSummary).toHaveText(summary!);

    await expect(table.getByRole('columnheader', { name: labels.columns.total, exact: true })).toBeVisible();
    const costHelp = table.getByRole('columnheader', { name: labels.columns.cost, exact: true })
      .getByRole('button', { name: labels.costHelp, exact: true });
    const costHint = page.getByRole('tooltip', { name: labels.costHint, exact: true });
    await expect(page.getByText(labels.costHint, { exact: true })).toHaveCount(0);
    await costHelp.hover();
    await expect(costHint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(costHint).toBeHidden();
    await costHelp.focus();
    await expect(costHint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(costHint).toBeHidden();
    await expect(table.getByRole('columnheader', { name: labels.columns.cacheRead, exact: true })).toHaveCount(0);
    const viewContent = rows.first().getByRole('button', { name: labels.viewContent });
    await viewContent.scrollIntoViewIfNeeded();
    await expect(viewContent).toBeInViewport({ ratio: 1 });
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const price = rows.first().getByRole('cell', { name: '$0.0142', exact: true });
    expect(await price.evaluate((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getClientRects().length;
    })).toBe(1);

    const breakdown = rows.first().getByRole('button', { name: `${labels.columns.total} · 101` });
    await breakdown.click();
    await expect(page.getByRole('dialog', { name: labels.columns.total }).getByText(labels.columns.cacheRead, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(breakdown).toBeFocused();
    await viewContent.click();
    await expect(page.getByTestId('usage-content-dialog')).toContainText('Usage detail 11');
    await page.keyboard.press('Escape');
    await expect(viewContent).toBeFocused();
    await page.getByTestId('models-page-title').click();
    await page.screenshot({ path: testInfo.outputPath('usage-narrow.png'), animations: 'disabled' });
    await filter.click();
    await expect(otherModel).toHaveAttribute('aria-checked', 'true');
    await allModels.click();
    await expect(filter).toHaveAccessibleName(labels.allModels);
    await expect(rows).toHaveCount(10);
  } finally {
    await closeElectronApp(app);
  }
});

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
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await navigateToSection(page, 'models');
      const table = page.getByTestId('token-usage-table');
      await expect(table).toHaveCount(0);
      for (const tab of ['chat', 'voice', 'image-generation', 'usage']) await expect(page.getByTestId(`models-tab-${tab}`).locator('svg')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('providers-settings-description')).toHaveText(text.settings.aiProviders.description);
      await expect(page.getByTestId('providers-settings-description')).toHaveCSS('font-size', '14px');
      await expect(page.getByTestId('providers-add-button')).toHaveCSS('font-size', '14px');
      await expect(page.getByTestId('models-default-summary')).toHaveCount(0);
      await expect(page.getByTestId('global-model-picker-button')).toHaveCount(0);
      await expect(page.getByTestId(`provider-set-default-${accountId}`)).toHaveCount(0);
      const card = page.getByTestId(`provider-card-${accountId}`);
      const providerGroup = card.locator('..');
      await expect(providerGroup).toHaveCSS('padding-left', '16px');
      await expect(providerGroup).toHaveCSS('padding-right', '16px');
      const groupBox = await providerGroup.boundingBox();
      const rowBox = await card.boundingBox();
      expect(rowBox!.x - groupBox!.x).toBeCloseTo(17, 0);
      expect(groupBox!.x + groupBox!.width - rowBox!.x - rowBox!.width).toBeCloseTo(17, 0);
      await expect(card).toContainText('work.example');
      await expect(card).toContainText('model-beta');
      expect((await card.boundingBox())!.height).toBeLessThan(110);
      await page.screenshot({ path: testInfo.outputPath(`model-services-${language}.png`), animations: 'disabled' });

      await expect(page.getByTestId(`provider-more-${accountId}`)).toHaveCount(0);
      const edit = page.getByTestId(`provider-edit-dialog-${accountId}`);
      await expect(card.getByRole('button', { name: 'Work API', exact: true })).toHaveCount(0);
      await card.getByText('Work API', { exact: true }).click();
      await expect(edit).toHaveCount(0);
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
      await edit.getByText(text.settings.aiProviders.dialog.advancedConfig, { exact: true }).click();
      await expect(edit.getByLabel(text.settings.aiProviders.dialog.userAgent, { exact: true }))
        .toHaveAttribute('placeholder', text.settings.aiProviders.dialog.userAgentPlaceholder);
      await edit.getByTestId(`provider-edit-cancel-${accountId}`).click();
      await expect(edit).toHaveCount(0);
      await expect(editTrigger).toBeFocused();
      await expect(card).toContainText('Work API');

      const add = page.getByTestId('providers-add-button');
      await add.click();
      const dialog = page.getByTestId('add-provider-dialog');
      await expect(dialog).toHaveAccessibleName(text.settings.aiProviders.dialog.title);
      await expect(dialog).not.toHaveAttribute('aria-describedby');
      const customService = dialog.getByTestId('add-provider-type-custom');
      const availableServices = dialog.getByTestId('add-provider-catalog');
      await expect(availableServices.getByTestId('add-provider-type-openai')).toBeVisible();
      await customService.focus();
      await customService.press('Enter');
      await expect(customService).toHaveAttribute('aria-pressed', 'true');
      await expect(customService).toBeFocused();
      await expect(availableServices.getByTestId('add-provider-type-openai')).toBeVisible();
      await expect(dialog).not.toHaveAttribute('aria-describedby');
      await expect(dialog.getByText(text.settings.aiProviders.dialog.apiKeyStored, { exact: true })).toHaveCount(0);
      await expect(dialog.getByTestId('add-provider-model-id-input')).toBeEnabled();
      await expect(dialog.getByTestId('add-provider-model-id-input')).toHaveAccessibleDescription(text.settings.aiProviders.dialog.singleModelHint);
      await expect(dialog.getByTestId('add-provider-base-url-input')).toHaveCSS('height', '36px');
      await dialog.getByTestId('add-provider-base-url-input').focus();
      await expectQuietFieldFocus(dialog.getByTestId('add-provider-base-url-input'));
      await dialog.getByRole('button', { name: text.settings.aiProviders.dialog.advancedConfig, exact: true }).click();
      await expect(dialog.getByLabel(text.settings.aiProviders.dialog.userAgent, { exact: true }))
        .toHaveAttribute('placeholder', text.settings.aiProviders.dialog.userAgentPlaceholder);
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
      await expect(voiceConfigure).toHaveText(text.settings.modelManagement.configure);
      await voiceConfigure.click();
      const voiceDialog = page.getByTestId('asr-config-dialog');
      await expect(voiceDialog).toBeVisible();
      await expect(voiceDialog.getByTestId('asr-base-url-input')).toBeVisible();
      await expect(voiceDialog.getByTestId('asr-protocol-hint')).toContainText(text.settings.asr.protocol.transcriptions);
      const protocolHint = voiceDialog.getByTestId('asr-protocol-hint');
      const urlLabel = voiceDialog.getByText(text.settings.aiProviders.dialog.baseUrl, { exact: true });
      const urlInput = voiceDialog.getByTestId('asr-base-url-input');
      await expect(protocolHint.locator('dt')).toHaveCSS('font-size', await urlLabel.evaluate(node => getComputedStyle(node).fontSize));
      await expect(protocolHint.locator('dt')).toHaveCSS('color', await urlLabel.evaluate(node => getComputedStyle(node).color));
      await expect(protocolHint.locator('dd')).toHaveCSS('font-size', await urlInput.evaluate(node => getComputedStyle(node).fontSize));
      await expect(protocolHint.locator('dd')).toHaveCSS('color', await urlInput.evaluate(node => getComputedStyle(node).color));
      const [protocolBounds, urlFieldBounds] = await Promise.all([protocolHint.boundingBox(), urlLabel.locator('..').boundingBox()]);
      expect(urlFieldBounds!.y - (protocolBounds!.y + protocolBounds!.height)).toBeCloseTo(16, 0);
      const voiceServices = voiceDialog.getByTestId('asr-config-services');
      const groqOption = voiceDialog.getByTestId('asr-preset-groq');
      const groqIcon = groqOption.locator('img');
      await expect(groqIcon).toBeVisible();
      const groqIconSource = await groqIcon.getAttribute('src');
      expect(decodeURIComponent(groqIconSource!)).toContain('<title>Groq</title>');
      await groqOption.click();
      await expect(voiceDialog.getByTestId('asr-config-details').locator('img')).toHaveAttribute('src', groqIconSource!);
      const bailian = voiceServices.getByRole('button', { name: text.settings.asr.presets.bailian, exact: true });
      const voiceBounds = await modelDialogBounds(voiceDialog);
      expect(voiceBounds[1]!.width).toBeCloseTo(voiceBounds[2]!.width, 0);
      await bailian.click();
      await expect(bailian).toHaveAttribute('aria-pressed', 'true');
      await expect(voiceDialog.getByTestId('asr-model-input')).toHaveValue('qwen3-asr-flash');
      await expect(voiceDialog.getByTestId('asr-protocol-hint')).toContainText(text.settings.asr.protocol.chat);
      await expect(voiceDialog.getByTestId('asr-protocol-select')).toHaveCount(0);
      expect(await modelDialogBounds(voiceDialog)).toEqual(voiceBounds);
      await page.keyboard.press('Escape');
      await expect(voiceDialog).toHaveCount(0);
      await expect(voiceConfigure).toBeFocused();

      await page.getByTestId('models-tab-image-generation').click();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 })).toHaveCount(0);
      await expect(page.getByTestId('image-generation-settings-description')).toHaveText(text.settings.modelManagement.imageDescription);
      await expect(page.getByTestId('image-generation-summary')).toContainText('gpt-image-2');
      await expect(page.getByTestId('image-generation-model-icon')).toBeVisible();
      await expect(page.getByTestId('image-generation-summary')).not.toContainText(text.settings.modelManagement.configured);
      const imageEdit = page.getByTestId('image-generation-configure');
      await expect(imageEdit).toHaveAccessibleName(text.settings.modelManagement.editConfiguration);
      await expect(imageEdit).toHaveText('');
      await imageEdit.hover();
      await expect(page.getByRole('tooltip')).toContainText(text.settings.modelManagement.editConfiguration);
      await page.screenshot({ path: testInfo.outputPath(`model-image-summary-${language}.png`), animations: 'disabled' });
      await page.getByTestId('image-generation-summary').getByTestId('image-generation-configure').click();
      const imageDialog = page.getByTestId('image-generation-config-dialog');
      await expect(imageDialog.getByTestId('image-generation-save')).toBeDisabled();
      await expect(imageDialog.getByTestId('image-generation-endpoint-section')).toHaveAttribute('aria-pressed', 'true');
      await expect(imageDialog.getByTestId('image-generation-relay-api-key')).toHaveValue('');
      await expect(imageDialog.getByTestId('image-generation-agent-auth-table')).toHaveCount(0);
      const imageBounds = await modelDialogBounds(imageDialog);
      expect(imageBounds[1]!.width).toBeCloseTo(imageBounds[2]!.width, 0);
      expect(imageBounds[0]).toEqual(voiceBounds[0]);
      await imageDialog.getByTestId('image-generation-advanced').click();
      await expect(imageDialog.getByTestId('image-generation-agent-auth-table')).toHaveCount(0);
      await expect(imageDialog.getByTestId('image-generation-test-agent')).toBeVisible();
      expect(await modelDialogBounds(imageDialog)).toEqual(imageBounds);
      await page.keyboard.press('Escape');
      await expect(imageDialog).toHaveCount(0);

      await page.getByTestId('models-tab-usage').click();
      await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2, name: text.dashboard.recentTokenHistory.details })).toBeVisible();
      await expect(page.getByTestId('usage-summary')).toContainText(text.dashboard.recentTokenHistory.totalTokens);
      await expect(table.getByRole('columnheader', { name: text.dashboard.recentTokenHistory.columns.cost, exact: true })
        .getByRole('button', { name: text.dashboard.recentTokenHistory.costHelp, exact: true })).toBeVisible();
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
