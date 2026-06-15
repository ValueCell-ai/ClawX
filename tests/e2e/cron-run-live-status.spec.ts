import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const CRON_BASE_KEY = 'agent:main:cron:job-cron-live';
const CRON_RUN_KEY = `${CRON_BASE_KEY}:run:run-session-1`;
const CRON_RUN_ID = 'run-cron-live';
const CRON_TRIGGER_TEXT = '[cron:job-cron-live] Summarize today important AI news';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const cronTriggerHistory = [
  {
    role: 'user',
    id: 'cron-trigger',
    content: [{ type: 'text', text: CRON_TRIGGER_TEXT }],
    timestamp: Date.now(),
  },
];

test.describe('ClawX cron run live status', () => {
  test('renders the execution graph live for a cron run without switching sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const cronSession = {
        key: CRON_BASE_KEY,
        displayName: 'Cron: 早报',
        label: 'Cron: 早报',
        updatedAt: Date.now(),
      };

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                cronSession,
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: CRON_BASE_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: cronTriggerHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
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

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

      // Open the cron session (default startup lands on the main session).
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();

      // Transcript loads the cron trigger message; the run has not started yet,
      // so no live execution graph is present.
      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      // The Gateway streams runtime events under the run-scoped session key.
      // They must bind to the base cron session currently in view.
      await app.evaluate(({ BrowserWindow }, { runId, sessionKey }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.started',
            runId,
            sessionKey,
            startedAt: Date.now(),
          });
        }
      }, { runId: CRON_RUN_ID, sessionKey: CRON_RUN_KEY });

      await app.evaluate(({ BrowserWindow }, { runId, sessionKey }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId,
            sessionKey,
            toolCallId: 'call-web-search',
            name: 'web_search',
            args: { query: 'AI news June 2026' },
          });
        }
      }, { runId: CRON_RUN_ID, sessionKey: CRON_RUN_KEY });

      // The live execution graph renders without any session switch — this is
      // the regression being guarded against.
      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 30_000 });

      // The run settles back to idle when the Gateway reports run.ended.
      await app.evaluate(({ BrowserWindow }, { runId, sessionKey }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId,
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, { runId: CRON_RUN_ID, sessionKey: CRON_RUN_KEY });

      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('adopts an already-running cron run joined mid-flight (no run.started received)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const cronSession = {
        key: CRON_BASE_KEY,
        displayName: 'Cron: 早报',
        label: 'Cron: 早报',
        updatedAt: Date.now(),
      };

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                cronSession,
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: CRON_BASE_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: cronTriggerHistory },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
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

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      const cronSidebarButton = page.getByTestId(`sidebar-session-${CRON_BASE_KEY}`);
      await expect(cronSidebarButton).toBeVisible({ timeout: 30_000 });
      await cronSidebarButton.click();
      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);

      // Simulate joining a run already in progress: the first runtime event the
      // renderer sees is a tool event (run.started happened before the user
      // opened the session). The run must still be adopted and rendered live.
      await app.evaluate(({ BrowserWindow }, { runId, sessionKey }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId,
            sessionKey,
            toolCallId: 'call-read-skill',
            name: 'read',
            args: { path: '~/.openclaw/skills/docx/SKILL.md' },
          });
        }
      }, { runId: CRON_RUN_ID, sessionKey: CRON_RUN_KEY });

      await expect(page.getByTestId('chat-execution-graph')).toBeVisible({ timeout: 30_000 });

      await app.evaluate(({ BrowserWindow }, { runId, sessionKey }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId,
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, { runId: CRON_RUN_ID, sessionKey: CRON_RUN_KEY });

      await expect(page.getByText(CRON_TRIGGER_TEXT)).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
