import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const stableStringify = (value: unknown): string => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
};

test('task list does not present OpenClaw internal automations', async ({ electronApp, page }) => {
  const base = {
    enabled: true, createdAtMs: 1_700_000_000_000, updatedAtMs: 1_700_000_000_000,
    schedule: { kind: 'cron', expr: '0 3 * * *' },
    payload: { kind: 'agentTurn', message: 'My own reminder' },
    delivery: { mode: 'none' }, state: {},
  };
  const jobs = [
    { ...base, id: 'system-heartbeat', name: 'heartbeat-main', declarationKey: 'heartbeat:main', payload: { kind: 'heartbeat' } },
    { ...base, id: 'system-dream', name: 'Memory Dreaming Promotion', declarationKey: 'memory-core:memory-dreaming-promotion' },
    { ...base, id: 'legacy-dream', name: 'Memory Dreaming Promotion', payload: {
      kind: 'agentTurn', message: '__openclaw_memory_core_short_term_promotion_dream__',
    } },
    { ...base, id: 'user-dream', name: 'Memory Dreaming Promotion' },
    { ...base, id: 'user-heartbeat', name: 'heartbeat-main' },
  ];
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    hostApi: {
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
      },
      [stableStringify(['/api/cron/jobs', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: jobs },
      },
    },
  });
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-cron').click();
  await expect(page.getByTestId('cron-job-card-user-dream')).toBeVisible();
  await expect(page.getByTestId('cron-job-card-user-heartbeat')).toBeVisible();
  await expect(page.getByTestId('cron-job-card-system-heartbeat')).toHaveCount(0);
  await expect(page.getByTestId('cron-job-card-system-dream')).toHaveCount(0);
  await expect(page.getByTestId('cron-job-card-legacy-dream')).toHaveCount(0);
});
