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
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
      }) => {

        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, responses.channelsAccounts);
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, responses.agents);
        }
        if (request?.module === 'channels' && request.action === 'validateCredentials') {
          return respond(request.id, responses.credentialsValidate);
        }
        if (request?.module === 'channels' && request.action === 'saveConfig') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxE2eChannelConfigSaveCount += 1;
          return respond(request.id, responses.channelConfig);
        }
        if (request?.module === 'channels' && request.action === 'formValues') {
          return respond(request.id, { success: true, values: {} });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
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
