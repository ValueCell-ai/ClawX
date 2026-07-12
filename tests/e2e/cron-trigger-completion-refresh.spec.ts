import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const pendingJob = {
  id: 'job-async-completion',
  name: 'Async completion',
  message: 'Observe runtime completion',
  schedule: { kind: 'cron', expr: '0 9 * * *' },
  enabled: true,
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  agentId: 'main',
  timeoutMins: 1,
};

test.describe('Cron trigger completion refresh', () => {
  test('renders an asynchronous runtime result after trigger acknowledgement', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: {
        state: 'running',
        port: 18789,
        pid: 12345,
        gatewayReady: true,
        runtimeKind: 'cc-connect',
      },
      hostApi: {
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: [pendingJob] },
        },
        [stableStringify(['cron', 'trigger', { id: pendingJob.id }])]: {
          success: true,
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: { success: true, channels: [] } },
        },
      },
    });

    await electronApp.evaluate(async ({ app: _app }, job) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      type InvokeHandler = (event: unknown, request: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })._invokeHandlers;
      const original = handlers?.get('host:invoke');
      let listCalls = 0;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
      }) => {
        if (request.module === 'cron' && request.action === 'list') {
          listCalls += 1;
          const completed = listCalls >= 3;
          return {
            id: request.id,
            ok: true,
            data: [{
              ...job,
              ...(completed ? {
                lastRun: {
                  time: '2026-07-13T01:00:00.000Z',
                  success: false,
                  error: 'cc-connect provider request failed',
                },
              } : {}),
            }],
          };
        }
        return await original?.(event, request);
      });
    }, pendingJob);

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-cron').click();
    const card = page.getByTestId(`cron-job-card-${pendingJob.id}`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Run Now' }).click();

    await expect(page.getByText('Task triggered successfully')).toBeVisible();
    await expect(page.getByTestId(`cron-job-card-last-run-${pendingJob.id}`))
      .toHaveAttribute('data-run-status', 'error', { timeout: 10_000 });
    await expect(card.getByText('cc-connect provider request failed')).toBeVisible();
  });
});
