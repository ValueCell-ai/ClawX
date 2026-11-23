import { completeSetup, expect, getRecordedHostInvocations, installIpcMocks, test } from './fixtures/electron';
import { selectValue } from './fixtures/radix-select';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

test('creates a WeChat task with account-scoped recipients from real SQLite metadata', async ({ electronApp, page, homeDir }) => {
  // Seed only this test's home. The target request uses the production Main service.
  await electronApp.evaluate(async (_, home) => {
    const { mkdirSync } = process.mainModule!.require('node:fs') as typeof import('node:fs');
    const { join } = process.mainModule!.require('node:path') as typeof import('node:path');
    const { DatabaseSync } = process.mainModule!.require('node:sqlite') as typeof import('node:sqlite');
    const agentDir = join(home, '.openclaw', 'agents', 'main', 'agent');
    mkdirSync(agentDir, { recursive: true });
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    try {
      db.exec('CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)');
      for (const [accountId, to] of [['wx-primary', 'PrimaryPeer@im.wechat'], ['wx-secondary', 'SecondaryPeer@im.wechat']]) {
        db.prepare('INSERT INTO session_nodes VALUES (?, ?)').run(`agent:main:openclaw-weixin:direct:${to}`, JSON.stringify({
          updatedAt: Date.now(),
          delivery: {
            kind: 'external',
            context: { channel: 'openclaw-weixin', accountId, to },
            origin: { provider: 'openclaw-weixin', accountId, to, chatType: 'direct' },
            route: { channel: 'openclaw-weixin', accountId, target: { to, chatType: 'direct' } },
          },
        }));
      }
    } finally {
      db.close();
    }
  }, homeDir);

  const input = {
    name: 'WeChat scheduled delivery', message: 'Send the daily summary',
    schedule: '0 9 * * *',
    delivery: { mode: 'announce', channel: 'wechat', accountId: 'wx-secondary', to: 'SecondaryPeer@im.wechat' },
    enabled: true, agentId: 'main',
  };
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
    gatewayRpc: {},
    recordHostInvocations: true,
    hostApi: {
      [stableStringify(['cron', 'list', null])]: { data: [] },
      [stableStringify(['/api/channels/accounts', 'GET'])]: { data: { success: true, channels: [{
        channelType: 'wechat', defaultAccountId: 'wx-primary', status: 'connected',
        accounts: ['wx-primary', 'wx-secondary', 'wx-empty'].map((accountId) => ({
          accountId, name: accountId, configured: true, connected: true, running: true,
          linked: true, status: 'connected', isDefault: accountId === 'wx-primary',
        })),
      }] } },
      [stableStringify(['/api/agents', 'GET'])]: { data: {
        agents: [{ id: 'main', name: 'Main Agent', isDefault: true, channelTypes: [], workspace: homeDir }],
        defaultAgentId: 'main', configuredChannelTypes: ['wechat'], channelOwners: {}, channelAccountOwners: {},
      } },
      // Intercept creation so the regression never sends an external message.
      [stableStringify(['cron', 'create', input])]: { data: {
        ...input, id: 'wechat-job', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } },
    },
  });
  await page.reload();
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-cron').click();
  await page.getByTestId('cron-new-task-button').click();
  const dialog = page.getByTestId('cron-task-dialog');
  await dialog.locator('#name').fill(input.name);
  await dialog.locator('#message').fill(input.message);
  await selectValue(page.getByTestId('cron-recurrence-select'), 'custom');
  await page.getByTestId('cron-custom-input').fill(input.schedule);
  await dialog.getByRole('button', { name: 'Messaging app', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Channel', exact: true })).toHaveText('WeChat');
  const account = dialog.locator('#delivery-account');
  const target = dialog.locator('#delivery-target-select');
  const recipientList = page.getByRole('listbox');
  const primaryRecipient = recipientList.locator('[data-value="PrimaryPeer@im.wechat"]');
  const secondaryRecipient = recipientList.locator('[data-value="SecondaryPeer@im.wechat"]');
  await target.click();
  await expect(primaryRecipient).toBeVisible();
  await expect(secondaryRecipient).toHaveCount(0);
  await primaryRecipient.click();
  await selectValue(account, 'wx-empty');
  await expect(target).toBeDisabled();
  await expect(target).toHaveText('Select a delivery target');
  await expect(dialog.getByText('No delivery targets are available for the selected WeChat account.')).toBeVisible();
  await selectValue(account, 'wx-secondary');
  await target.click();
  await expect(secondaryRecipient).toBeVisible();
  await expect(primaryRecipient).toHaveCount(0);
  await secondaryRecipient.click();
  await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await getRecordedHostInvocations(electronApp);
  expect(calls.find((call) => call.module === 'cron' && call.action === 'create')?.payload).toEqual(input);
});
