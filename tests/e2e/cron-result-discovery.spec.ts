import type { ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const JOB_ID = 'job-water-reminder';
const CRON_SESSION_KEY = `agent:main:cron:${JOB_ID}`;
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const TASK_NAME = '喝水';
const TASK_MESSAGE = '提醒我喝水';
const TASK_REPLY = '该喝水了！请喝一杯水。';
const RUN_ERROR = 'Scheduled model request timed out';

type FixtureJob = Record<string, unknown> & { id: string };
type CronResultFixture = {
  job?: FixtureJob;
  finished: boolean;
  triggerCount: number;
  result: string;
};

async function installCronResultFixture(app: ElectronApplication): Promise<void> {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {},
    emptyAcpSessions: [MAIN_SESSION_KEY, CRON_SESSION_KEY],
    hostApi: {
      [JSON.stringify(['/api/agents', 'GET'])]: {
        success: true,
        agents: [{
          id: 'main',
          name: 'Main Agent',
          isDefault: true,
          workspace: DEFAULT_WORKSPACE,
          mainSessionKey: MAIN_SESSION_KEY,
        }],
      },
      [JSON.stringify(['/api/channels/accounts', 'GET'])]: { success: true, channels: [] },
    },
  });

  await app.evaluate(({ ipcMain }, fixture) => {
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type HostHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const original = (ipcMain as unknown as {
      _invokeHandlers: Map<string, HostHandler>;
    })._invokeHandlers.get('host:invoke')!;
    const state: CronResultFixture = { finished: false, triggerCount: 0, result: '' };
    (globalThis as unknown as { __cronResultFixture: CronResultFixture }).__cronResultFixture = state;
    const respond = (id: string | undefined, data: unknown) => ({ id, ok: true, data });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: HostRequest) => {
      if (request.module === 'gateway' && request.action === 'rpc'
        && request.payload?.method === 'sessions.list') {
        return respond(request.id, {
          ts: Date.now(),
          sessions: [
            { key: fixture.mainSessionKey, displayName: 'main', updatedAt: Date.now() - 60_000 },
            ...(state.finished ? [{
              key: fixture.cronSessionKey,
              label: `Automation: ${fixture.taskName}`,
              displayName: `Automation: ${fixture.taskName}`,
              workspacePath: fixture.workspace,
              updatedAt: Date.now(),
            }] : []),
          ],
        });
      }
      if (request.module !== 'cron') return original(event, request);
      if (request.action === 'list') return respond(request.id, state.job ? [state.job] : []);
      if (request.action === 'create') {
        state.job = {
          ...request.payload,
          id: fixture.jobId,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentId: 'main',
        };
        return respond(request.id, state.job);
      }
      if (request.action === 'trigger') {
        if (request.payload?.id !== fixture.jobId) throw new Error('Unexpected cron job');
        state.triggerCount += 1;
        // Current OpenClaw acknowledges enqueueing before the result exists.
        return respond(request.id, { ok: true, enqueued: true, runId: 'manual-water-run' });
      }
      if (request.action === 'sessionHistory') {
        return respond(request.id, {
          messages: state.finished ? [
            { id: 'water-prompt', role: 'user', content: fixture.taskMessage, timestamp: Date.now() - 1000 },
            { id: 'water-reply', role: 'assistant', content: state.result, timestamp: Date.now() },
          ] : [],
        });
      }
      throw new Error(`Unexpected cron fixture action: ${request.action}`);
    });
  }, {
    mainSessionKey: MAIN_SESSION_KEY,
    cronSessionKey: CRON_SESSION_KEY,
    jobId: JOB_ID,
    workspace: DEFAULT_WORKSPACE,
    taskName: TASK_NAME,
    taskMessage: TASK_MESSAGE,
  });
}

async function finishRun(app: ElectronApplication, success: boolean): Promise<void> {
  await app.evaluate(({ BrowserWindow }, result) => {
    const state = (globalThis as unknown as { __cronResultFixture: CronResultFixture }).__cronResultFixture;
    if (!state.job) throw new Error('Cron job has not been created');
    state.finished = true;
    state.result = result.message;
    state.job = {
      ...state.job,
      lastRun: {
        time: new Date().toISOString(),
        success: result.success,
        duration: 3000,
        ...(!result.success ? { error: result.message } : {}),
      },
    };
    for (const win of BrowserWindow.getAllWindows()) {
      // Deliberately send no sessions.changed event: the cron completion itself
      // must discover the newly persisted base session and refresh the task card.
      win.webContents.send('gateway:notification', {
        method: 'cron',
        params: {
          action: 'finished',
          jobId: result.jobId,
          status: result.success ? 'ok' : 'error',
          sessionKey: `${result.sessionKey}:run:water-run`,
          ts: Date.now(),
        },
      });
    }
  }, {
    jobId: JOB_ID,
    sessionKey: CRON_SESSION_KEY,
    success,
    message: success ? TASK_REPLY : RUN_ERROR,
  });
}

test('discovers an internal cron result after enqueueing and refreshes a later scheduled failure', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installCronResultFixture(app);
    const page = await getStableWindow(app);
    await page.reload().catch((error: unknown) => {
      if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
    });
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-new-task-button').click();
    const dialog = page.getByTestId('cron-task-dialog');
    await dialog.locator('#name').fill(TASK_NAME);
    await dialog.locator('#message').fill(TASK_MESSAGE);
    await dialog.getByRole('button', { name: 'Create Task', exact: true }).click();
    await expect(dialog).toBeHidden();

    const card = page.getByTestId(`cron-job-card-${JOB_ID}`);
    const sidebarResult = page.getByTestId(`sidebar-session-${CRON_SESSION_KEY}`);
    await expect(card).toBeVisible();
    expect(await app.evaluate(() => (
      (globalThis as unknown as { __cronResultFixture: CronResultFixture }).__cronResultFixture.job?.delivery
    ))).toEqual({ mode: 'none' });
    await expect(sidebarResult).toHaveCount(0);
    await card.hover();
    const runNow = card.getByRole('button', { name: 'Run Now', exact: true });
    await runNow.click();
    await expect.poll(() => app.evaluate(() => (
      (globalThis as unknown as { __cronResultFixture: CronResultFixture }).__cronResultFixture.triggerCount
    ))).toBe(1);
    await expect(runNow).toBeEnabled();
    await expect(sidebarResult).toHaveCount(0);

    await finishRun(app, true);
    await expect(sidebarResult).toBeVisible();
    await sidebarResult.click();
    await expect(page.getByText(TASK_REPLY, { exact: true })).toBeVisible();

    // A subsequent scheduled run has no manual trigger or page reload to refresh
    // the cached job list; its completion must still publish the error promptly.
    await page.getByTestId('sidebar-nav-cron').click();
    await expect(card).toBeVisible();
    await finishRun(app, false);
    await expect(card.getByText(RUN_ERROR, { exact: true })).toBeVisible();
    expect(await app.evaluate(() => (
      (globalThis as unknown as { __cronResultFixture: CronResultFixture }).__cronResultFixture.triggerCount
    ))).toBe(1);
  } finally {
    await closeElectronApp(app);
  }
});
