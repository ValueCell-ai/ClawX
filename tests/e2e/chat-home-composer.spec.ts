import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const skillNames = ['docx', 'xlsx', 'pptx', 'pdf'];
const locales = [
  { language: 'zh', heading: '今天想完成什么？', labels: ['文档处理', '表格分析', '演示文稿', 'PDF 工具'] },
  { language: 'en', heading: 'What would you like to get done?', labels: ['Documents', 'Spreadsheets', 'Presentations', 'PDF tools'] },
  { language: 'ja', heading: '今日は何を進めましょうか？', labels: ['文書作成', '表計算', 'プレゼン資料', 'PDF ツール'] },
  { language: 'ru', heading: 'Что хотите сделать сегодня?', labels: ['Документы', 'Таблицы', 'Презентации', 'PDF'] },
];

for (const locale of locales) {
  test(`home composer supports skill drafts and layout in ${locale.language}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const availableSkills = locale.language === 'ru' ? ['docx', 'xlsx', 'pdf'] : skillNames;
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpc: { '["sessions.list",{}]': { success: true, result: { sessions: [] } } },
        hostApi: {
          '["/api/settings","GET"]': { language: locale.language, setupComplete: true, devModeUnlocked: true, theme: locale.language === 'ru' ? 'dark' : 'light' },
          '["/api/agents","GET"]': {
            success: true,
            agents: [{ id: 'main', name: 'Main', workspace: '~/.openclaw/workspace', mainSessionKey: 'agent:main:main', modelRef: 'custom-alpha123/model-alpha' }],
            defaultAgentId: 'main', defaultModelRef: 'custom-alpha123/model-alpha',
          },
          '["/api/skills/quick-access","POST"]': {
            success: true,
            skills: availableSkills.map(name => ({ name, description: name, source: 'openclaw', sourceLabel: 'OpenClaw', manifestPath: `/tmp/skills/${name}/SKILL.md`, baseDir: `/tmp/skills/${name}` })),
          },
        },
      });
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        type Request = { id: string; module: string; action: string; payload?: Record<string, unknown> };
        const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
        const prompts: unknown[] = [];
        let releaseSkills!: () => void;
        const skillsReady = new Promise<void>(resolve => { releaseSkills = resolve; });
        const skillGate = { requests: 0, release: () => releaseSkills() };
        (globalThis as unknown as { homeSkillGate: typeof skillGate }).homeSkillGate = skillGate;
        (globalThis as unknown as { homeTestPrompts: unknown[] }).homeTestPrompts = prompts;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: Request) => {
          if (request.module === 'skills' && request.action === 'quickAccess') {
            skillGate.requests += 1;
            await skillsReady;
          }
          const respond = (data: unknown) => ({ id: request.id, ok: true, data });
          if (request.module === 'chat' && request.action === 'loadAcpSession') return respond({ success: true, generation: 1 });
          if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
            prompts.push(request.payload);
            return respond({ success: true, stopReason: 'end_turn' });
          }
          if (request.module === 'providers' && request.action === 'accounts') {
            return respond(['alpha123', 'beta123'].map(id => ({ id, vendorId: 'custom', label: id, authMode: 'api_key', model: `model-${id === 'alpha123' ? 'alpha' : 'beta'}`, enabled: true, baseUrl: 'http://localhost:1111/v1' })));
          }
          if (request.module === 'providers' && request.action === 'list') {
            return respond(['alpha123', 'beta123'].map(id => ({ id, type: 'custom', name: id, enabled: true, hasKey: true })));
          }
          if (request.module === 'providers' && request.action === 'accountKeyInfo') {
            return respond(['alpha123', 'beta123'].map(accountId => ({ accountId, hasKey: true })));
          }
          if (request.module === 'providers' && request.action === 'vendors') return respond([]);
          if (request.module === 'providers' && request.action === 'getDefaultAccount') return respond({ accountId: 'alpha123' });
          return original(event, request);
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId('sidebar-new-chat').click();
      const input = page.getByTestId('chat-composer-input');
      const heading = page.getByRole('heading', { name: locale.heading });
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS('font-weight', '500');
      await expect(heading).toHaveCSS('letter-spacing', 'normal');
      expect(await heading.evaluate(element => getComputedStyle(element).fontFamily)).not.toContain('Georgia');
      await expect(input).toBeEnabled();
      for (const name of skillNames) {
        await expect(page.getByTestId(`chat-home-skill-${name}`)).toBeVisible();
        await expect(page.getByTestId(`chat-home-skill-${name}`)).toBeDisabled();
      }
      const loadingBounds = await page.getByTestId('chat-home-skills').boundingBox();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { homeSkillGate: { requests: number } }).homeSkillGate.requests)).toBeGreaterThan(0);
      await app.evaluate(() => (globalThis as unknown as { homeSkillGate: { release: () => void } }).homeSkillGate.release());
      await expect(page.getByTestId('chat-home-skill-docx')).toBeEnabled();
      expect(await page.getByTestId('chat-home-skills').boundingBox()).toEqual(loadingBounds);
      const requestsBeforeNewChat = await app.evaluate(() => (globalThis as unknown as { homeSkillGate: { requests: number } }).homeSkillGate.requests);
      // New drafts reuse the same resolved catalog, without another Host request.
      await page.getByTestId('sidebar-new-chat').click();
      await expect(page.getByTestId('chat-home-skill-docx')).toBeEnabled();
      expect(await app.evaluate(() => (globalThis as unknown as { homeSkillGate: { requests: number } }).homeSkillGate.requests)).toBe(requestsBeforeNewChat);
      for (const [index, name] of skillNames.entries()) {
        const shortcut = page.getByTestId(`chat-home-skill-${name}`);
        if (!availableSkills.includes(name)) { await expect(shortcut).toBeVisible(); await expect(shortcut).toBeDisabled(); continue; }
        await expect(shortcut).toHaveText(locale.labels[index]);
        await input.fill('Keep my draft');
        await shortcut.click();
        await expect(input).toHaveValue(`/${name}  Keep my draft`);
        await expect(input).toBeFocused();
        await shortcut.click();
        await expect(input).toHaveValue(`/${name}  Keep my draft`);
      }
      expect(await app.evaluate(() => (globalThis as unknown as { homeTestPrompts: unknown[] }).homeTestPrompts)).toEqual([]);
      const box = await page.getByTestId('chat-composer-box').boundingBox();
      const footer = await page.getByTestId('chat-composer-footer').boundingBox();
      const firstShortcut = await page.getByTestId('chat-home-skill-docx').boundingBox();
      const skillRow = await page.getByTestId('chat-home-skills').boundingBox();
      expect(firstShortcut!.height).toBeLessThanOrEqual(32);
      expect(Math.abs(firstShortcut!.x - box!.x)).toBeLessThanOrEqual(2);
      expect(box!.y - skillRow!.y - skillRow!.height).toBeLessThanOrEqual(14);
      const content = await page.getByTestId('chat-content-layout').boundingBox();
      expect(footer!.height).toBeLessThanOrEqual(34);
      expect(Math.abs(footer!.y - (box!.y + box!.height))).toBeLessThan(2);
      expect(box!.y).toBeGreaterThan(content!.y + content!.height * 0.2);
      expect(footer!.y + footer!.height).toBeLessThan(content!.y + content!.height * 0.85);
      const welcomeBounds = await page.getByTestId('acp-chat-empty-state').boundingBox();
      const welcomeCenter = (welcomeBounds!.y + footer!.y + footer!.height) / 2;
      expect(welcomeCenter).toBeLessThan(content!.y + content!.height / 2 - 16);
      expect(welcomeCenter).toBeGreaterThan(content!.y + content!.height / 2 - 80);
      const model = page.getByTestId('chat-model-picker-button');
      const voice = page.getByTestId('chat-composer-voice');
      await expect(model).toBeVisible();
      await expect(voice).toBeVisible();
      expect((await model.boundingBox())!.x).toBeLessThan((await voice.boundingBox())!.x);
      await page.getByTestId('chat-workspace-selector').click();
      await expect(page.getByTestId('chat-workspace-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await model.click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.screenshot({ path: testInfo.outputPath('home.png') });
      // Narrow windows must retain the skill controls, model, dictation and footer.
      await page.setViewportSize({ width: 900, height: 650 });
      await expect(page.getByTestId('chat-home-skill-docx')).toBeInViewport();
      await expect(page.getByTestId('chat-composer-send')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('home-narrow.png') });
      await input.fill('A test task');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('acp-chat-empty-state')).toHaveCount(0);
      await expect(input).toHaveValue('');
      await input.fill('Next draft');
      await expect(input).toHaveValue('Next draft');
      const bottomFooter = await page.getByTestId('chat-composer-footer').boundingBox();
      expect(bottomFooter!.y).toBeGreaterThan(500);
      const chatBounds = await page.getByTestId('chat-content-layout').boundingBox();
      const bottomGap = chatBounds!.y + chatBounds!.height - bottomFooter!.y - bottomFooter!.height;
      expect(bottomGap).toBeGreaterThanOrEqual(8);
      expect(bottomGap).toBeLessThanOrEqual(14);
      await page.screenshot({ path: testInfo.outputPath('conversation-compact.png') });
    } finally {
      await closeElectronApp(app);
    }
  });
}
