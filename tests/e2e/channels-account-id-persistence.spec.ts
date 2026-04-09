import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Channels account editor behavior', () => {
  test('keeps Feishu credentials when account ID is changed', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      hostApi: {
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
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
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              success: true,
              agents: [],
            },
          },
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();

    const addAccountButton = page.locator('button').filter({
      hasText: /Add Account|添加账号|アカウントを追加/,
    }).first();
    await expect(addAccountButton).toBeVisible();
    await addAccountButton.click();

    const appIdInput = page.locator('input#appId');
    const appSecretInput = page.locator('input#appSecret');
    const accountIdInput = page.locator('input#account-id');

    await expect(appIdInput).toBeVisible();
    await expect(appSecretInput).toBeVisible();
    await expect(accountIdInput).toBeVisible();

    await appIdInput.fill('cli_test_app');
    await appSecretInput.fill('secret_test_value');
    await accountIdInput.fill('feishu-renamed-account');

    await expect(appIdInput).toHaveValue('cli_test_app');
    await expect(appSecretInput).toHaveValue('secret_test_value');
  });
});
