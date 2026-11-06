import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

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
              return makeResponse(request.id, { sessions });
            }
            return makeResponse(request.id, {});
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'sessions' && request.action === 'getModel') {
            return makeResponse(request.id, { modelRef: sessionModels.get(String(body?.sessionKey)) ?? null });
          }
          if (request?.module === 'sessions' && request.action === 'setModel') {
            if ((globalThis as typeof globalThis & { __modelAdmissionPending?: boolean }).__modelAdmissionPending) {
              return { id: request.id, ok: false, error: {
                code: 'INTERNAL', message: 'Gateway is still preparing agents. Please wait before switching models.',
              } };
            }
            const key = String(body?.sessionKey);
            if (typeof body?.modelRef === 'string') sessionModels.set(key, body.modelRef);
            else sessionModels.delete(key);
            return makeResponse(request.id, { modelRef: sessionModels.get(key) ?? null });
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
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/model-alpha/);
      await expect(page.getByTestId('chat-model-picker-button')).not.toContainText('Alpha');
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'fallback');
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('provider/model-beta');
      const modelMenu = page.getByTestId('chat-model-picker-menu');
      const triggerId = await page.getByTestId('chat-model-picker-button').getAttribute('id');
      expect(triggerId).toBeTruthy();
      await expect(modelMenu).toHaveAttribute('aria-labelledby', triggerId!);
      const modelScroll = modelMenu.locator('.overflow-y-auto');
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
      await modelScroll.evaluate(element => { element.scrollTop = 0; });
      const alphaGroup = modelMenu.getByRole('group', { name: 'Alpha', exact: true });
      const betaGroup = modelMenu.getByRole('group', { name: 'Beta', exact: true });
      await expect(modelMenu.locator('[role="group"][aria-label]')).toHaveCount(4);
      await expect(modelMenu.getByText('Beta', { exact: true })).toHaveCount(1);
      await expect(betaGroup.getByRole('menuitemradio')).toHaveText(['provider/model-beta', 'model-beta-lite', 'model-alpha']);
      await expect(alphaGroup.getByRole('menuitemradio', { name: 'model-alpha', exact: true })).toBeVisible();
      await expect(betaGroup.getByRole('menuitemradio', { name: 'model-alpha', exact: true })).toBeVisible();
      await expect(betaGroup.getByRole('menuitemradio')).not.toContainText(['Beta', 'Beta', 'Beta']);
      const betaOptions = betaGroup.getByRole('menuitemradio');
      const firstBeta = await betaOptions.nth(0).boundingBox();
      const secondBeta = await betaOptions.nth(1).boundingBox();
      expect(firstBeta!.height).toBe(28);
      expect(secondBeta!.height).toBe(28);
      expect(secondBeta!.y - firstBeta!.y - firstBeta!.height).toBeCloseTo(4, 0);
      const alphaBounds = await alphaGroup.boundingBox();
      const betaBounds = await betaGroup.boundingBox();
      expect(betaBounds!.y - alphaBounds!.y - alphaBounds!.height).toBeCloseTo(4, 0);
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('provider/model-beta (Beta)');
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('gpt-5.6');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('gpt-5.5');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('openai/gpt-5.6');
      await expect(page.getByTestId('chat-model-picker-menu')).toContainText('kimi-k2.7');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('kimi-k2.6');
      await expect(page.getByTestId('chat-model-picker-menu')).not.toContainText('moonshot/kimi-k2.7');
      const gptOption = page.getByTestId('chat-model-picker-menu').getByRole('menuitemradio', { name: 'gpt-5.6', exact: true });
      await expect(gptOption.getByTestId('chat-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'openai');
      const kimiOption = page.getByTestId('chat-model-picker-menu').getByRole('menuitemradio', { name: 'kimi-k2.7', exact: true });
      await expect(kimiOption.getByTestId('chat-model-picker-option-icon')).toHaveAttribute('data-model-icon', 'kimi');
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
      await page.getByTestId('chat-model-picker-button').click();
      await gptOption.click();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/gpt-5.6/);
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'openai');
      await page.getByTestId('chat-model-picker-button').click();
      await betaGroup.getByRole('menuitemradio', { name: 'model-alpha', exact: true }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText('model-alpha');
      await page.getByTestId('chat-model-picker-button').click();
      await expect(betaGroup.getByRole('menuitemradio', { name: 'model-alpha', exact: true })).toHaveAttribute('aria-current', 'true');
      await expect(alphaGroup.getByRole('menuitemradio', { name: 'model-alpha', exact: true })).not.toHaveAttribute('aria-current', 'true');
      await betaGroup.getByRole('menuitemradio', { name: 'provider/model-beta', exact: true }).click();
      await expect(page.getByTestId('chat-model-picker-button')).toHaveText(/provider\/model-beta/);
      await expect(page.getByTestId('chat-model-picker-button')).not.toContainText('Beta');
      await expect(page.getByTestId('chat-model-picker-current-icon')).toHaveAttribute('data-model-icon', 'fallback');

      const picker = page.getByTestId('chat-model-picker-button');
      for (const sibling of ['sibling', 'other']) {
        await page.getByTestId(`sidebar-session-agent:main:${sibling}`).click();
        await expect(picker).toHaveText(/model-alpha/);
      }
      await page.reload();
      await page.getByTestId('sidebar-session-agent:main:main').click();
      await expect(picker).toHaveText(/provider\/model-beta/);
      await picker.click();
      await page.getByTestId('chat-model-picker-menu').getByRole('menuitemradio', { name: /Follow Agent/ }).click();
      await expect(picker).toHaveText(/model-alpha/);

      await page.getByTestId('sidebar-new-chat').click();
      await picker.click();
      await gptOption.click();
      await expect(picker).toHaveText(/gpt-5.6/);
      // Picking in an unsent draft must not create a Gateway conversation.
      expect(await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __chatModelPickerRequests?: Array<{ path: string; body: { createIfMissing?: boolean } | null }>;
        }).__chatModelPickerRequests?.some((r) => r.path === 'sessions:setModel' && r.body?.createIfMissing)
      ))).toBe(false);
      await page.locator('textarea').fill('Which model handles this first turn?');
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
        body: { sessionKey: draftKey, modelRef: 'openai/gpt-5.6', createIfMissing: true },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel',
        method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: betaModelRef },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel',
        method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: null },
      });
      expect(requests).toContainEqual({
        path: 'sessions:setModel', method: 'HOST',
        body: { sessionKey: 'agent:main:main', modelRef: 'custom-beta5678/model-alpha' },
      });
      expect(requests.some((request) =>
        request.path === 'agents:updateModel'
        || request.path === '/api/gateway/restart'
        || request.path === '/api/gateway/start'
        || request.path === 'gateway:restart'
        || request.path === 'gateway:start'
        || request.path === 'gateway:config.patch'
      )).toBe(false);

      await test.step('selects a model for the mentioned conversation when sending from a local draft', async () => {
        await page.getByTestId('sidebar-new-chat').click();
        await picker.click();
        await kimiOption.click();
        await expect(picker).toHaveText(/kimi-k2.7/);

        const selectReviewer = async () => {
          await page.getByTestId('chat-composer-agent').click();
          await page.getByTestId('chat-agent-target-reviewer').click();
        };
        await selectReviewer();
        await expect(picker).toHaveText(/provider\/model-beta/);
        await picker.click();
        await expect(betaGroup.getByRole('menuitemradio', { name: 'provider/model-beta', exact: true })).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByTestId('chat-model-picker-follow-agent')).toContainText('gpt-5.6');
        await gptOption.click();
        await expect(picker).toHaveText(/gpt-5.6/);
        await page.getByRole('button', { name: '@Reviewer', exact: true }).click();
        await expect(picker).toHaveText(/kimi-k2.7/);
        await selectReviewer();
        await expect(picker).toHaveText(/gpt-5.6/);
        await page.getByTestId('chat-composer-input').fill('Please review this change.');
        await page.getByTestId('chat-composer-send').click();

        const routedRequests = () => app.evaluate((_electron, since) => (
          (globalThis as typeof globalThis & {
            __chatModelPickerRequests?: Array<{ path: string; body: Record<string, unknown> | null }>;
          }).__chatModelPickerRequests?.slice(since) ?? []
        ), requests.length);
        await expect.poll(async () => (await routedRequests())
          .filter((r) => r.path === 'chat:sendAcpPrompt')
          .map((r) => r.body?.sessionKey)).toEqual(['agent:reviewer:primary']);
        const routed = await routedRequests();
        const promptIndex = routed.findIndex((r) => r.path === 'chat:sendAcpPrompt');
        expect(routed[promptIndex].body?.cwd).toBe('/tmp/clawx-model-picker-workspace-review');
        expect(routed.filter((r) => r.path === 'sessions:setModel').map((r) => r.body)).toEqual([
          { sessionKey: 'agent:reviewer:primary', modelRef: 'openai/gpt-5.6' },
        ]);
        expect(routed.findIndex((r) => r.path === 'sessions:setModel')).toBeLessThan(promptIndex);
      });

    } finally {
      await closeElectronApp(app);
    }
  });
});
