import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const BASE_HOST_API = {
  [stableStringify(['/api/gateway/status', 'GET'])]: {
    ok: true,
    data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
  },
  [stableStringify(['/api/cron/jobs', 'GET'])]: {
    ok: true,
    data: { status: 200, ok: true, json: [] },
  },
  [stableStringify(['/api/channels/accounts', 'GET'])]: {
    ok: true,
    data: { status: 200, ok: true, json: { success: true, channels: [] } },
  },
  [stableStringify(['/api/agents', 'GET'])]: {
    ok: true,
    data: {
      status: 200,
      ok: true,
      json: {
        agents: [{
          id: 'main',
          name: 'Main Agent',
          isDefault: true,
          modelDisplay: 'Default Model',
          modelRef: 'openai/gpt-5.5',
          overrideModelRef: null,
          inheritedModel: true,
          workspace: '/tmp/clawx-main-agent',
          agentDir: '/tmp/clawx-main-agent/agent',
          mainSessionKey: 'main/default',
          channelTypes: [],
        }],
        defaultAgentId: 'main',
        defaultModelRef: 'openai/gpt-5.5',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
    },
  },
};

test.describe('cron schedule builder', () => {
  test('replaces preset templates with recurring/once tabs', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {},
      hostApi: BASE_HOST_API,
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-new-task-button').click();
    await expect(page.getByTestId('cron-task-dialog')).toBeVisible();

    // The old preset template grid is gone.
    await expect(page.getByRole('button', { name: 'Every 5 minutes' })).toHaveCount(0);

    // Recurring is the default tab and exposes the frequency dropdown.
    const recurrenceSelect = page.getByTestId('cron-recurrence-select');
    await expect(recurrenceSelect).toBeVisible();

    // Weekly recurrence reveals the weekday selector.
    await recurrenceSelect.selectOption('weekly');
    await expect(page.getByTestId('cron-weekday-select')).toBeVisible();

    // Custom recurrence reveals the cron expression field.
    await recurrenceSelect.selectOption('custom');
    await expect(page.getByTestId('cron-custom-input')).toBeVisible();

    // Switching to the Once tab reveals date + time inputs.
    await page.getByTestId('cron-schedule-tab-once').click();
    await expect(page.locator('#cron-once-date')).toBeVisible();
    await expect(page.locator('#cron-once-time')).toBeVisible();
    await expect(page.getByTestId('cron-recurrence-select')).toHaveCount(0);

    // The custom 24h time picker exposes hours 0-23 and no AM/PM controls.
    await page.locator('#cron-once-time').click();
    await expect(page.getByRole('button', { name: '23', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'AM' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'PM' })).toHaveCount(0);
  });
});
