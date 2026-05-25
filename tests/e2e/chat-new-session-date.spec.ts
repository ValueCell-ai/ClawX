import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat session date grouping', () => {
  test('shows four collapsible history buckets with only recent buckets expanded', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    const sessions = [
      { key: MAIN_SESSION_KEY, displayName: 'Today conversation', updatedAt: nowMs - 60 * 60 * 1000 },
      { key: `agent:main:session-${nowMs - 2 * DAY_MS}`, displayName: 'Week conversation', updatedAt: nowMs - 2 * DAY_MS },
      { key: `agent:main:session-${nowMs - 10 * DAY_MS}`, displayName: 'Month conversation', updatedAt: nowMs - 10 * DAY_MS },
      { key: `agent:main:session-${nowMs - 40 * DAY_MS}`, displayName: 'Older conversation', updatedAt: nowMs - 40 * DAY_MS },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: { sessions },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('session-bucket-toggle-today')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('session-bucket-toggle-withinWeek')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('session-bucket-toggle-withinMonth')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('session-bucket-toggle-older')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('session-bucket-today').getByText('Today conversation')).toBeVisible();
      await expect(page.getByTestId('session-bucket-withinWeek').getByText('Week conversation')).toBeVisible();
      await expect(page.getByText('Month conversation')).toHaveCount(0);
      await expect(page.getByText('Older conversation')).toHaveCount(0);

      await page.getByTestId('session-bucket-toggle-withinMonth').click();
      await page.getByTestId('session-bucket-toggle-older').click();

      await expect(page.getByTestId('session-bucket-withinMonth').getByText('Month conversation')).toBeVisible();
      await expect(page.getByTestId('session-bucket-older').getByText('Older conversation')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('new chat appears in the Today session bucket', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const oldTimestampMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const seededHistory = [
      { role: 'user', content: 'Existing conversation', timestamp: oldTimestampMs },
      { role: 'assistant', content: 'Existing reply', timestamp: oldTimestampMs + 1000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'main',
                updatedAt: oldTimestampMs,
              }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByText('Existing conversation')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('sidebar-new-chat').click();

      await expect(page.getByTestId('session-bucket-today').getByText(/agent:main:session-/)).toBeVisible();
      await expect(page.getByTestId('session-bucket-older')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
