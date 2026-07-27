import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const CONTROL_SESSION_KEY = 'agent:main:main';
const TARGET_SESSION_KEY = 'agent:main:attention-target';
const WORKSPACE = '/workspace';
const LIST_TS = 1_753_000_000_000;
const GATEWAY_CONNECTED_AT = 1_752_999_000_000;
const SESSIONS_LIST_PAYLOAD = { includeDerivedTitles: true, includeLastMessage: true };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function acpLoadResponse(sessionKey: string) {
  return {
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey,
      workspaceRoot: WORKSPACE,
      cwd: WORKSPACE,
    }])]: { success: true, generation: 1 },
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey,
      workspaceRoot: WORKSPACE,
      cwd: WORKSPACE,
      createIfMissing: true,
    }])]: { success: true, generation: 1 },
  };
}

async function installSessionAttentionMocks(app: ElectronApplication): Promise<void> {
  const sessions = [
    {
      key: CONTROL_SESSION_KEY,
      displayName: 'Control conversation',
      derivedTitle: 'Control conversation',
      workspacePath: WORKSPACE,
      updatedAt: LIST_TS - 1_000,
      status: 'done',
      hasActiveRun: false,
    },
    {
      key: TARGET_SESSION_KEY,
      displayName: 'Attention target',
      derivedTitle: 'Attention target',
      workspacePath: WORKSPACE,
      updatedAt: LIST_TS - 2_000,
      status: 'done',
      hasActiveRun: false,
    },
  ];
  const sessionsList = { success: true, result: { ts: LIST_TS, sessions } };
  const gatewayStatus = {
    state: 'running',
    gatewayReady: true,
    port: 18789,
    pid: 4242,
    connectedAt: GATEWAY_CONNECTED_AT,
  };
  const sessionKeys = sessions.map((session) => session.key);

  await installIpcMocks(app, {
    gatewayStatus,
    gatewayRpc: {
      [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
      [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: sessionsList,
      [stableStringify(['sessions.list', {}])]: sessionsList,
      ...Object.fromEntries(sessionKeys.flatMap((sessionKey) => [
        [stableStringify(['chat.history', { sessionKey, limit: 200, maxChars: 500000 }]), {
          success: true,
          result: { messages: [] },
        }],
        [stableStringify(['chat.history', { sessionKey, limit: 1000, maxChars: 500000 }]), {
          success: true,
          result: { messages: [] },
        }],
      ])),
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        setupComplete: true,
        chatWorkspacePath: WORKSPACE,
        recentWorkspacePaths: [WORKSPACE],
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{
          id: 'main',
          name: 'Main',
          workspace: WORKSPACE,
          mainSessionKey: CONTROL_SESSION_KEY,
        }],
        defaultAgentId: 'main',
      },
      [stableStringify(['sessions', 'summaries', { sessionKeys }])]: {
        success: true,
        summaries: sessions.map((session) => ({
          sessionKey: session.key,
          firstUserText: session.displayName,
          lastTimestamp: session.updatedAt,
          workspacePath: WORKSPACE,
        })),
      },
      [stableStringify(['files', 'resolveWorkspaceContext', {
        workspaceRoot: WORKSPACE,
        executionCwd: WORKSPACE,
      }])]: { ok: true, workspaceRoot: WORKSPACE, executionCwd: WORKSPACE },
      ...acpLoadResponse(CONTROL_SESSION_KEY),
      ...acpLoadResponse(TARGET_SESSION_KEY),
    },
  });
}

async function reloadStableWindow(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
  return page;
}

async function emitSessionSnapshot(
  app: ElectronApplication,
  input: { sessionKey: string; ts: number; status: 'running' | 'done'; hasActiveRun: boolean },
): Promise<void> {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('gateway:notification', {
        method: 'sessions.changed',
        params: {
          sessionKey: payload.sessionKey,
          ts: payload.ts,
          session: {
            key: payload.sessionKey,
            updatedAt: payload.ts,
            status: payload.status,
            hasActiveRun: payload.hasActiveRun,
          },
        },
      });
    }
  }, input);
}

test.describe('ClawX sidebar session attention', () => {
  test('projects Gateway busy and unread state through Chat mount, key changes, and unmount', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installSessionAttentionMocks(app);
      const page = await reloadStableWindow(app);
      const controlRow = page.getByTestId(`sidebar-session-${CONTROL_SESSION_KEY}`);
      const targetRow = page.getByTestId(`sidebar-session-${TARGET_SESSION_KEY}`);
      const targetTime = page.getByTestId(`sidebar-session-time-${TARGET_SESSION_KEY}`);
      const targetBusy = page.getByTestId(`sidebar-session-busy-${TARGET_SESSION_KEY}`);
      const targetUnread = page.getByTestId(`sidebar-session-unread-${TARGET_SESSION_KEY}`);

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(controlRow).toHaveAttribute('aria-current', 'page');
      await expect(targetRow).not.toHaveAttribute('aria-current', 'page');
      await expect(targetTime).toBeVisible();

      await targetRow.click();
      await expect(targetRow).toHaveAttribute('aria-current', 'page');

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toHaveCount(0);

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 1_000,
        status: 'running',
        hasActiveRun: true,
      });
      await expect(targetBusy).toBeVisible();
      await expect(targetBusy).toHaveAccessibleName('AI is replying');
      await expect(targetTime).toHaveCount(0);

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 2_000,
        status: 'done',
        hasActiveRun: false,
      });
      await expect(targetUnread).toBeVisible();
      await expect(targetUnread).toHaveAccessibleName('Unread reply');
      await expect(targetBusy).toHaveCount(0);

      await targetRow.click();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
      await expect(targetRow).toHaveAttribute('aria-current', 'page');
      await expect(targetUnread).toHaveCount(0);
      await page.getByTestId('chat-page').hover();
      await expect(targetTime).toBeVisible();

      await controlRow.click();
      await expect(controlRow).toHaveAttribute('aria-current', 'page');
      await expect(targetRow).not.toHaveAttribute('aria-current', 'page');

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 3_000,
        status: 'running',
        hasActiveRun: true,
      });
      await expect(targetBusy).toBeVisible();
      await expect(targetBusy).toHaveAccessibleName('AI is replying');

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 4_000,
        status: 'done',
        hasActiveRun: false,
      });
      await expect(targetBusy).toHaveCount(0);
      await expect(targetUnread).toBeVisible();
      await expect(targetUnread).toHaveAccessibleName('Unread reply');

      await targetRow.click();
      await expect(targetRow).toHaveAttribute('aria-current', 'page');
      await expect(targetUnread).toHaveCount(0);
      await page.getByTestId('chat-page').hover();
      await expect(targetTime).toBeVisible();

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 5_000,
        status: 'running',
        hasActiveRun: true,
      });
      await expect(targetBusy).toBeVisible();
      await expect(targetBusy).toHaveAccessibleName('AI is replying');

      await emitSessionSnapshot(app, {
        sessionKey: TARGET_SESSION_KEY,
        ts: LIST_TS + 6_000,
        status: 'done',
        hasActiveRun: false,
      });
      await expect(targetBusy).toHaveCount(0);
      await expect(targetUnread).toHaveCount(0);
      await expect(targetTime).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
