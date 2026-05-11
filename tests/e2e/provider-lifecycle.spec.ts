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
  test('shows a saved provider and removes it cleanly after deletion', async ({ page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toContainText(TEST_PROVIDER_LABEL);

    await page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`).hover();
    await page.getByTestId(`provider-delete-${TEST_PROVIDER_ID}`).click();

    await expect(page.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
    await expect(page.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
  });

  test('does not redisplay a deleted provider after relaunch', async ({ electronApp, launchElectronApp, page }) => {
    await completeSetup(page);
    await seedTestProvider(page);

    await page.getByTestId('sidebar-nav-models').click();
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

      await relaunchedPage.getByTestId('sidebar-nav-models').click();
      await expect(relaunchedPage.getByTestId('providers-settings')).toBeVisible();
      await expect(relaunchedPage.getByTestId(`provider-card-${TEST_PROVIDER_ID}`)).toHaveCount(0);
      await expect(relaunchedPage.getByText(TEST_PROVIDER_LABEL)).toHaveCount(0);
    } finally {
      await relaunchedApp.close();
    }
  });

  test('trims whitespace before validating and saving a custom provider key', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

      let accounts: Array<Record<string, unknown>> = [];
      let keyInfo: Array<{ accountId: string; hasKey: boolean; keyMasked: string | null }> = [];
      let statuses: Array<Record<string, unknown>> = [];
      let defaultAccountId: string | null = null;

      const respond = (json: unknown, status = 200) => ({
        ok: true,
        data: {
          status,
          ok: status >= 200 && status < 300,
          json,
        },
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event: unknown, request: { path?: string; method?: string; body?: string | null }) => {
        const path = request?.path ?? '';
        const method = request?.method ?? 'GET';
        const body = request?.body ? JSON.parse(request.body) : null;

        // New account-based endpoints (preferred path).
        if (path === '/api/provider-accounts' && method === 'GET') return respond(accounts);
        if (path === '/api/provider-accounts/key-info' && method === 'GET') return respond(keyInfo);
        if (path === '/api/provider-vendors' && method === 'GET') return respond([]);
        if (path === '/api/provider-accounts/default' && method === 'GET') return respond({ accountId: defaultAccountId });

        if (path === '/api/provider-accounts/validate' && method === 'POST') {
          if (body?.apiKey !== 'sk-lm-test') {
            return respond({ valid: false, error: `unexpected key: ${String(body?.apiKey)}` }, 400);
          }
          return respond({ valid: true });
        }

        if (path === '/api/provider-accounts' && method === 'POST') {
          accounts = [body.account];
          keyInfo = [{
            accountId: body.account.id,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          // Keep statuses populated for any consumer still on the legacy path.
          statuses = [{
            id: body.account.id,
            name: body.account.label,
            type: body.account.vendorId,
            baseUrl: body.account.baseUrl,
            model: body.account.model,
            enabled: body.account.enabled,
            createdAt: body.account.createdAt,
            updatedAt: body.account.updatedAt,
            hasKey: Boolean(body.apiKey),
            keyMasked: body.apiKey ? 'sk-***' : null,
          }];
          return respond({ success: true });
        }

        if (path === '/api/provider-accounts/default' && method === 'PUT') {
          defaultAccountId = body?.accountId ?? null;
          return respond({ success: true });
        }

        // ── Legacy compatibility shims ─────────────────────────────
        // Older renderer builds still reach for these. Keeping them
        // wired up here exercises the backward-compat path in the
        // route layer (it returns the same data, just without the
        // newer key-info payload structure).
        if (path === '/api/providers' && method === 'GET') return respond(statuses);
        if (path === '/api/providers/validate' && method === 'POST') {
          if (body?.apiKey !== 'sk-lm-test') {
            return respond({ valid: false, error: `unexpected key: ${String(body?.apiKey)}` }, 400);
          }
          return respond({ valid: true });
        }

        return respond({});
      });
    });

    await page.getByTestId('sidebar-nav-models').click();
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

      const provider = {
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

      const respond = (json: unknown, status = 200) => ({
        ok: true,
        data: {
          status,
          ok: status >= 200 && status < 300,
          json,
        },
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event: unknown, request: { path?: string; method?: string; body?: string | null }) => {
        const path = request?.path ?? '';
        const method = request?.method ?? 'GET';
        const body = request?.body ? JSON.parse(request.body) : null;

        if (path === '/api/provider-accounts' && method === 'GET') return respond([provider]);
        if (path === '/api/provider-accounts/key-info' && method === 'GET') return respond(keyInfo);
        if (path === '/api/provider-vendors' && method === 'GET') return respond([]);
        if (path === '/api/provider-accounts/default' && method === 'GET') return respond({ accountId: provider.id });

        if (path === '/api/provider-accounts/validate' && method === 'POST') {
          if (body?.apiKey === 'sk-good') {
            return respond({ valid: true });
          }
          return respond({ valid: false, error: 'Invalid API key' }, 400);
        }

        if (path.startsWith('/api/provider-accounts/') && method === 'PUT') {
          if (body?.apiKey) storedKey = body.apiKey;
          keyInfo = [{ accountId: provider.id, hasKey: Boolean(storedKey), keyMasked: 'sk-***' }];
          return respond({ success: true });
        }

        if (path === '/api/providers' && method === 'GET') return respond([provider]);

        return respond({});
      });
    });

    await page.getByTestId('sidebar-nav-models').click();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
    await expect(page.getByTestId('provider-card-moonshot-edit')).toBeVisible();

    await page.getByTestId('provider-card-moonshot-edit').hover();
    await page.getByTestId('provider-edit-moonshot-edit').click();

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-bad');
    await page.getByTestId('provider-edit-save-moonshot-edit').click();
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toContainText('Invalid API key');

    await page.getByTestId('provider-edit-key-input-moonshot-edit').fill('sk-good');
    await expect(page.getByTestId('provider-edit-validation-error-moonshot-edit')).toHaveCount(0);
    await page.getByTestId('provider-edit-save-moonshot-edit').click();

    await expect(page.getByTestId('provider-edit-save-moonshot-edit')).toHaveCount(0);
  });
});
