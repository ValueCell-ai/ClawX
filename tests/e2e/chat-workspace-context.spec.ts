import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-a';
const SESSION_WORKSPACE = '/Users/e2e/workspace/ClawX';
const SESSION_WORKSPACE_LABEL = '~/workspace/ClawX';
const GLOBAL_WORKSPACE = '/Users/e2e/workspace/GlobalProject';
const GLOBAL_WORKSPACE_LABEL = '~/workspace/GlobalProject';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const AUTO_TITLE_WITH_CWD = `[Working directory: ${DEFAULT_WORKSPACE}]\n\nWorkspace chat`;
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

function hostJson(json: unknown) {
  return {
    ok: true,
    data: {
      status: 200,
      ok: true,
      json,
    },
  };
}

function workspaceSessionGroupTestId(workspacePath: string): string {
  return `workspace-session-group-${encodeURIComponent(workspacePath)}`;
}

async function installWorkspaceTreeMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, { workspacePath }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const globals = globalThis as unknown as {
      __workspaceListTreeRequests?: Array<{ path: string; includeHidden?: boolean }>;
    };
    globals.__workspaceListTreeRequests = [];

    ipcMain.removeHandler('file:listTree');
    ipcMain.handle('file:listTree', async (_event: unknown, inputPath: string, opts?: { includeHidden?: boolean }) => {
      globals.__workspaceListTreeRequests?.push({ path: inputPath, includeHidden: opts?.includeHidden });

      if (inputPath !== workspacePath || opts?.includeHidden !== true) {
        return { ok: false, error: 'unexpectedListTreeRequest' };
      }

      return {
        ok: true,
        root: {
          name: 'ClawX',
          relPath: '',
          absPath: workspacePath,
          isDir: true,
          children: [
            {
              name: 'README.md',
              relPath: 'README.md',
              absPath: `${workspacePath}/README.md`,
              isDir: false,
              size: 128,
              mtime: Date.now(),
            },
          ],
        },
        truncated: false,
      };
    });
  }, { workspacePath: SESSION_WORKSPACE });
}

async function getWorkspaceTreeRequests(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as {
      __workspaceListTreeRequests?: Array<{ path: string; includeHidden?: boolean }>;
    }).__workspaceListTreeRequests ?? [];
  });
}

type WorkspaceMockOptions = {
  chatWorkspacePath?: string;
  recentWorkspacePaths?: string[];
  workspaceLabels?: Record<string, string>;
  sessionHistory?: Array<{ role: string; content: unknown; timestamp?: number }>;
  sessionDerivedTitle?: string | null;
  sessionSummaryFirstUserText?: string | null;
};

async function installWorkspaceMocks(app: ElectronApplication, options: WorkspaceMockOptions = {}) {
  const nowMs = Date.now();
  const gatewayStatus = { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: nowMs };
  const sessionHistory = options.sessionHistory ?? [];
  const settingsSnapshot = {
    language: 'en',
    setupComplete: true,
    chatWorkspacePath: options.chatWorkspacePath ?? DEFAULT_WORKSPACE,
    recentWorkspacePaths: options.recentWorkspacePaths ?? [DEFAULT_WORKSPACE],
    workspaceLabels: options.workspaceLabels ?? {},
  };
  const sessionRow = {
    key: SESSION_KEY,
    displayName: 'Gateway session display name',
    updatedAt: nowMs,
    ...(typeof options.sessionDerivedTitle === 'string' ? { derivedTitle: options.sessionDerivedTitle } : {}),
  };
  const sessionSummaries = {
    summaries: [{
      sessionKey: SESSION_KEY,
      firstUserText: options.sessionSummaryFirstUserText ?? null,
      lastTimestamp: nowMs,
      workspacePath: SESSION_WORKSPACE,
    }],
  };
  const acpLoadResult = { success: true, generation: 1 };

  await installIpcMocks(app, {
    gatewayStatus,
    gatewayRpc: {
      [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
        success: true,
        result: {
          sessions: [sessionRow],
        },
      },
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: [sessionRow],
        },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: sessionHistory },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: sessionHistory },
      },
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: settingsSnapshot,
      [stableStringify(['settings', 'setMany', {
        patch: { workspaceLabels: { [SESSION_WORKSPACE]: 'Renamed workspace' } },
      }])]: { success: true },
      [stableStringify(['/api/settings', 'GET'])]: hostJson(settingsSnapshot),
      [stableStringify(['/api/gateway/status', 'GET'])]: hostJson(gatewayStatus),
      [stableStringify(['/api/agents', 'GET'])]: hostJson({
        success: true,
        agents: [{
          id: 'main',
          name: 'Main Agent',
          workspace: DEFAULT_WORKSPACE,
          mainSessionKey: 'agent:main:main',
        }],
        defaultAgentId: 'main',
      }),
      [stableStringify(['sessions', 'summaries', { sessionKeys: [SESSION_KEY] }])]: sessionSummaries,
      [stableStringify(['/api/sessions/summaries', 'POST'])]: hostJson(sessionSummaries),
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: acpLoadResult,
      [stableStringify(['chat', 'loadAcpSession', { sessionKey: SESSION_KEY, workspaceRoot: SESSION_WORKSPACE, cwd: SESSION_WORKSPACE }])]: acpLoadResult,
    },
  });

  await installWorkspaceTreeMock(app);
}

test.describe('ClawX chat workspace context', () => {
  test('bound session shows read-only workspace and workspace tree uses the same cwd', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installWorkspaceMocks(app, {
        sessionDerivedTitle: AUTO_TITLE_WITH_CWD,
        sessionSummaryFirstUserText: null,
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      const workspaceSelector = page.getByTestId('chat-workspace-selector');
      await expect(workspaceSelector).toBeVisible({ timeout: 30_000 });
      await expect(workspaceSelector).toContainText('ClawX');
      await expect(workspaceSelector).toHaveText(SESSION_WORKSPACE_LABEL);
      await expect(workspaceSelector).toHaveAttribute('title', SESSION_WORKSPACE);
      await expect(workspaceSelector).toHaveAttribute('aria-disabled', 'true');
      await expect(workspaceSelector).toHaveClass(/border-transparent/);

      const sidebar = page.getByTestId('sidebar');
      const workspaceGroup = sidebar.getByTestId(workspaceSessionGroupTestId(SESSION_WORKSPACE));
      await expect(workspaceGroup).toBeVisible();
      await expect(workspaceGroup).toContainText('Workspace chat');
      await expect(workspaceGroup).not.toContainText('[Working directory:');
      const workspaceToggle = workspaceGroup.getByRole('button', {
        name: `Toggle workspace ${SESSION_WORKSPACE_LABEL}`,
      });
      await expect(workspaceToggle).toHaveAttribute('title', SESSION_WORKSPACE);

      await workspaceToggle.hover();
      await workspaceGroup.getByRole('button', { name: `Rename workspace ${SESSION_WORKSPACE_LABEL}` }).click();
      await workspaceGroup.getByRole('textbox', { name: 'Workspace name' }).fill('Renamed workspace');
      await workspaceGroup.getByRole('button', { name: 'Save workspace name' }).click();

      await expect(workspaceGroup).toContainText('Renamed workspace');
      await expect(workspaceSelector).toHaveText('Renamed workspace');
      await expect(workspaceSelector).toHaveAttribute('title', SESSION_WORKSPACE);

      await page.getByTestId('chat-toolbar-workspace').click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await sidePanel.getByTestId('artifact-panel-tab-browser').click();

      const workspaceHeader = sidePanel.getByTestId('workspace-header-title');
      const expectedWorkspaceHeader = 'Agent: Main Agent · Directory: Renamed workspace';
      await expect(workspaceHeader).toHaveAttribute('title', expectedWorkspaceHeader);
      await expect(workspaceHeader).toHaveAttribute('aria-label', expectedWorkspaceHeader);
      await expect(sidePanel.getByTestId('workspace-agent-tag')).toHaveText('Main Agent');
      await expect(sidePanel.getByTestId('workspace-agent-tag')).toHaveAttribute('title', 'Main Agent');
      await expect(sidePanel.getByTestId('workspace-path-tag')).toHaveText('Renamed workspace');
      await expect(sidePanel.getByTestId('workspace-path-tag')).toHaveAttribute('title', SESSION_WORKSPACE);
      await expect(sidePanel.getByTestId('workspace-path-final-segment')).toHaveText('Renamed workspace');
      await expect(sidePanel.getByTestId('workspace-tree')).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByText('README.md')).toBeVisible();

      await expect.poll(async () => {
        const requests = await getWorkspaceTreeRequests(app);
        return requests.some((request) => request.path === SESSION_WORKSPACE && request.includeHidden === true);
      }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('host summary title stays clean when a derived title is unavailable', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installWorkspaceMocks(app, {
        sessionDerivedTitle: null,
        sessionSummaryFirstUserText: AUTO_TITLE_WITH_CWD,
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      const sidebar = page.getByTestId('sidebar');
      const workspaceGroup = sidebar.getByTestId(workspaceSessionGroupTestId(SESSION_WORKSPACE));
      await expect(workspaceGroup).toBeVisible({ timeout: 30_000 });
      await expect(workspaceGroup).toContainText('Workspace chat');
      await expect(workspaceGroup).not.toContainText('[Working directory:');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('new unbound chat stays hidden until it has content and then appears under the selected global workspace group', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installWorkspaceMocks(app, {
        chatWorkspacePath: GLOBAL_WORKSPACE,
        recentWorkspacePaths: [GLOBAL_WORKSPACE, DEFAULT_WORKSPACE],
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      const workspaceSelector = page.getByTestId('chat-workspace-selector');
      await expect(workspaceSelector).toHaveText(SESSION_WORKSPACE_LABEL, { timeout: 30_000 });

      const sidebar = page.getByTestId('sidebar');
      const globalWorkspaceGroup = sidebar.getByTestId(workspaceSessionGroupTestId(GLOBAL_WORKSPACE));

      await expect(async () => {
        await page.getByTestId('sidebar-new-chat').click();
        await expect(globalWorkspaceGroup.getByText(/agent:main:session-/)).toHaveCount(0, { timeout: 500 });
      }).toPass({ timeout: 30_000 });

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();

      await expect(workspaceSelector).toHaveText(GLOBAL_WORKSPACE_LABEL);
      await expect(workspaceSelector).toHaveAttribute('title', GLOBAL_WORKSPACE);
      await expect(workspaceSelector).not.toHaveAttribute('aria-disabled', 'true');

      const defaultWorkspaceGroupWithPendingSession = sidebar.getByTestId(workspaceSessionGroupTestId(DEFAULT_WORKSPACE))
        .filter({ hasText: /agent:main:session-/ });
      await expect(defaultWorkspaceGroupWithPendingSession).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
