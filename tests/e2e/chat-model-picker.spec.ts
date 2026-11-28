import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { settleFloatingSurface } from './fixtures/floating-ui';

const alphaModelRef = 'custom-alpha123/model-alpha';
const betaModelRef = 'custom-beta5678/provider/model-beta';

test.describe('ClawX chat model picker', () => {
  test('keeps model selections independent across conversations and workspaces', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        const reviewerKey = 'agent:reviewer:primary';
        const sessionModels = new Map<string, string>([[reviewerKey, refs.betaModelRef]]);
        let catalogUnavailable = false;
        const sessionLevels = new Map<string, string>();
        const profile = (modelRef?: string, selectedLevel?: string) => {
          if (modelRef?.endsWith('/model-beta-lite')) return undefined;
          return {
            levels: modelRef?.endsWith('/deepseek-v4.1-flash-1017')
              ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(id => ({ id, label: id }))
              : modelRef === refs.betaModelRef ? [{ id: 'high', label: 'on' }] : [
                { id: 'off', label: 'off' }, { id: 'high', label: 'high' }, { id: 'adaptive', label: 'adaptive' },
              ],
            defaultLevel: modelRef === refs.betaModelRef ? 'high' : 'off',
            selectedLevel,
          };
        };
        const hostRequests: Array<{ path: string; method: string; body: unknown }> = [];
        const now = new Date().toISOString();
        let releaseProviderAccounts: (() => void) | undefined;
        const providerAccountsReady = new Promise<void>((resolve) => {
          releaseProviderAccounts = resolve;
        });
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        const workspacePath = '/tmp/clawx-model-picker-workspace';
        const sessions = [
          { key: 'agent:main:main', displayName: 'First chat', workspacePath },
          { key: 'agent:main:sibling', displayName: 'Sibling chat', workspacePath },
          { key: 'agent:main:other', displayName: 'Other workspace chat', workspacePath: `${workspacePath}-other` },
          { key: reviewerKey, displayName: 'Reviewer chat', workspacePath: `${workspacePath}-review` },
        ];
        const agentsSnapshot = () => ({
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            isDefault: true,
            modelDisplay: 'model-alpha',
            modelRef: refs.alphaModelRef,
            overrideModelRef: refs.alphaModelRef,
            inheritedModel: false,
            workspace: workspacePath,
            agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          }, {
            id: 'reviewer',
            name: 'Reviewer',
            modelDisplay: 'gpt-5.6',
            modelRef: 'openai/gpt-5.6',
            workspace: workspacePath,
            mainSessionKey: reviewerKey,
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.alphaModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, params: unknown) => {
          hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params ?? null });
          if (method === 'sessions.list') {
            if (catalogUnavailable) return { success: false, error: 'Session catalog not ready' };
            return { success: true, result: { sessions } };
          }
          return { success: true, result: {} };
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? null;
          hostRequests.push({
            path: `${request?.module ?? ''}:${request?.action ?? ''}`,
            method: 'HOST',
            body,
          });

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'settings' && request.action === 'getAll') {
            return makeResponse(request.id, {
              language: 'en',
              setupComplete: true,
              chatWorkspacePath: workspacePath,
              recentWorkspacePaths: [workspacePath],
            });
          }
          if (request?.module === 'files' && request.action === 'resolveWorkspaceContext') {
            const workspaceRoot = typeof body?.workspaceRoot === 'string' ? body.workspaceRoot.trim() : '';
            const executionCwd = typeof body?.executionCwd === 'string' ? body.executionCwd.trim() : '';
            if (!workspaceRoot || !executionCwd) {
              return makeResponse(request.id, { ok: false, error: 'outsideSandbox' });
            }
            return makeResponse(request.id, { ok: true, workspaceRoot, executionCwd });
          }
          if (request?.module === 'chat' && request.action === 'loadAcpSession') {
            return makeResponse(request.id, { success: true, generation: 1 });
          }
          if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
            return makeResponse(request.id, { success: true, generation: 1 });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body?.method === 'string' ? body.method : '';
            const params = body?.params ?? null;
            hostRequests.push({ path: `gateway:${method}`, method: 'RPC', body: params });
            if (method === 'sessions.list') {
              if (catalogUnavailable) return {
                id: request.id, ok: false, error: { code: 'INTERNAL', message: 'Session catalog not ready' },
              };
              return makeResponse(request.id, { sessions });
            }
            return makeResponse(request.id, {});
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'sessions' && request.action === 'getDraftThinking') {
            return makeResponse(request.id, profile(String(body?.modelRef)) ?? null);
          }
          if (request?.module === 'sessions' && request.action === 'getModel') {
            const key = String(body?.sessionKey);
            return makeResponse(request.id, {
              modelRef: sessionModels.get(key) ?? null, thinking: profile(sessionModels.get(key), sessionLevels.get(key)),
            });
          }
          if (request?.module === 'sessions' && request.action === 'setModel') {
            if ((globalThis as typeof globalThis & { __modelAdmissionPending?: boolean }).__modelAdmissionPending) {
              return { id: request.id, ok: false, error: {
                code: 'INTERNAL', message: 'Gateway is still preparing agents. Please wait before switching models.',
              } };
            }
            const key = String(body?.sessionKey);
            if (catalogUnavailable) {
              if (!body?.createIfMissing) return {
                id: request.id, ok: false, error: { code: 'INTERNAL', message: 'Session no longer exists' },
              };
              catalogUnavailable = false;
              sessions.push({ key, displayName: 'Use my selection for this first turn.', workspacePath });
            }
            if (typeof body?.modelRef === 'string') sessionModels.set(key, body.modelRef);
            else if (body?.modelRef === null) sessionModels.delete(key);
            if (typeof body?.thinkingLevel === 'string') sessionLevels.set(key, body.thinkingLevel);
            else if (body?.thinkingLevel === null) sessionLevels.delete(key);
            return makeResponse(request.id, {
              modelRef: sessionModels.get(key) ?? null, thinking: profile(sessionModels.get(key), sessionLevels.get(key)),
            });
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            await providerAccountsReady;
            return makeResponse(request.id, [
              {
                id: 'alpha1234',
                vendorId: 'custom',
                label: 'Alpha',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1',
                model: 'model-alpha',
                metadata: { customModels: ['model-alpha', 'deepseek-v4.1-flash-1017'] },
                enabled: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'beta5678',
                vendorId: 'custom',
                label: 'Beta',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1',
                model: refs.betaModelRef,
                metadata: { customModels: [refs.betaModelRef, 'model-beta-lite', 'model-alpha'] },
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'openai-oauth',
                vendorId: 'openai',
                label: 'OpenAI',
                authMode: 'oauth_browser',
                model: 'openai/gpt-5.6',
                metadata: { customModels: ['gpt-5.5', 'openai/gpt-5.6'] },
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'moonshot-api-key',
                vendorId: 'moonshot',
                label: 'Moonshot',
                authMode: 'api_key',
                model: 'moonshot/kimi-k2.7',
                metadata: { customModels: ['kimi-k2.6', 'moonshot/kimi-k2.7'] },
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'alpha1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'beta5678', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'moonshot-api-key', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, [
              { id: 'openai', name: 'OpenAI', supportedAuthModes: ['api_key', 'oauth_browser'] },
              { id: 'moonshot', name: 'Moonshot', supportedAuthModes: ['api_key'] },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'alpha1234' });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & { __chatModelPickerRequests?: typeof hostRequests }).__chatModelPickerRequests = hostRequests;
        (globalThis as typeof globalThis & {
          __releaseChatModelProviders?: () => void;
        }).__releaseChatModelProviders = releaseProviderAccounts;
        (globalThis as typeof globalThis & {
          __makeSessionCatalogUnavailable?: () => void;
        }).__makeSessionCatalogUnavailable = () => {
          catalogUnavailable = true;
          hostRequests.length = 0;
        };
      }, { alphaModelRef, betaModelRef });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string }>;
        }).__chatModelPickerRequests?.some((request) => request.path === 'providers:accounts') ?? false
      ))).toBe(true);
      expect(await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string }>;
        }).__chatModelPickerRequests?.some((request) => request.path === 'agents:updateModel') ?? false
      ))).toBe(false);
      await app.evaluate(() => {
        (globalThis as typeof globalThis & {
          __releaseChatModelProviders?: () => void;
        }).__releaseChatModelProviders?.();
      });
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      await page.getByTestId('sidebar-session-agent:main:main').click();
      const picker = page.getByTestId('chat-model-picker-button');
      await expect(picker).toHaveText(/model-alpha/);
      await expect(picker).not.toContainText('Alpha');
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'fallback');
      await test.step('uses a background highlight and stable text colors on composer controls', async () => {
        const composer = page.getByTestId('chat-composer-box');
        const controls = [
          composer.getByRole('button', { name: 'Attach files', exact: true }),
          composer.getByTestId('chat-composer-agent'),
          composer.getByTestId('chat-composer-skill'),
          picker,
        ];
        const dark = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
        const hoverBackground = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
        for (const control of controls) {
          await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          const restingColor = await control.evaluate((element) => getComputedStyle(element).color);
          await expect.poll(async () => {
            await control.hover();
            return control.evaluate((element) => {
              const { backgroundColor, color } = getComputedStyle(element);
              return { backgroundColor, color };
            });
          }).toEqual({ backgroundColor: hoverBackground, color: restingColor });
        }
        await page.locator('html').evaluate((element) => element.classList.toggle('dark'));
        await expect(picker).toHaveCSS('background-color', dark ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.1)');
        await page.locator('html').evaluate((element, originalDark) => element.classList.toggle('dark', originalDark), dark);
      });
      await picker.click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-follow-agent')).toHaveCount(0);
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('Follow Agent');
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('provider/model-beta');
      const modelMenu = page.getByTestId('chat-model-picker-menu');
      const triggerId = await picker.getAttribute('id');
      expect(triggerId).toBeTruthy();
      await expect(modelMenu).toHaveAttribute('aria-labelledby', triggerId!);
      const strength = modelMenu.getByRole('group', { name: 'Thinking strength' });
      const strengthLabel = strength.getByTestId('chat-model-picker-thinking-label');
      const slider = strength.getByRole('slider', { name: 'Thinking strength' });
      const resetThinking = strength.getByRole('button', { name: 'Restore default', exact: true });
      await expect(slider).toBeVisible();
      await expect(resetThinking).toBeDisabled();
      await expect(resetThinking).toHaveText('');
      await expect(resetThinking.locator('svg')).toBeVisible();
      await expect(picker).toContainText('Off');
      await settleFloatingSurface(modelMenu);
      const strengthBounds = await strength.boundingBox();
      const modelScroll = modelMenu.getByRole('listbox');
      const scrollGeometry = await modelScroll.evaluate(element => ({
        gutter: element.offsetWidth - element.clientWidth,
        overflows: element.scrollHeight > element.clientHeight,
        clientWidth: element.clientWidth,
      }));
      expect(scrollGeometry.overflows).toBe(true);
      expect(scrollGeometry.gutter).toBeLessThanOrEqual(6);
      await modelScroll.hover();
      expect(await modelScroll.evaluate(element => element.clientWidth)).toBe(scrollGeometry.clientWidth);
      await page.mouse.wheel(0, 160);
      await expect.poll(() => modelScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect((await strength.boundingBox())!.y).toBeCloseTo(strengthBounds!.y, 0);
      await modelScroll.evaluate(element => { element.scrollTop = 0; });
      await test.step('keeps the open panel and its slider inside a narrow window', async () => {
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        try {
          await page.setViewportSize({ width: 960, height: 620 });
          await expect.poll(() => modelMenu.evaluate(element => {
            const panel = element.getBoundingClientRect();
            const thumb = element.querySelector('input[type="range"]')?.getBoundingClientRect();
            return panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight
              && !!thumb && thumb.bottom <= panel.bottom;
          })).toBe(true);
        } finally {
          await page.setViewportSize(viewport);
        }
      });
      const alphaGroup = modelMenu.getByRole('group', { name: 'Alpha', exact: true });
      const betaGroup = modelMenu.getByRole('group', { name: 'Beta', exact: true });
      const alphaOption = alphaGroup.getByRole('option', { name: 'model-alpha', exact: true });
      const betaOption = betaGroup.getByRole('option', { name: 'provider/model-beta', exact: true });
      const secondaryColor = await strengthLabel.evaluate(element => getComputedStyle(element).color);
      await expect(strength.getByText('Thinking strength', { exact: true })).toHaveCSS('color', secondaryColor);
      expect(await alphaOption.evaluate(element => getComputedStyle(element).color)).not.toBe(secondaryColor);
      await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
      await expect(modelScroll.getByRole('group')).toHaveCount(4);
      await expect(modelMenu.getByText('Beta', { exact: true })).toHaveCount(1);
      await expect(betaGroup.getByRole('option')).toHaveText(['provider/model-beta', 'model-beta-lite', 'model-alpha']);
      await expect(alphaGroup.getByRole('option', { name: 'model-alpha', exact: true })).toBeVisible();
      await expect(betaGroup.getByRole('option', { name: 'model-alpha', exact: true })).toBeVisible();
      await expect(betaGroup.getByRole('option')).not.toContainText(['Beta', 'Beta', 'Beta']);
      const betaOptions = betaGroup.getByRole('option');
      const firstBeta = await betaOptions.nth(0).boundingBox();
      const secondBeta = await betaOptions.nth(1).boundingBox();
      expect(firstBeta!.height).toBe(28);
      expect(secondBeta!.height).toBe(28);
      expect(secondBeta!.y - firstBeta!.y - firstBeta!.height).toBeCloseTo(4, 0);
      const alphaBounds = await alphaGroup.boundingBox();
      const betaBounds = await betaGroup.boundingBox();
      expect(betaBounds!.y - alphaBounds!.y - alphaBounds!.height).toBeCloseTo(8, 0);
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('provider/model-beta (Beta)');
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('gpt-5.6');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('gpt-5.5');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('openai/gpt-5.6');
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('kimi-k2.7');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('kimi-k2.6');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('moonshot/kimi-k2.7');
      const gptOption = page.getByTestId('chat-model-picker-menu').getByRole('option', { name: 'gpt-5.6', exact: true });
      await expect(gptOption.getByTestId('chat-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'openai');
      const kimiOption = page.getByTestId('chat-model-picker-menu').getByRole('option', { name: 'kimi-k2.7', exact: true });
      await expect(kimiOption.getByTestId('chat-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'kimi');
      await alphaOption.press('k');
      await expect(kimiOption).toBeFocused();
      await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
      // Selecting the effective default pins that concrete model to this session.
      await alphaOption.click();
      await expect.poll(() => app.evaluate((_electron, modelRef) => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string; body: { sessionKey?: string; modelRef?: string | null } | null }>;
        }).__chatModelPickerRequests?.some((request) => request.path === 'sessions:setModel'
          && request.body?.sessionKey === 'agent:main:main'
          && request.body.modelRef === modelRef) ?? false
      ), alphaModelRef)).toBe(true);
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/model-alpha/);
      await expect(modelMenu).toHaveAttribute('data-state', 'open');
      await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __modelAdmissionPending?: boolean }).__modelAdmissionPending = true;
      });
      await gptOption.click();
      await expect(page.getByText(/Failed to switch model:.*Gateway is still preparing agents/)).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/model-alpha/);
      expect(await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string }>;
        }).__chatModelPickerRequests?.some((request) => request.path === 'agents:updateModel') ?? false
      ))).toBe(false);
      await app.evaluate(() => {
        (globalThis as typeof globalThis & { __modelAdmissionPending?: boolean }).__modelAdmissionPending = false;
      });
      await expect(modelMenu).toHaveAttribute('data-state', 'open');
      await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
      await expect(gptOption).toHaveAttribute('aria-selected', 'false');
      await gptOption.click();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/gpt-5.6/);
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'openai');
      await expect(modelMenu).toHaveAttribute('data-state', 'open');
      await test.step('keeps the model list open for a model without thinking levels', async () => {
        await betaGroup.getByRole('option', { name: 'model-beta-lite', exact: true }).click();
        await expect(picker).toHaveText('model-beta-lite');
        await expect(strength).toHaveCount(0);
        await expect(modelMenu).toHaveAttribute('data-state', 'open');
      });
      await test.step('switches a DeepSeek Flash session from max to off', async () => {
        await alphaGroup.getByRole('option', { name: 'deepseek-v4.1-flash-1017', exact: true }).press('Enter');
        await expect(slider).toHaveAttribute('max', '7');
        await slider.press('End');
        await expect(picker).toContainText('Ultra');
        await slider.press('ArrowLeft');
        await expect(picker).toContainText('Max');
        await slider.press('Home');
        await expect(picker).toContainText('Off');
        await expect(modelMenu).toHaveAttribute('data-state', 'open');
      });
      await betaGroup.getByRole('option', { name: 'model-alpha', exact: true }).click();
      await expect(picker).toContainText('model-alpha');
      await expect(betaGroup.getByRole('option', { name: 'model-alpha', exact: true })).toHaveAttribute('aria-current', 'true');
      await expect(alphaGroup.getByRole('option', { name: 'model-alpha', exact: true })).not.toHaveAttribute('aria-current', 'true');
      await betaOption.click();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/provider\/model-beta/);
      await expect(page.getByTestId('chat-model-picker-button')).not.toContainText('Beta');
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'fallback');

      await expect(slider).toHaveCount(0);
      await strength.getByRole('button', { name: 'On', exact: true }).click();
      await expect(strengthLabel).toHaveText('On');
      await page.keyboard.press('Escape');
      await expect(modelMenu).toBeHidden();
      await expect(page.getByTestId('chat-composer-input')).toBeFocused();

      for (const sibling of ['sibling', 'other']) {
        await page.getByTestId(`sidebar-session-agent:main:${sibling}`).click();
        await expect(picker).toHaveText(/model-alpha/);
        await picker.click();
        await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('chat-model-picker-follow-agent')).toHaveCount(0);
        await picker.click();
      }
      await page.reload();
      await page.getByTestId('sidebar-session-agent:main:main').click();
      await expect(picker).toHaveText(/provider\/model-beta/);
      await picker.click();
      await expect(betaOption).toHaveAttribute('aria-selected', 'true');
      await alphaOption.click();
      await expect(picker).toHaveText(/model-alpha/);

      await page.getByTestId('sidebar-new-chat').click();
      await picker.click();
      await expect(alphaOption).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('chat-model-picker-follow-agent')).toHaveCount(0);
      await gptOption.click();
      await expect(picker).toHaveText(/gpt-5.6/);
      await expect(slider).toHaveAttribute('max', '2');
      await settleFloatingSurface(modelMenu);
      const track = await slider.boundingBox();
      if (!track) throw new Error('Thinking slider is not visible');
      const y = track.y + track.height / 2;
      await page.mouse.move(track.x + 8, y);
      await page.mouse.down();
      await page.mouse.move(track.x + track.width / 2, y, { steps: 5 });
      await expect(slider).toHaveAttribute('aria-valuetext', 'High');
      await expect(picker).toContainText('Off');
      await page.mouse.move(track.x + track.width - 8, y, { steps: 5 });
      await page.mouse.up();
      await expect(picker).toContainText('Adaptive');
      await resetThinking.click();
      await expect(strengthLabel).toHaveText('Default (Off)');
      await slider.focus();
      await slider.press('End');
      await expect(picker).toContainText('Adaptive');
      await page.keyboard.press('Escape');
      // Picking in an unsent draft must not create a Gateway conversation.
      expect(await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string; body: { createIfMissing?: boolean } | null }>;
        }).__chatModelPickerRequests?.some((r) => r.path === 'sessions:setModel' && r.body?.createIfMissing)
      ))).toBe(false);
      await page.getByTestId('chat-composer-input').fill('Which model handles this first turn?');
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(() => app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatModelPickerRequests?: Array<{ path: string }> })
          .__chatModelPickerRequests?.some((r) => r.path === 'chat:sendAcpPrompt')
      ))).toBe(true);

      const requests = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __chatModelPickerRequests?: Array<{ path: string; method: string; body: Record<string, unknown> | null }> }).__chatModelPickerRequests ?? []
      ));
      const firstPrompt = requests.findIndex((r) => r.path === 'chat:sendAcpPrompt');
      const draftKey = requests[firstPrompt].body?.sessionKey;
      expect(draftKey).toMatch(/^agent:main:session-/);
      expect(requests.slice(0, firstPrompt)).toContainEqual({
        path: 'sessions:setModel', method: 'HOST',
        body: { sessionKey: draftKey, modelRef: 'openai/gpt-5.6', thinkingLevel: 'adaptive', createIfMissing: true },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel',
        method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: betaModelRef },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel',
        method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: alphaModelRef },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel', method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: 'custom-beta5678/model-alpha' },
      });
      expect(requests.some((request) => request.path === 'sessions:setModel' && request.body?.modelRef === null)).toBe(false);
      expect(requests.some((request) =>
        request.path === 'agents:updateModel'
        || request.path === '/api/gateway/restart'
        || request.path === '/api/gateway/start'
        || request.path === 'gateway:restart'
        || request.path === 'gateway:start'
        || request.path === 'gateway:config.patch'
      )).toBe(false);

      await test.step('selects a model and sends from another agent’s existing conversation', async () => {
        await page.getByTestId('sidebar-session-agent:reviewer:primary').click();
        await expect(picker).toHaveText(/provider\/model-beta/);
        await picker.click();
        await expect(betaOption).toHaveAttribute('aria-selected', 'true');
        await expect(gptOption).toHaveAttribute('aria-selected', 'false');
        await expect(page.getByTestId('chat-model-picker-follow-agent')).toHaveCount(0);
        await gptOption.click();
        await expect(picker).toHaveText(/gpt-5.6/);
        await page.getByTestId('chat-composer-input').fill('Please review this change.');
        await page.getByTestId('chat-composer-send').click();

        const reviewerRequests = () => app.evaluate((_electron, since) => (
          (globalThis as typeof globalThis & {
            __chatModelPickerRequests?: Array<{ path: string; body: Record<string, unknown> | null }>;
          }).__chatModelPickerRequests?.slice(since) ?? []
        ), requests.length);
        await expect.poll(async () => (await reviewerRequests())
          .filter((r) => r.path === 'chat:sendAcpPrompt')
          .map((r) => r.body?.sessionKey)).toEqual(['agent:reviewer:primary']);
        const sent = await reviewerRequests();
        const promptIndex = sent.findIndex((r) => r.path === 'chat:sendAcpPrompt');
        expect(sent[promptIndex].body?.cwd).toBe('/tmp/clawx-model-picker-workspace-review');
        expect(sent.filter((r) => r.path === 'sessions:setModel').map((r) => r.body)).toEqual([
          { sessionKey: 'agent:reviewer:primary', modelRef: 'openai/gpt-5.6' },
        ]);
        expect(sent.findIndex((r) => r.path === 'sessions:setModel')).toBeLessThan(promptIndex);
      });

      await test.step('keeps the startup task local and stages its model while the catalog is unavailable', async () => {
        await app.evaluate(() => {
          (globalThis as typeof globalThis & { __makeSessionCatalogUnavailable?: () => void }).__makeSessionCatalogUnavailable?.();
        });
        await page.reload();
        const startupRequests = () => app.evaluate(() => (
          (globalThis as typeof globalThis & {
            __chatModelPickerRequests?: Array<{ path: string; body: Record<string, unknown> | null }>;
          }).__chatModelPickerRequests ?? []
        ));
        await expect.poll(async () => (await startupRequests()).some((request) => (
          request.path === 'gateway:sessions.list'
        ))).toBe(true);
        expect((await startupRequests()).filter((request) => request.path === 'chat:loadAcpSession')).toEqual([]);
        // Unsent local drafts stay out of the persisted conversation list.
        await expect(page.getByTestId('sidebar-session-agent:main:main')).toHaveCount(0);
        await expect(picker).toHaveText(/model-alpha/);
        await picker.click();
        await gptOption.click();
        await expect(picker).toHaveText(/gpt-5.6/);
        expect((await startupRequests()).filter((request) => request.path === 'sessions:setModel')).toEqual([]);

        await page.getByTestId('chat-composer-input').fill('Use my selection for this first turn.');
        await page.getByTestId('chat-composer-send').click();
        await expect.poll(async () => (await startupRequests()).some((request) => request.path === 'chat:sendAcpPrompt')).toBe(true);
        const startup = await startupRequests();
        const firstPrompt = startup.findIndex((request) => request.path === 'chat:sendAcpPrompt');
        const modelWrite = startup.findIndex((request) => request.path === 'sessions:setModel');
        const startupDraftKey = startup[firstPrompt].body?.sessionKey;
        expect(startupDraftKey).toMatch(/^agent:main:session-\d+$/);
        expect(modelWrite).toBeGreaterThanOrEqual(0);
        expect(modelWrite).toBeLessThan(firstPrompt);
        expect(startup[modelWrite].body).toEqual({
          sessionKey: startupDraftKey, modelRef: 'openai/gpt-5.6', createIfMissing: true,
        });
        await page.reload();
        await page.getByTestId(`sidebar-session-${startupDraftKey}`).click();
        await expect(picker).toHaveText(/gpt-5.6/);
      });

    } finally {
      await closeElectronApp(app);
    }
  });
});
