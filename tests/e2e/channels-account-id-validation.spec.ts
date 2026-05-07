import { completeSetup, expect, test } from './fixtures/electron';

const testConfigResponses = {
  channelsAccounts: {
    success: true,
    channels: [
      {
        channelType: 'feishu',
        defaultAccountId: 'default',
        status: 'connected',
        accounts: [
          {
            accountId: 'default',
            name: 'Primary Account',
            configured: true,
            status: 'connected',
            isDefault: true,
          },
        ],
      },
    ],
  },
  agents: {
    success: true,
    agents: [],
  },
  credentialsValidate: {
    success: true,
    valid: true,
    warnings: [],
  },
  channelConfig: {
    success: true,
  },
};

test.describe('Channels account ID validation', () => {
  test('rejects non-canonical custom account ID before save', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, responses) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eChannelConfigSaveCount = 0;
      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';

        if (path === '/api/channels/accounts' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: responses.channelsAccounts } };
        }
        if (path === '/api/agents' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: responses.agents } };
        }
        if (path === '/api/channels/credentials/validate' && method === 'POST') {
          return { ok: true, data: { status: 200, ok: true, json: responses.credentialsValidate } };
        }
        if (path === '/api/channels/config' && method === 'POST') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eChannelConfigSaveCount += 1;
          return { ok: true, data: { status: 200, ok: true, json: responses.channelConfig } };
        }
        if (path.startsWith('/api/channels/config/') && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, values: {} } } };
        }
        return {
          ok: false,
          error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` },
        };
      });
    }, testConfigResponses);

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();

    await page.getByRole('button', { name: /Add Account|account\.add/i }).click();
    await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeVisible();

    await page.locator('#account-id').fill('测试账号');
    await page.locator('#appId').fill('cli_test');
    await page.locator('#appSecret').fill('secret_test');

    await page.getByRole('button', { name: /Save & Connect|dialog\.saveAndConnect/ }).click();
    await expect(page.getByText(/account\.invalidCanonicalId|must use lowercase letters/i).first()).toBeVisible();

    const saveCalls = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = Number((globalThis as any).__clawxE2eChannelConfigSaveCount || 0);
      return { count };
    });
    expect(saveCalls.count).toBe(0);
  });
});
