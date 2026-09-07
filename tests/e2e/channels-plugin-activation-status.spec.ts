import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Plugin channel activation status', () => {
  test('shows connecting for a configured plugin channel that is not live yet', async ({ electronApp, page }) => {
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
                  channelType: 'dingtalk',
                  defaultAccountId: 'default',
                  status: 'connecting',
                  accounts: [
                    {
                      accountId: 'default',
                      name: 'Primary Account',
                      configured: true,
                      status: 'connecting',
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
    await expect(page.getByTestId('channel-status-dingtalk')).toHaveText(/Connecting|连接中|接続中|Подключение/);
    await expect(page.getByTestId('channel-status-dingtalk')).not.toHaveText(/Disconnected|未连接|未接続|Отключён/);
  });
});
