import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, test } from './fixtures/electron';

const TEST_PROVIDER_ID = 'moonshot-e2e';
const TEST_PROVIDER_LABEL = 'Moonshot E2E';

async function seedTestProvider(page: Parameters<typeof completeSetup>[0]): Promise<void> {
  await page.evaluate(async ({ providerId, providerLabel }) => {
    const now = new Date().toISOString();
    await window.electron.ipcRenderer.invoke('provider:save', {
      id: providerId,
      name: providerLabel,
      type: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }, { providerId: TEST_PROVIDER_ID, providerLabel: TEST_PROVIDER_LABEL });
}

test.describe('ClawX provider lifecycle', () => {
  test('renames a service without changing its identity or saved model', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);
    await navigateToSection(page, 'models');
    const card = page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`);
    await expect(card).toContainText(TEST_PROVIDER_LABEL);
    await page.getByTestId(`provider-edit-${TEST_PROVIDER_ID}`).click();
    const dialog = page.getByTestId(`provider-edit-dialog-${TEST_PROVIDER_ID}`);
    await dialog.getByLabel('Display Name', { exact: true }).fill('Research service');
    await dialog.getByTestId(`provider-edit-save-${TEST_PROVIDER_ID}`).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toContainText('Research service');
    await expect(card.getByTestId(`provider-model-${TEST_PROVIDER_ID}`)).toHaveText('kimi-k2.6');
    await expect(page.getByTestId('providers-settings').getByText(TEST_PROVIDER_LABEL, { exact: true })).toHaveCount(0);
  });

  test('promotes a remaining provider after deleting the default provider', async ({ page }) => {
    await completeSetup(page);

    await page.evaluate(async () => {
      const now = new Date().toISOString();
      const providers = [
        {
          id: 'moonshot-default-e2e',
          name: 'Moonshot Default E2E',
          type: 'moonshot',
          baseUrl: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'deepseek-replacement-e2e',
          name: 'DeepSeek Replacement E2E',
          type: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-flash',
          enabled: true,
          createdAt: now,
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
        },
      ];

      for (const provider of providers) {
        await window.electron.ipcRenderer.invoke('provider:save', provider, 'sk-model-selection-e2e');
      }
      await window.electron.ipcRenderer.invoke('provider:setDefault', providers[0].id);
    });

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('provider-card-moonshot-default-e2e')).toBeVisible();
    await expect(page.getByTestId('global-model-picker-button')).toHaveCount(0);
    await expect(page.getByTestId('provider-card-deepseek-replacement-e2e')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-default-e2e').hover();
    await page.getByTestId('provider-delete-moonshot-default-e2e').click();

    await expect(page.getByTestId('provider-card-moonshot-default-e2e')).toHaveCount(0);
    await expect(page.getByTestId('provider-card-deepseek-replacement-e2e')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.electron.ipcRenderer.invoke('provider:getDefault'))).toBe('deepseek-replacement-e2e');
    await expect(page.getByTestId('provider-set-default-deepseek-replacement-e2e')).toHaveCount(0);
  });

  test('shows a saved provider and removes it immediately while deletion finishes', async ({ electronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers;
      const originalHostInvoke = handlers?.get('host:invoke');
      if (!originalHostInvoke) throw new Error('host:invoke handler unavailable');

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        module?: string;
        action?: string;
      }) => {
        if (request.module === 'providers' && request.action === 'deleteAccount') {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        return originalHostInvoke(event, request);
      });
    });

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0, { timeout: 500 });
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    await expect(page.getByText('Provider deleted')).toBeVisible();
  });

  test('does not redisplay a deleted provider after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);

    await electronApp.close();

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedPage = await relaunchedApp.firstWindow();
      await relaunchedPage.waitForLoadState('domcontentloaded');
      await expect(relaunchedPage.getByTestId('main-layout')).toBeVisible();

      await navigateToSection(relaunchedPage, 'models');
      await expect(relaunchedPage.getByTestId('providers-settings')).toBeVisible();
      await expect(relaunchedPage.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
      await expect(relaunchedPage.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });

  test('keeps OpenAI fields and footer in place when switching authentication', async ({ page }) => {
    await completeSetup(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-openai').click();
    const dialog = page.getByTestId('add-provider-dialog');
    const [icon, nameField] = await Promise.all([
      dialog.getByRole('img', { name: 'OpenAI', exact: true }).locator('..').boundingBox(),
      dialog.getByTestId('add-provider-name-input').boundingBox(),
    ]);
    expect(icon!.x).toBeCloseTo(nameField!.x, 0);

    const authMethod = page.getByRole('group', { name: 'Authentication method', exact: true });
    const oauth = authMethod.getByTestId('add-provider-auth-oauth-tab');
    const apiKey = authMethod.getByTestId('add-provider-auth-apikey-tab');
    const modelId = dialog.getByTestId('add-provider-model-id-input');
    const keyInput = dialog.getByTestId('add-provider-api-key-input');
    const footer = dialog.getByTestId('add-provider-footer');
    const cancel = footer.getByRole('button', { name: 'Cancel', exact: true });
    const submit = footer.getByTestId('add-provider-submit-button');
    const browserLogin = footer.getByTestId('add-provider-oauth-login-button');
    const sharedBounds = () => Promise.all([
      dialog.boundingBox(),
      dialog.getByTestId('add-provider-name-input').boundingBox(),
      authMethod.boundingBox(),
      modelId.boundingBox(),
      dialog.locator('footer').boundingBox(),
      cancel.boundingBox(),
      footer.getByRole('button').last().boundingBox(),
    ]);
    await expect(oauth).toBeVisible();
    await expect(apiKey).toBeVisible();

    await apiKey.click();
    await expect(cancel).toBeVisible();
    await expect(submit).toBeVisible();
    await keyInput.fill('sk-fixture');
    await modelId.fill('model-fixture');
    const apiKeyBounds = await sharedBounds();

    await oauth.click();
    await expect(oauth).toHaveAttribute('aria-pressed', 'true');
    await expect(apiKey).toHaveAttribute('aria-pressed', 'false');
    await expect(cancel).toBeVisible();
    await expect(browserLogin).toBeVisible();
    await expect(browserLogin).toHaveCSS('height', '36px');
    await expect(keyInput).toHaveCount(0);
    await expect(modelId).toHaveValue('model-fixture');
    expect(await sharedBounds()).toEqual(apiKeyBounds);

    await apiKey.click();
    await expect(keyInput).toHaveValue('sk-fixture');
    expect(await sharedBounds()).toEqual(apiKeyBounds);
  });

  test('validates only the selected service and isolates its draft from other services', async ({ page }) => {
    await completeSetup(page);
    await navigateToSection(page, 'models');
    await page.getByTestId('providers-add-button').click();
    const dialog = page.getByTestId('add-provider-dialog');
    const submit = dialog.getByTestId('add-provider-submit-button');
    const keyInput = dialog.getByTestId('add-provider-api-key-input');
    const baseUrl = dialog.getByTestId('add-provider-base-url-input');
    const modelId = dialog.getByTestId('add-provider-model-id-input');

    await dialog.getByTestId('add-provider-type-custom').click();
    await keyInput.fill('sk-fixture');
    await dialog.getByRole('button', { name: 'Show API key' }).click();
    const protocol = dialog.getByRole('combobox', { name: 'Protocol' });
    await protocol.click();
    await page.getByRole('option', { name: 'OpenAI Responses' }).click();
    await modelId.fill('model-a,model-b');
    await submit.click();
    await expect(baseUrl).toHaveAccessibleDescription('Enter a base URL.');
    await expect(modelId).toHaveAccessibleDescription('Enter a single model ID.');
    await baseUrl.fill('invalid-url');
    await modelId.fill('model-a');
    await submit.click();
    await expect(baseUrl).toHaveAccessibleDescription(/valid URL/);

    await dialog.getByTestId('add-provider-type-google').click();
    await expect(keyInput).toHaveValue('');
    await expect(keyInput).toHaveAttribute('type', 'password');
    await dialog.getByTestId('add-provider-name-input').press('Tab');
    await expect(dialog.getByRole('link', { name: 'Get API Key' })).toBeFocused();
    await submit.click();
    await expect(keyInput).toHaveAccessibleDescription('Enter an API key.');

    await dialog.getByTestId('add-provider-type-custom').click();
    await expect(protocol).toHaveText('OpenAI Chat Completions');
    await dialog.getByTestId('add-provider-type-ollama').click();
    const [urlBounds, modelBounds, keyBounds] = await Promise.all([baseUrl, modelId, keyInput].map(field => field.boundingBox()));
    expect(urlBounds!.y).toBeLessThan(modelBounds!.y);
    expect(modelBounds!.y).toBeLessThan(keyBounds!.y);
    await expect(keyInput).toHaveAccessibleName('API Key (Not required)');
  });

  test('keeps OAuth actions in the shared footer and authorizes the entered model', async ({ electronApp, page }) => {
    await completeSetup(page);
    await electronApp.evaluate(async () => {
      const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const state = { modelId: '', codes: 0, cancellations: 0 };
      (globalThis as typeof globalThis & { providerOAuthE2E?: typeof state }).providerOAuthE2E = state;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id: string; module: string; action: string; payload?: { provider?: string; modelId?: string };
      }) => {
        if (request.module !== 'providers') return original(event, request);
        if (request.action === 'requestOAuth') {
          state.modelId = request.payload?.modelId ?? '';
          const provider = request.payload?.provider;
          BrowserWindow.getAllWindows()[0].webContents.send('oauth:code', provider === 'openai'
            ? { provider, mode: 'manual', authorizationUrl: 'https://example.invalid/oauth' }
            : { provider, verificationUri: 'https://example.invalid/oauth', userCode: 'TEST-CODE', expiresIn: 300 });
        } else if (request.action === 'submitOAuth') {
          state.codes += 1;
        } else if (request.action === 'cancelOAuth') {
          state.cancellations += 1;
        } else {
          return original(event, request);
        }
        return { id: request.id, ok: true, data: { success: true } };
      });
    });

    await navigateToSection(page, 'models');
    await page.getByTestId('providers-add-button').click();
    const dialog = page.getByTestId('add-provider-dialog');
    const footer = dialog.getByTestId('add-provider-footer');
    const keyMode = dialog.getByTestId('add-provider-auth-apikey-tab');
    const oauthMode = dialog.getByTestId('add-provider-auth-oauth-tab');
    const keyInput = dialog.getByTestId('add-provider-api-key-input');
    const modelId = dialog.getByTestId('add-provider-model-id-input');
    const cancel = footer.getByRole('button', { name: 'Cancel', exact: true });
    const snapshot = () => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & {
        providerOAuthE2E?: { modelId: string; codes: number; cancellations: number };
      }).providerOAuthE2E
    ));

    await dialog.getByTestId('add-provider-type-openai').click();
    await keyMode.click();
    await keyInput.fill('sk-fixture');
    await modelId.fill('my-oauth-model');
    await oauthMode.click();
    await footer.getByTestId('add-provider-oauth-login-button').click();
    await expect(keyMode).toBeDisabled();
    await expect(dialog.getByTestId('add-provider-type-minimax-portal')).toBeDisabled();
    const submitCode = footer.getByTestId('add-provider-oauth-submit-code');
    await expect(submitCode).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Paste callback URL or code' }).fill('fixture-code');
    await submitCode.click();
    await expect.poll(snapshot).toEqual({ modelId: 'my-oauth-model', codes: 1, cancellations: 0 });
    await cancel.click();
    await keyMode.click();
    await expect(keyInput).toHaveValue('sk-fixture');
    await expect(modelId).toHaveValue('my-oauth-model');

    await dialog.getByTestId('add-provider-type-minimax-portal').click();
    await keyMode.click();
    await footer.getByTestId('add-provider-submit-button').click();
    await expect(keyInput).toHaveAccessibleDescription('Enter an API key.');
    await oauthMode.click();
    await footer.getByTestId('add-provider-oauth-login-button').click();
    await expect(dialog.locator('code')).toHaveText('TEST-CODE');
    await expect(footer.getByTestId('add-provider-oauth-open-login')).toBeVisible();
    await cancel.click();
    await expect(keyMode).toBeEnabled();
    await expect.poll(snapshot).toEqual({ modelId: 'MiniMax-M3', codes: 1, cancellations: 2 });
  });

  test('only exposes TokenDance setup in Chinese and cancels it when the dialog closes', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers;
      const originalHostInvoke = handlers?.get('host:invoke');
      if (!originalHostInvoke) throw new Error('host:invoke handler unavailable');

      const state = { requests: 0, cancellations: 0 };
      (globalThis as typeof globalThis & { tokenDanceOAuthE2E?: typeof state }).tokenDanceOAuthE2E = state;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { provider?: string };
      }) => {
        if (request.module === 'providers' && request.action === 'requestOAuth'
          && request.payload?.provider === 'tokendance') {
          state.requests += 1;
          return { id: request.id, ok: true, data: { success: true } };
        }
        if (request.module === 'providers' && request.action === 'cancelOAuth') {
          state.cancellations += 1;
          return { id: request.id, ok: true, data: { success: true } };
        }
        return originalHostInvoke(event, request);
      });
    });

    await page.evaluate(async () => {
      const now = new Date().toISOString();
      await window.electron.ipcRenderer.invoke('provider:save', {
        id: 'tokendance-existing-e2e',
        name: 'TokenDance Existing E2E',
        type: 'tokendance',
        baseUrl: 'https://tokendance.space/gateway/v1',
        model: 'qwen3.8-max',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('provider-card-tokendance-existing-e2e')).toBeVisible();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-type-tokendance')).toHaveCount(0);
    await page.getByTestId('add-provider-close-button').click();

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByRole('button', { name: '中文' }).click();
    await navigateToSection(page, 'models');
    await expect(page.getByTestId('provider-card-tokendance-existing-e2e')).toBeVisible();
    await page.getByTestId('providers-add-button').click();

    const tokenDanceType = page.getByTestId('add-provider-type-tokendance');
    await expect(tokenDanceType).toBeVisible();
    await expect(tokenDanceType).toHaveAccessibleName('TokenDance');
    const tokenDanceLogo = tokenDanceType.locator('img');
    await expect(tokenDanceLogo).toHaveAttribute('src', /^data:image\/svg\+xml,/);
    await expect(tokenDanceLogo).not.toHaveClass(/dark:invert/);

    await tokenDanceType.click();
    await expect(page.getByTestId('add-provider-auth-oauth-tab')).toBeVisible();
    await expect(page.getByTestId('add-provider-auth-apikey-tab')).toBeVisible();
    await expect(page.getByTestId('add-provider-model-id-input')).toHaveValue('qwen3.8-max');
    await expect(page.getByTestId('add-provider-oauth-login-button')).toBeVisible();

    await page.getByTestId('add-provider-auth-apikey-tab').click();
    await expect(page.getByTestId('add-provider-api-key-input')).toBeVisible();

    await page.getByTestId('add-provider-auth-oauth-tab').click();
    await page.getByTestId('add-provider-oauth-login-button').click();
    await expect(page.getByTestId('add-provider-oauth-login-button')).toBeDisabled();
    await expect(page.getByTestId('add-provider-dialog').getByRole('status')).toHaveText('等待授权…');

    await page.getByTestId('add-provider-footer').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await expect(page.getByTestId('add-provider-oauth-login-button')).toBeEnabled();
    await expect(page.getByTestId('add-provider-dialog').getByRole('status')).toHaveCount(0);

    await page.getByTestId('add-provider-oauth-login-button').click();
    await page.getByTestId('add-provider-close-button').click();

    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & {
        tokenDanceOAuthE2E?: { requests: number; cancellations: number };
      }).tokenDanceOAuthE2E
    ))).toEqual({ requests: 2, cancellations: 2 });

    await page.getByTestId('providers-add-button').click();
    await page.getByTestId('add-provider-type-tokendance').click();
    await page.getByTestId('add-provider-oauth-login-button').click();
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & {
        tokenDanceOAuthE2E?: { requests: number; cancellations: number };
      }).tokenDanceOAuthE2E?.requests
    ))).toBe(3);
  });

  test('shows TokenDance recovery guidance returned by Main validation', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers;
      const originalHostInvoke = handlers?.get('host:invoke');
      if (!originalHostInvoke) throw new Error('host:invoke handler unavailable');

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
      }) => {
        if (request.module === 'providers' && request.action === 'validateKey') {
          return {
            id: request.id,
            ok: true,
            data: {
              valid: false,
              error: 'Balance insufficient',
              recoveryAction: 'top_up_balance',
            },
          };
        }
        return originalHostInvoke(event, request);
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByRole('button', { name: '中文' }).click();
    await navigateToSection(page, 'models');
    await page.getByTestId('providers-add-button').click();
    await page.getByTestId('add-provider-type-tokendance').click();
    await page.getByTestId('add-provider-auth-apikey-tab').click();
    await page.getByTestId('add-provider-api-key-input').fill('td-insufficient');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByText(/TokenDance 账户余额不足/)).toBeVisible();
  });

  test('trims whitespace before validating and saving a custom provider key', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let accounts: Array<Record<string, unknown>> = [];
      let keyInfo: Array<{ accountId: string; hasKey: boolean; keyMasked: string | null }> = [];
      let statuses: Array<Record<string, unknown>> = [];
      let defaultAccountId: string | null = null;
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, accounts);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: defaultAccountId });
        if (request.action === 'list') return respond(request.id, statuses);

        if (request.action === 'validateKey') {
          if (body.apiKey !== 'sk-lm-test') {
            return respond(request.id, { valid: false, error: `unexpected key: ${String(body.apiKey)}` });
          }
          const options = body.options as Record<string, unknown> | undefined;
          if (options?.modelId !== 'local-model') {
            return respond(request.id, {
              valid: false,
              error: `unexpected validation model: ${String(options?.modelId)}`,
            });
          }
          return respond(request.id, { valid: true });
        }

        if (request.action === 'createAccount') {
          const account = body.account as Record<string, unknown>;
          accounts = [account];
          keyInfo = [{
            accountId: String(account.id),
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          statuses = [{
            id: account.id,
            name: account.label,
            type: account.vendorId,
            baseUrl: account.baseUrl,
            model: account.model,
            enabled: account.enabled,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond(request.id, { success: true, account });
        }

        if (request.action === 'setDefaultAccount') {
          defaultAccountId = typeof body.accountId === 'string' ? body.accountId : null;
          return respond(request.id, { success: true });
        }

        return respond(request.id, {});
      });
    });

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-custom').click();
    await page.getByTestId('add-provider-name-input').fill('LM Studio Local');
    await page.getByTestId('add-provider-api-key-input').fill('  sk-lm-test \n');
    await page.getByTestId('add-provider-base-url-input').fill('http://127.0.0.1:1234/v1');
    await page.getByTestId('add-provider-model-id-input').fill('local-model');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByTestId('provider-card-custom')).toContainText('LM Studio Local');
  });

  test('edit form validates the new API key inline before saving (single button)', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let provider = {
        id: 'moonshot-edit',
        vendorId: 'moonshot',
        label: 'Moonshot Edit',
        authMode: 'api_key',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.6',
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      let storedKey = 'sk-existing';
      let keyInfo = [{ accountId: provider.id, hasKey: true, keyMasked: 'sk-***' }];
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request?.module !== 'providers') {
          return originalHostInvoke?.(event, request) ?? respond(request?.id, undefined);
        }

        const body = request.payload ?? {};
        if (request.action === 'accounts') return respond(request.id, [provider]);
        if (request.action === 'accountKeyInfo') return respond(request.id, keyInfo);
        if (request.action === 'vendors') return respond(request.id, []);
        if (request.action === 'getDefaultAccount') return respond(request.id, { accountId: provider.id });
        if (request.action === 'list') return respond(request.id, [provider]);

        if (request.action === 'validateKey') {
          if (body.apiKey === 'sk-good') {
            const options = body.options as Record<string, unknown> | undefined;
            if (options?.modelId !== 'kimi-k2.6') {
              return respond(request.id, {
                valid: false,
                error: `unexpected validation model: ${String(options?.modelId)}`,
              });
            }
            return respond(request.id, { valid: true });
          }
          return respond(request.id, { valid: false, error: 'Invalid API key' });
        }

        if (request.action === 'updateAccount') {
          provider = {
            ...provider,
            ...(body.updates as Record<string, unknown> | undefined),
            updatedAt: new Date().toISOString(),
          };
          if (body.apiKey) storedKey = String(body.apiKey);
          keyInfo = [{ accountId: provider.id, hasKey: Boolean(storedKey), keyMasked: 'sk-***' }];
          return respond(request.id, { success: true, account: provider });
        }

        return respond(request.id, {});
      });
    });

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('provider-card-moonshot-edit')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-edit').hover();
    await page.getByTestId('provider-edit-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-models-moonshot-edit').getByRole('listitem')).toHaveText(['kimi-k2.6']);
    await expect(page.getByTestId('provider-edit-dialog-moonshot-edit').locator('input[id$="-model"]')).toHaveCount(0);

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-bad');
    await page.getByTestId('provider-edit-save-moonshot-edit').click();
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toContainText('Invalid API key');

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-good');
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toHaveCount(0);
    await page.getByTestId('provider-edit-save-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-save-moonshot-edit')).toHaveCount(0);
  });

  test('shows Z.AI CN/Global options and Code Plan endpoint toggle', async ({ page }) => {
    await completeSetup(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await expect(page.getByTestId('add-provider-type-zai')).toBeVisible();
    await expect(page.getByTestId('add-provider-type-zai-global')).toBeVisible();

    await page.getByTestId('add-provider-type-zai').click();
    await expect(page.getByTestId('add-provider-base-url-input')).toHaveValue('https://open.bigmodel.cn/api/paas/v4');
    await expect(page.getByTestId('add-provider-model-id-input')).toHaveValue('glm-5.3-flash');
    await expect(page.getByTestId('add-provider-codeplan-mode-tab')).toBeVisible();

    const dialog = page.getByTestId('add-provider-dialog');
    const baseUrl = dialog.getByTestId('add-provider-base-url-input');
    const modelId = dialog.getByTestId('add-provider-model-id-input');
    await baseUrl.fill('https://example.test/general');
    await modelId.fill('general-model');
    await page.getByTestId('add-provider-codeplan-mode-tab').click();
    await expect(baseUrl).toHaveValue('https://open.bigmodel.cn/api/coding/paas/v4');
    await expect(modelId).toHaveValue('glm-5.3-flash');
    await expect(dialog.getByRole('link', { name: 'Code Plan docs' })).toHaveCount(1);
    await baseUrl.fill('https://example.test/code-plan');
    await modelId.fill('plan-model');

    await page.getByTestId('add-provider-codeplan-apikey-tab').click();
    await expect(baseUrl).toHaveValue('https://example.test/general');
    await expect(modelId).toHaveValue('general-model');
    await page.getByTestId('add-provider-codeplan-mode-tab').click();
    await expect(baseUrl).toHaveValue('https://example.test/code-plan');
    await expect(modelId).toHaveValue('plan-model');

    await page.getByTestId('add-provider-type-zai-global').click();
    await expect(page.getByTestId('add-provider-base-url-input')).toHaveValue('https://api.z.ai/api/paas/v4');
    await page.getByTestId('add-provider-codeplan-mode-tab').click();
    await expect(page.getByTestId('add-provider-base-url-input')).toHaveValue('https://api.z.ai/api/coding/paas/v4');
  });

  test('prefills the image-capable DeepSeek default model', async ({ page }) => {
    await completeSetup(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    await page.getByTestId('add-provider-type-deepseek').click();
    const modelIdInput = page.getByTestId('add-provider-model-id-input');
    await expect(modelIdInput).toHaveValue('deepseek-flash');
    await expect(modelIdInput).toHaveAttribute('placeholder', 'deepseek-flash');
  });

  test('prefills the refreshed million-token default model per provider', async ({ page }) => {
    await completeSetup(page);

    await navigateToSection(page, 'models');
    await expect(page.getByTestId('providers-settings')).toBeVisible();

    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();

    const expectedDefaults: Array<[string, string]> = [
      ['anthropic', 'claude-opus-5'],
      ['google', 'gemini-3.8-flash'],
      ['moonshot', 'kimi-k3'],
      ['moonshot-global', 'kimi-k3'],
      // OpenRouter floating aliases carry a `~` prefix in their catalog.
      ['openrouter', '~deepseek/deepseek-flash-latest'],
      // SiliconFlow's GLM-5.3 is 1M-context but text-only.
      ['siliconflow', 'zai-org/GLM-5.3'],
    ];

    for (const [providerId, expectedModelId] of expectedDefaults) {
      await page.getByTestId(`add-provider-type-${providerId}`).click();
      const modelIdInput = page.getByTestId('add-provider-model-id-input');
      await expect(modelIdInput).toHaveValue(expectedModelId);
      await expect(modelIdInput).toHaveAttribute('placeholder', expectedModelId);
    }
  });

  test('reports a Google model the API key cannot reach', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers;
      const originalHostInvoke = handlers?.get('host:invoke');
      if (!originalHostInvoke) throw new Error('host:invoke handler unavailable');

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        if (request.module === 'providers' && request.action === 'validateKey') {
          const options = request.payload?.options as Record<string, unknown> | undefined;
          // Main compares the prefilled model against Google's listing, so the
          // form's model id has to reach validation for the check to exist.
          if (options?.modelId !== 'gemini-3.8-flash') {
            return {
              id: request.id,
              ok: true,
              data: { valid: false, error: `unexpected validation model: ${String(options?.modelId)}` },
            };
          }
          return {
            id: request.id,
            ok: true,
            data: {
              valid: false,
              error: 'Model "gemini-3.8-flash" is not available for this API key. Choose one of the models this key can reach, for example gemini-3.5-flash.',
            },
          };
        }
        return originalHostInvoke(event, request);
      });
    });

    await navigateToSection(page, 'models');
    await page.getByTestId('providers-add-button').click();
    await page.getByTestId('add-provider-type-google').click();
    await page.getByTestId('add-provider-api-key-input').fill('AIza-e2e-test');
    await page.getByTestId('add-provider-submit-button').click();

    await expect(page.getByText(/is not available for this API key/)).toBeVisible();
    await expect(page.getByText(/gemini-3\.8-flash/)).toBeVisible();
  });
});


test('keeps service options on the left and the footer stable when the form changes', async ({ page }, testInfo) => {
  await completeSetup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const dialog = page.getByTestId('add-provider-dialog');
  const catalog = dialog.getByTestId('add-provider-catalog');
  const serviceList = catalog.getByTestId('add-provider-service-list');
  const details = dialog.getByTestId('add-provider-details');
  const custom = catalog.getByRole('button', { name: 'Custom service' });
  const openAi = catalog.getByRole('button', { name: 'OpenAI', exact: true });
  const footer = dialog.getByTestId('add-provider-footer');
  const cancel = footer.getByRole('button', { name: 'Cancel', exact: true });
  const primary = footer.getByRole('button').last();
  const regionalPairs = [
    ['MiniMax (CN)', 'MiniMax (Global)'],
    ['Moonshot (CN)', 'Moonshot (Global)'],
    ['Z.AI (CN)', 'Z.AI (Global)'],
  ];
  const layout = () => Promise.all([
    dialog.boundingBox(), catalog.boundingBox(), details.boundingBox(), cancel.boundingBox(), primary.boundingBox(),
  ]);

  for (const { theme, width, height } of [
    { theme: 'Light', width: 1100, height: 730 },
    { theme: 'Dark', width: 480, height: 570 },
  ]) {
    await navigateToSection(page, 'general');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await navigateToSection(page, 'models');
    await page.getByTestId('providers-add-button').click();
    await page.setViewportSize({ width, height });
    await page.mouse.move(0, 0);
    await expect(openAi).toHaveAttribute('aria-pressed', 'true');
    await expect(openAi.locator(':scope > img')).toBeVisible();
    await expect(openAi).toHaveCSS('border-top-width', '0px');
    await expect(details.getByRole('heading', { name: 'OpenAI' })).toBeVisible();
    await expect(primary).toBeInViewport();

    const initialBounds = await layout();
    const [dialogBounds, catalogBounds, detailsBounds, , actionBounds] = initialBounds;
    expect(catalogBounds!.x + catalogBounds!.width).toBeCloseTo(detailsBounds!.x, 0);
    expect(catalogBounds!.y).toBeCloseTo(detailsBounds!.y, 0);
    expect(actionBounds!.y).toBeGreaterThan(detailsBounds!.y + detailsBounds!.height);
    const rightInset = await dialog.locator('footer').evaluate(element => parseFloat(getComputedStyle(element).paddingRight));
    expect(dialogBounds!.x + dialogBounds!.width - actionBounds!.x - actionBounds!.width).toBeCloseTo(rightInset, 0);

    const options = (await catalog.getByRole('button').allTextContents()).map(content => content.trim());
    for (const [cn, global] of regionalPairs) {
      expect(options.indexOf(cn)).toBeGreaterThanOrEqual(0);
      expect(options.indexOf(global)).toBe(options.indexOf(cn) + 1);
    }
    expect(options.at(-1)).toBe('Custom service');

    const cn = catalog.getByRole('button', { name: 'MiniMax (CN)', exact: true });
    await cn.click();
    await expect(cn).toHaveAttribute('aria-pressed', 'true');
    await expect(details.getByRole('heading', { name: 'MiniMax (CN)', exact: true })).toBeVisible();
    expect(await layout()).toEqual(initialBounds);

    const global = catalog.getByRole('button', { name: 'MiniMax (Global)', exact: true });
    await global.click();
    await expect(global).toHaveAttribute('aria-pressed', 'true');
    await expect(details.getByRole('heading', { name: 'MiniMax (Global)', exact: true })).toBeVisible();
    await expect(primary).toHaveText('Login with Browser');
    expect(await layout()).toEqual(initialBounds);

    await custom.focus();
    await custom.press('Enter');
    await expect(custom).toBeFocused();
    await expect(details.getByTestId('add-provider-base-url-input')).toBeVisible();
    await expect(primary).toHaveText('Add service');
    const catalogScroll = await serviceList.evaluate(element => element.scrollTop);
    await details.getByRole('button', { name: 'Advanced configuration' }).click();
    await details.getByLabel('User-Agent').scrollIntoViewIfNeeded();
    await expect(primary).toBeInViewport();
    expect(await serviceList.evaluate(element => element.scrollTop)).toBe(catalogScroll);
    expect(await layout()).toEqual(initialBounds);
    await dialog.screenshot({ path: testInfo.outputPath(`provider-split-${theme.toLowerCase()}.png`), animations: 'disabled' });

    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('providers-add-button')).toBeFocused();
    await page.setViewportSize({ width: 1100, height: 730 });
  }
});

test('provider configuration stays discoverable and its submit action stays visible', async ({ page }, testInfo) => {
  await completeSetup(page);
  await seedTestProvider(page);
  await navigateToSection(page, 'models');
  await expect(page.getByTestId(`provider-model-${TEST_PROVIDER_ID}`)).toHaveText('kimi-k2.6');
  await expect(page.getByTestId(`provider-edit-${TEST_PROVIDER_ID}`)).toHaveAccessibleName('Edit configuration');
  await expect(page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`)).toBeVisible();
  await expect(page.getByTestId(`provider-edit-${TEST_PROVIDER_ID}`)).toHaveCSS('height', '32px');
  await expect(page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`)).toHaveCSS('height', '32px');
  await expect(page.getByTestId(`provider-more-${TEST_PROVIDER_ID}`)).toHaveCount(0);
  await page.getByTestId('providers-add-button').click();
  await expect(page.getByTestId('provider-search')).toHaveCount(0);
  await expect(page.getByTestId('add-provider-type-openai')).toBeVisible();
  await page.getByTestId('add-provider-type-custom').click();
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page.getByTestId('add-provider-submit-button')).toBeInViewport();
  await page.getByTestId('add-provider-model-id-input').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('add-provider-submit-button')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('provider-form-narrow.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Show API key', exact: true }).click();
  await expect(page.getByTestId('add-provider-api-key-input')).toHaveAttribute('type', 'text');
  await page.getByTestId('add-provider-close-button').click();
  await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);
});
