import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const FIRST_SESSION_KEY = 'agent:main:main';
const SECOND_SESSION_KEY = 'agent:main:broken-export';
const WORKSPACE = '/workspace';
const REPORT_PATH = '/tmp/clawx-issue-report-20260825-123456Z.zip';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

async function installMocks(app: ElectronApplication): Promise<void> {
  const sessions = [
    { key: FIRST_SESSION_KEY, displayName: 'Current conversation', workspacePath: WORKSPACE, updatedAt: 2 },
    { key: SECOND_SESSION_KEY, displayName: 'Broken conversation', workspacePath: WORKSPACE, updatedAt: 1 },
  ];
  const sessionKeys = sessions.map((session) => session.key);
  const sessionsList = { success: true, result: { sessions } };
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 42, connectedAt: 1 },
    gatewayRpc: {
      [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: sessionsList,
      [stableStringify(['sessions.list', {}])]: sessionsList,
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
        agents: [{ id: 'main', name: 'Main', workspace: WORKSPACE, mainSessionKey: FIRST_SESSION_KEY }],
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
      [stableStringify(['chat', 'loadAcpSession', {
        sessionKey: FIRST_SESSION_KEY,
        workspaceRoot: WORKSPACE,
        cwd: WORKSPACE,
      }])]: { success: true, generation: 1 },
      [stableStringify(['diagnostics', 'exportIssueReport', { sessionKeys }])]: {
        success: true,
        path: REPORT_PATH,
        includedFiles: [
          'conversations/main/main.jsonl',
          'conversations/main/broken-export.jsonl',
          'config/openclaw.json',
        ],
      },
      [stableStringify(['shell', 'showItemInFolder', { path: REPORT_PATH }])]: undefined,
    },
    recordHostInvocations: true,
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

test.describe('settings issue report export', () => {
  test('shows bundle contents and exports all selected conversations', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installMocks(app);
      const page = await reloadStableWindow(app);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.getByTestId('settings-issue-report-open').click();

      const dialog = page.getByTestId('issue-report-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('issue-report-contents')).toContainText('Conversation transcripts');
      await expect(page.getByTestId('issue-report-contents')).toContainText('OpenClaw configuration');
      await expect(page.getByTestId('issue-report-contents')).toContainText('Diagnostic logs');

      await expect(page.getByTestId(`issue-report-session-${FIRST_SESSION_KEY}`)).toBeChecked();
      await expect(page.getByTestId(`issue-report-session-${SECOND_SESSION_KEY}`)).not.toBeChecked();
      await page.getByTestId('issue-report-select-all').check();
      await expect(page.getByTestId(`issue-report-session-${SECOND_SESSION_KEY}`)).toBeChecked();
      await expect(page.getByTestId('issue-report-selection-count')).toContainText('2');

      await page.getByTestId('issue-report-export').click();
      await expect(page.getByTestId('issue-report-path')).toHaveText(REPORT_PATH);
      await page.getByTestId('issue-report-reveal').click();

      const invocations = await app.evaluate(async () => (
        (globalThis as unknown as { __e2eHostInvocations?: Array<Record<string, unknown>> })
          .__e2eHostInvocations ?? []
      ));
      expect(invocations).toContainEqual(expect.objectContaining({
        module: 'diagnostics',
        action: 'exportIssueReport',
        payload: { sessionKeys: [FIRST_SESSION_KEY, SECOND_SESSION_KEY] },
      }));
      expect(invocations).toContainEqual(expect.objectContaining({
        module: 'shell',
        action: 'showItemInFolder',
        payload: { path: REPORT_PATH },
      }));
    } finally {
      await closeElectronApp(app);
    }
  });
});
