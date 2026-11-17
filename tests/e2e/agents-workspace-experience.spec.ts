import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { I18N_RESOURCES } from '../../shared/i18n/resources';
import { settleFloatingSurface } from './fixtures/floating-ui';
import { navigateToSection } from './fixtures/navigation';
import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';

for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
  test(`assistant work style, shared reader and inline models in ${language}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    const text = I18N_RESOURCES[language].agents;
    try {
      // Match the file service's write root on macOS (/var may alias /private/var).
      const userData = await realpath(await app.evaluate(({ app }) => app.getPath('userData')));
      await app.evaluate(({ app }, path) => app.setPath('userData', path), userData);
      const candidate = join(userData, 'assistant-fixture');
      await mkdir(candidate, { recursive: true });
      const root = await realpath(candidate);
      const originalStyle = '# Working style\n\nUse primary sources.\n\nPreserve all existing rules.';
      const plannerStyle = 'Plan the work clearly and keep track of open decisions.';
      for (const id of ['main', 'research', 'planner']) {
        await mkdir(join(root, id), { recursive: true });
        await writeFile(join(root, id, 'SOUL.md'), id === 'planner' ? plannerStyle : originalStyle);
        await writeFile(join(root, id, 'AGENTS.md'), '# Operating rules\n\nVerify important results.');
        await writeFile(join(root, id, 'MEMORY.md'), '# Memory\n\nFixture memory belongs to this assistant.');
      }
      const modelA = 'custom-12345678/model-alpha';
      const modelB = 'custom-12345678/model-beta';
      const agent = (id: string, name: string) => ({ id, name, isDefault: id === 'main', workspace: join(root, id), agentDir: join(root, 'state', id), mainSessionKey: `agent:${id}:main`, modelDisplay: 'model-alpha', modelRef: modelA, overrideModelRef: null, inheritedModel: true, channelTypes: [] });
      const main = agent('main', 'Main Agent');
      const research = agent('research', 'Researcher');
      const planner = { ...agent('planner', 'Planner'), modelRef: modelB, overrideModelRef: modelB, modelDisplay: 'model-beta', inheritedModel: false };
      const snapshot = { success: true, agents: [main, research], defaultAgentId: 'main', defaultModelRef: modelA, configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} };
      const modelSnapshot = { ...snapshot, agents: [{ ...main, modelRef: modelB, overrideModelRef: modelB, modelDisplay: 'model-beta', inheritedModel: false }, research] };
      const key = (module: string, action: string, payload: unknown = null) => JSON.stringify([module, action, payload]);
      await installIpcMocks(app, {
        gatewayStatus: { state: 'stopped', port: 18789 },
        recordHostInvocations: true,
        hostApi: {
          [key('settings', 'getAll')]: { language, theme: 'light', setupComplete: true, chatWorkspacePath: main.workspace },
          [key('agents', 'list')]: snapshot,
          [key('agents', 'updateModel', { id: 'main', modelRef: modelB })]: modelSnapshot,
          [key('agents', 'create', { name: 'Planner', inheritWorkspace: true, instructions: plannerStyle, modelRef: modelB })]: { ...modelSnapshot, agents: [...modelSnapshot.agents, planner] },
          [key('channels', 'accounts')]: { success: true, channels: [{ channelType: 'telegram', defaultAccountId: 'one', status: 'connected', accounts: [{ accountId: 'one', name: 'First', agentId: 'main' }, { accountId: 'two', name: 'Second', agentId: 'main' }, { accountId: 'three', name: 'Third', agentId: 'main' }] }] },
          [key('skills', 'quickAccess', { workspace: main.workspace })]: { success: true, skills: [{ name: 'research', description: 'Use primary sources.', source: 'workspace', sourceLabel: 'Workspace', manifestPath: join(main.workspace, 'SKILL.md'), baseDir: main.workspace }] },
          [key('providers', 'accounts')]: [{ id: 'custom-12345678', vendorId: 'custom', label: 'Research Lab', authMode: 'local', enabled: true, model: 'model-alpha', metadata: { customModels: ['model-alpha', 'model-beta', 'gpt-5.5'] }, updatedAt: '2026-10-31' }],
          [key('providers', 'vendors')]: [{ id: 'custom', name: 'Custom' }],
          [key('providers', 'accountKeyInfo')]: [],
          [key('providers', 'getDefaultAccount')]: { accountId: 'custom-12345678' },
          [key('providers', 'list')]: [],
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await navigateToSection(page, 'agents');
      const card = page.getByTestId('agent-card-main');
      await expect(card).not.toContainText('Use primary sources.');
      await expect(card.getByTestId('agent-model-icon-main')).toBeVisible();
      await expect(card).toContainText(text.settingsDialog.modelLabel);
      await expect(card).toContainText(text.detailTabs.directory);
      await expect(card).toContainText(text.profile.channelsTitle);
      await expect(card).toContainText('First');
      await expect(card).toContainText(text.card.moreAccounts.replace('{{count}}', '1'));
      await expect(card.locator('dd[title]')).toHaveCount(2);
      await expect(card.locator('dd[title]').last()).toHaveAttribute('title', /Third/);
      await expect(card.getByTestId('agent-details-button-main')).toBeVisible();
      await expect(card.getByTestId('agent-start-main')).toBeVisible();
      await expect(card.getByTestId('agent-start-main')).toHaveCSS('font-size', '14px');
      const more = page.getByTestId('agent-menu-research');
      await more.focus();
      await expect(more).toHaveCSS('opacity', '1');
      await more.press('Enter');
      await expect(page.getByTestId('agent-delete-research')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();
      const trigger = page.getByTestId('agent-manage-main');
      await trigger.click();
      const dialog = page.getByTestId('agent-detail-dialog');
      const detailContent = page.getByTestId('agent-detail-content');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(text.settingsDialog.nameLabel)).not.toHaveAttribute('readonly');
      await expect(dialog.getByLabel(text.settingsDialog.nameLabel)).toBeEnabled();
      await expect(dialog.getByTestId('agent-model-picker-button')).toContainText('model-alpha');
      await expect(dialog.getByTestId('agent-model-picker-button')).toContainText('Research Lab');
      await expect(dialog.getByTestId('agent-model-picker-button')).toContainText(/Research Lab\s*\/\s*model-alpha/);
      await expect(dialog.locator('#agent-model-ref')).toHaveCount(0);
      const nameBackground = await dialog.getByLabel(text.settingsDialog.nameLabel).evaluate(el => getComputedStyle(el).backgroundColor);
      await expect(dialog.getByTestId('agent-model-picker-button')).toHaveCSS('background-color', nameBackground);
      const nameColor = await dialog.getByLabel(text.settingsDialog.nameLabel).evaluate(el => getComputedStyle(el).color);
      await expect(dialog.getByText(main.workspace, { exact: true })).toHaveCSS('color', nameColor);
      const nameLabelStyle = await dialog.locator('label[for="agent-settings-name"]').evaluate(el => {
        const style = getComputedStyle(el);
        return { color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight };
      });
      for (const label of [dialog.locator('#agent-model-title'), dialog.getByRole('heading', { name: text.detailTabs.directory })]) {
        await expect(label).toHaveCSS('color', nameLabelStyle.color);
        await expect(label).toHaveCSS('font-size', nameLabelStyle.fontSize);
        await expect(label).toHaveCSS('font-weight', nameLabelStyle.fontWeight);
      }
      const nameLabelBox = await dialog.locator('label[for="agent-settings-name"]').boundingBox();
      const nameInputBox = await dialog.getByLabel(text.settingsDialog.nameLabel).boundingBox();
      const modelLabelBox = await dialog.locator('#agent-model-title').boundingBox();
      const modelInputBox = await dialog.getByTestId('agent-model-picker-button').boundingBox();
      expect(nameInputBox!.x).toBeGreaterThan(nameLabelBox!.x);
      expect(modelInputBox!.x).toBeCloseTo(nameInputBox!.x, 0);
      expect(modelLabelBox!.x).toBeCloseTo(nameLabelBox!.x, 0);
      await expect(dialog.getByTestId('agent-model-legacy-hint')).toBeVisible();
      await expect(dialog.getByTestId('agent-tab-overview')).toHaveAttribute('data-state', 'active');
      await expect(dialog.getByTestId('agent-tab-profile')).toBeVisible();
      await expect(dialog.getByText('Use primary sources.', { exact: true })).not.toBeVisible();
      await expect(dialog.getByRole('heading', { name: text.profile.channelsTitle })).toBeVisible();
      await expect(dialog.getByText('Telegram · First')).toBeVisible();
      await expect(dialog.getByText('Telegram · Second')).toBeVisible();
      expect((await getRecordedHostInvocations(app)).filter(call => call.module === 'agents' && ['create', 'updateModel'].includes(call.action))).toHaveLength(0);
      await dialog.getByTestId('agent-tab-profile').click();
      await expect(dialog.getByRole('heading', { name: text.profile.filesTitle, exact: true })).toBeVisible();
      await expect(dialog).not.toContainText('Preserve all existing rules.');
      const files = dialog.getByRole('region', { name: text.profile.filesTitle });
      const soul = files.getByRole('button', { name: text.profile.viewFile.replace('{{file}}', 'SOUL.md'), exact: true });
      await expect(files.getByRole('button', { name: text.profile.editStyle })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: text.profile.workStyle })).toHaveCount(0);
      await soul.click();
      const reader = page.getByTestId('agent-file-reader');
      await expect(reader.getByTestId('file-preview-filename')).toHaveText('SOUL.md');
      await expect(reader).toContainText('Preserve all existing rules.');
      await page.keyboard.press('Escape');
      await expect(reader).toHaveCount(0);
      await expect(soul).toBeFocused();
      const memory = dialog.getByRole('button', { name: text.profile.viewFile.replace('{{file}}', 'MEMORY.md'), exact: true });
      await memory.scrollIntoViewIfNeeded();
      const previousScroll = await detailContent.evaluate(element => element.scrollTop);
      await memory.click();
      await expect(reader.getByTestId('file-preview-filename')).toHaveText('MEMORY.md');
      await expect(reader).toContainText('Fixture memory belongs to this assistant.');
      await expect(dialog).toHaveAttribute('aria-hidden', 'true');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await reader.getByTestId('file-preview-actions').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(reader).toBeVisible();
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`assistant-file-reader-${language}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(reader).toHaveCount(0);
      await expect(memory).toBeFocused();
      expect(await detailContent.evaluate(element => element.scrollTop)).toBe(previousScroll);
      await dialog.getByTestId('agent-tab-overview').click();
      const modelSelect = dialog.getByTestId('agent-model-picker-button');
      await modelSelect.click();
      const modelMenu = page.getByTestId('agent-model-picker-menu');
      await expect(modelMenu).toHaveCSS('animation-name', 'clawx-floating-in');
      await settleFloatingSurface(modelMenu);
      await expect(modelMenu.getByRole('group', { name: 'Research Lab', exact: true })).toBeVisible();
      await expect(modelMenu.getByRole('menuitemradio')).toHaveText(['model-alpha', 'model-beta', 'gpt-5.5']);
      await expect(modelMenu.getByRole('menuitemradio', { name: 'gpt-5.5', exact: true }).getByTestId('agent-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'openai');
      expect((await modelMenu.getByRole('menuitemradio').first().boundingBox())!.height).toBe(28);
      const triggerId = await modelSelect.getAttribute('id');
      expect(triggerId).toBeTruthy();
      await expect(modelMenu).toHaveAttribute('aria-labelledby', triggerId!);
      await page.keyboard.press('Escape');
      await expect(modelMenu).toHaveCount(0);
      await expect(modelSelect).toBeFocused();
      expect((await getRecordedHostInvocations(app)).filter(call => call.module === 'agents' && call.action === 'updateModel')).toHaveLength(0);
      await modelSelect.press('ArrowDown');
      await settleFloatingSurface(modelMenu);
      await page.keyboard.press('End');
      await expect(modelMenu.getByRole('menuitemradio', { name: 'gpt-5.5', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(modelMenu.getByRole('menuitemradio', { name: 'model-beta', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(modelMenu).toHaveCount(0);
      await expect(modelSelect).toContainText('model-beta');
      await expect(modelSelect).toBeFocused();
      await expect(dialog.getByTestId('agent-model-legacy-hint')).toHaveCount(0);
      expect((await getRecordedHostInvocations(app)).filter(call => call.module === 'agents' && call.action === 'updateModel')).toHaveLength(0);
      await expect(dialog.getByTestId('agent-overview-save')).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await dialog.getByTestId('agent-tab-capabilities').click();
      await expect(dialog.getByTestId('agent-workspace-skills')).toContainText('research');
      await expect(dialog).toContainText(text.detailTabs.permissionsScope);
      await dialog.getByTestId('agent-tab-profile').click();
      await expect(dialog.getByRole('button', { name: text.profile.editStyle, exact: true })).toHaveCSS('font-size', '14px');
      await dialog.getByRole('button', { name: text.profile.editStyle, exact: true }).click();
      const editor = dialog.getByTestId('agent-style-editor');
      await expect(editor).toHaveValue(originalStyle);
      const updatedStyle = '# Working style\n\nInvestigate carefully.\n\nPreserve all existing rules.';
      await editor.fill(updatedStyle);
      await dialog.getByTestId('agent-tab-overview').click();
      await expect(editor).toBeHidden();
      await dialog.getByTestId('agent-tab-profile').click();
      await expect(editor).toHaveValue(updatedStyle);
      if (language === 'en') {
        await writeFile(join(main.workspace, 'SOUL.md'), 'Changed by another editor');
        await dialog.getByRole('button', { name: text.profile.saveStyle, exact: true }).click();
        await expect(editor).toHaveValue(updatedStyle);
        await expect(dialog.getByRole('button', { name: text.profile.reloadStyle, exact: true })).toBeVisible();
        expect(await readFile(join(main.workspace, 'SOUL.md'), 'utf8')).toBe('Changed by another editor');
        await dialog.getByRole('button', { name: text.profile.reloadStyle, exact: true }).click();
        await expect(editor).toHaveValue('Changed by another editor');
        await editor.fill(updatedStyle);
      }
      await dialog.getByRole('button', { name: text.profile.saveStyle, exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(await readFile(join(main.workspace, 'SOUL.md'), 'utf8')).toBe(updatedStyle);
      await expect(dialog).toContainText('Investigate carefully.');
      if (language === 'ru') {
        await page.setViewportSize({ width: 960, height: 650 });
        await page.evaluate(() => document.documentElement.classList.add('dark'));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const bounds = await dialog.boundingBox();
        expect(bounds!.height).toBeLessThanOrEqual(650 * 0.85 + 1);
      }
      await page.screenshot({ path: testInfo.outputPath(`assistant-details-${language}.png`), animations: 'disabled' });
      await dialog.getByTestId('agent-tab-overview').click();
      await expect(modelSelect).toContainText('model-beta');
      await dialog.getByTestId('agent-overview-save').click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect((await getRecordedHostInvocations(app)).some(call => call.module === 'agents' && call.action === 'updateModel' && call.payload?.modelRef === modelB)).toBe(true);
      await expect(card).not.toContainText('Investigate carefully.');
      await page.getByTestId('agents-add-button').click();
      const create = page.getByTestId('add-agent-dialog');
      await expect(create).toHaveCSS('max-width', '576px');
      await expect(create.locator('footer')).toBeVisible();
      await expect(create.locator('footer button[type=submit]')).toHaveAttribute('form', 'create-agent-form');
      await create.getByRole('button', { name: text.profile.close, exact: true }).hover();
      await expect(page.getByRole('tooltip', { name: text.profile.close })).toBeVisible();
      await create.getByLabel(text.createDialog.nameLabel, { exact: true }).fill('Planner');
      await create.getByTestId('agent-create-instructions').fill(plannerStyle);
      const createModel = create.getByTestId('agent-create-model-picker-button');
      await expect(createModel).toContainText('model-beta');
      await expect(createModel).toContainText('Research Lab');
      await expect(createModel).toContainText(/Research Lab\s*\/\s*model-beta/);
      await createModel.click();
      const createMenu = page.getByTestId('agent-create-model-picker-menu');
      await expect(createMenu.getByRole('group', { name: 'Research Lab', exact: true })).toBeVisible();
      await settleFloatingSurface(createMenu);
      const createMenuBounds = await createMenu.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(createMenuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(createMenuBounds!.x + createMenuBounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(createMenuBounds!.y + createMenuBounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.keyboard.press('Escape');
      await expect(createModel).toBeFocused();
      await create.getByRole('switch').click();
      await page.screenshot({ path: testInfo.outputPath(`assistant-create-${language}.png`), animations: 'disabled' });
      await create.getByRole('button', { name: text.createDialog.submit, exact: true }).click();
      await expect(create).toHaveCount(0);
      await expect(page.getByTestId('agent-card-planner')).toContainText('model-beta');
      const calls = await getRecordedHostInvocations(app);
      expect(calls.some(call => call.module === 'agents' && call.action === 'create' && call.payload?.instructions === plannerStyle && call.payload?.inheritWorkspace === true && call.payload?.modelRef === modelB)).toBe(true);
      expect(calls.some(call => call.action === 'sendAcpPrompt')).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`assistants-${language}.png`), animations: 'disabled' });
    } finally { await closeElectronApp(app); }
  });
}
