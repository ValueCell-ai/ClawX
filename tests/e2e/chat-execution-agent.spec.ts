import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

for (const language of ['zh', 'en', 'ja', 'ru']) {
  test(`selects the execution agent before sending and separates main history in ${language}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const defaultAgentId = language === 'ja' ? 'coder' : 'main';
      const agents = ['main', 'coder'].map(id => ({
        id, name: id === 'main' ? 'Main Agent' : 'Coder1', isDefault: id === defaultAgentId,
        workspace: `/tmp/clawx-execution-workspace-${id}`, agentDir: `/tmp/clawx-execution-agents/${id}`,
        mainSessionKey: `agent:${id}:main`, modelDisplay: `model-${id}`,
        modelRef: `custom-${id === 'main' ? 'main1234' : 'coder123'}/model-${id}`, inheritedModel: false,
      }));
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpc: { '["sessions.list",{}]': { success: true, result: { sessions: agents.map(agent => ({ key: agent.mainSessionKey, displayName: `${agent.name} history`, workspacePath: agent.workspace })) } } },
        hostApi: {
          '["/api/settings","GET"]': { language, setupComplete: true, theme: language === 'ru' ? 'dark' : 'light', chatWorkspacePath: agents[0].workspace },
          '["/api/agents","GET"]': { success: true, agents, defaultAgentId, defaultModelRef: agents[0].modelRef },
        },
      });
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        type Request = { id: string; module: string; action: string; payload?: Record<string, unknown> };
        const calls: Request[] = [];
        (globalThis as unknown as { executionAgentCalls: Request[] }).executionAgentCalls = calls;
        const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: Request) => {
          calls.push(request);
          const respond = (data: unknown) => ({ id: request.id, ok: true, data });
          if (request.module === 'chat' && request.action === 'loadAcpSession') return respond({ success: true, generation: 1 });
          if (request.module === 'chat' && request.action === 'sendAcpPrompt') return respond({ success: true, stopReason: 'end_turn' });
          if (request.module === 'skills' && request.action === 'quickAccess') {
            const id = String(request.payload?.workspace).endsWith('-coder') ? 'coder' : 'main';
            return respond({ success: true, skills: [{ name: `${id}-skill`, description: `${id} original skill`, source: 'workspace', sourceLabel: 'Workspace', baseDir: `/tmp/${id}-skill`, manifestPath: `/tmp/${id}-skill/SKILL.md` }] });
          }
          if (request.module === 'dialog' && request.action === 'open') return respond({ canceled: false, filePaths: ['/tmp/clawx-agent-draft.txt'] });
          if (request.module === 'files' && request.action === 'stagePaths') return respond([{ id: 'draft-file', stagedPath: '/tmp/clawx-agent-draft.txt', fileName: 'clawx-agent-draft.txt', fileSize: 12, mimeType: 'text/plain', sourceKind: 'path' }]);
          if (request.module === 'providers' && request.action === 'accounts') return respond(['main', 'coder'].map(id => ({ id: id === 'main' ? 'main1234' : 'coder123', vendorId: 'custom', label: id, authMode: 'api_key', enabled: true, model: `model-${id}`, updatedAt: '2026-10-25' })));
          if (request.module === 'providers' && request.action === 'list') return respond(['main', 'coder'].map(id => ({ id: id === 'main' ? 'main1234' : 'coder123', enabled: true, hasKey: true })));
          if (request.module === 'providers' && request.action === 'accountKeyInfo') return respond(['main1234', 'coder123'].map(accountId => ({ accountId, hasKey: true })));
          if (request.module === 'providers' && request.action === 'vendors') return respond([]);
          if (request.module === 'providers' && request.action === 'getDefaultAccount') return respond({ accountId: 'main1234' });
          return original(event, request);
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      const selector = page.getByTestId('chat-composer-agent');
      const input = page.getByTestId('chat-composer-input');
      await expect(selector).toHaveText('Main Agent');
      await expect(input).toBeEnabled();
      await input.fill('Keep this task draft');
      await page.getByTestId('chat-composer-box').getByRole('button').first().click();
      await expect(page.getByTestId('chat-attachment-remove')).toHaveCount(1);
      const composerBox = page.getByTestId('chat-composer-box');
      const attachmentTray = composerBox.getByTestId('chat-composer-attachments');
      await expect(attachmentTray).toBeVisible();
      const boxBounds = await composerBox.boundingBox();
      const trayBounds = await attachmentTray.boundingBox();
      const inputBounds = await input.boundingBox();
      expect(trayBounds!.x).toBeGreaterThan(boxBounds!.x);
      expect(trayBounds!.x + trayBounds!.width).toBeLessThan(boxBounds!.x + boxBounds!.width);
      expect(trayBounds!.y).toBeGreaterThan(boxBounds!.y);
      expect(trayBounds!.y + trayBounds!.height).toBeLessThan(inputBounds!.y);
      if (language === 'zh') {
        const remove = attachmentTray.getByTestId('chat-attachment-remove');
        const card = remove.locator('..');
        await card.hover();
        await expect(remove).toHaveCSS('opacity', '1');
        const cardBounds = await card.boundingBox();
        const removeBounds = await remove.boundingBox();
        expect(removeBounds!.y).toBeGreaterThan(cardBounds!.y);
        expect(removeBounds!.x + removeBounds!.width).toBeLessThan(cardBounds!.x + cardBounds!.width);
        expect(removeBounds!.y + removeBounds!.height).toBeLessThan(cardBounds!.y + cardBounds!.height);
        await input.focus();
        await remove.focus();
        await expect(remove).toHaveCSS('opacity', '1');
        await expect(remove).toHaveAccessibleName(/clawx-agent-draft.txt/);
        await remove.press('Enter');
        await expect(attachmentTray).toHaveCount(0);
        await expect(input).toHaveValue('Keep this task draft');
        await composerBox.getByRole('button').first().click();
        await expect(attachmentTray).toBeVisible();
      }
      await selector.click();
      await page.getByTestId('chat-agent-option-coder').click();
      await expect(selector).toHaveText('Coder1');
      await expect(input).toHaveValue('Keep this task draft');
      await expect(page.getByTestId('chat-attachment-remove')).toHaveCount(1);
      await expect(page.getByTestId('chat-workspace-selector')).toContainText('clawx-execution-workspace-coder');
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText('model-coder');
      await expect(page.getByText('@Main Agent', { exact: true })).toHaveCount(0);
      await selector.click();
      await expect(page.getByTestId('chat-agent-option-coder')).toHaveAttribute('aria-current', 'true');
      await expect(page.getByTestId('chat-agent-open-main')).toHaveCount(0);
      await expect(page.getByTestId('chat-agent-picker-menu').getByRole('menuitemradio')).toHaveCount(2);
      const menuLabels = { zh: ['选择 Agent', '默认模型：model-coder'], en: ['Choose Agent', 'Default model: model-coder'], ja: ['Agent を選択', '既定のモデル：model-coder'], ru: ['Выбрать агента', 'Модель по умолчанию: model-coder'] };
      const [menuTitle, modelLabel] = menuLabels[language as keyof typeof menuLabels];
      await expect(page.getByTestId('chat-agent-picker-menu').getByText(menuTitle, { exact: true })).toBeVisible();
      await expect(page.getByTestId('chat-agent-option-coder')).toContainText(modelLabel);
      await page.keyboard.press('Escape');
      await page.getByTestId('chat-composer-skill').click();
      await expect(page.getByTestId('chat-composer-skill-option-coder-skill')).toBeVisible();
      await expect(page.getByTestId('chat-composer-skill-option-main-skill')).toHaveCount(0);
      await page.keyboard.press('Escape');
      const getCalls = () => app.evaluate(() => (globalThis as unknown as { executionAgentCalls: Array<{ module: string; action: string; payload?: Record<string, unknown> }> }).executionAgentCalls);
      expect((await getCalls()).filter(call => call.action === 'sendAcpPrompt')).toHaveLength(0);
      await page.screenshot({ path: testInfo.outputPath('agent-selected.png') });
      await expect(page.getByTestId('chat-composer-send')).toBeEnabled();
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(async () => (await getCalls()).filter(call => call.action === 'sendAcpPrompt').length).toBe(1);
      const sent = (await getCalls()).find(call => call.action === 'sendAcpPrompt')!.payload!;
      expect(sent.sessionKey).toMatch(/^agent:coder:session-\d+$/);
      expect(sent.cwd).toBe('/tmp/clawx-execution-workspace-coder');
      expect(sent.message).toBe('Keep this task draft');
      expect(sent.media).toEqual([expect.objectContaining({ filePath: '/tmp/clawx-agent-draft.txt' })]);
      const coderBadge = page.getByTestId(`sidebar-session-agent-${sent.sessionKey}`);
      const mainBadge = page.getByTestId('sidebar-session-agent-agent:main:main');
      if (defaultAgentId === 'coder') {
        await expect(coderBadge).toHaveCount(0);
        await expect(mainBadge).toHaveText('Main Agent');
      } else {
        await expect(coderBadge).toHaveText('Coder1');
        await expect(mainBadge).toHaveCount(0);
      }
      await expect(page.getByTestId('sidebar-session-agent:main:main')).toHaveAttribute('title', /Main Agent/);
      await expect(input).toHaveValue('');
      await expect(attachmentTray).toHaveCount(0);
      await expect(selector).toBeEnabled();
      await selector.click();
      await expect(page.getByTestId('chat-agent-open-main')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.getByTestId('sidebar-session-agent:coder:main').click();
      await expect(page.getByTestId('sidebar-session-agent:coder:main')).toHaveAttribute('aria-current', 'page');
      expect((await getCalls()).filter(call => call.action === 'sendAcpPrompt')).toHaveLength(1);
      await page.getByTestId('sidebar-session-agent:main:main').click();
      await expect(selector).toHaveText('Main Agent');
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText('model-main');
      await page.setViewportSize({ width: 700, height: 800 });
      await expect(selector).toBeInViewport();
      await expect(page.getByTestId('chat-composer-send')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
}
