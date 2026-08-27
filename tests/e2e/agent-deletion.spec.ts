import {
  closeElectronApp,
  expect,
  getRecordedHostInvocations,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const DELETED_AGENT_MAIN_KEY = 'agent:test1:main';
const DELETED_AGENT_CHAT_KEY = 'agent:test1:session-123';
const SESSIONS_LIST_PAYLOAD = { includeDerivedTitles: true, includeLastMessage: true };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

const mainAgent = {
  id: 'main',
  name: 'Main Agent',
  isDefault: true,
  modelDisplay: 'Default model',
  modelRef: null,
  overrideModelRef: null,
  inheritedModel: false,
  workspace: '/tmp/main-workspace',
  agentDir: '/tmp/main-agent',
};
const deletedAgent = {
  ...mainAgent,
  id: 'test1',
  name: 'Test Agent',
  isDefault: false,
  workspace: '/tmp/test1-workspace',
  agentDir: '/tmp/test1-agent',
};
const baseSnapshot = {
  agents: [mainAgent, deletedAgent],
  defaultAgentId: 'main',
  defaultModelRef: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};
const deletedSnapshot = {
  ...baseSnapshot,
  agents: [mainAgent],
  removedWorkspacePath: deletedAgent.workspace,
};

test.describe('Agent deletion session reconciliation', () => {
  test('warns about chat history and removes deleted-agent conversations immediately', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          gatewayReady: true,
          port: 18789,
          pid: 9876,
          connectedAt: 1,
        },
        recordHostInvocations: true,
        gatewayRpc: {
          [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              ts: 100,
              sessions: [
                { key: MAIN_SESSION_KEY, derivedTitle: 'Main conversation', workspacePath: '/tmp/main-workspace' },
                { key: DELETED_AGENT_MAIN_KEY, derivedTitle: 'Deleted agent main', workspacePath: '/tmp/test1-workspace' },
                { key: DELETED_AGENT_CHAT_KEY, derivedTitle: 'Deleted agent chat', workspacePath: '/tmp/test1-workspace' },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['settings', 'getAll', null])]: {
            language: 'en',
            setupComplete: true,
            chatWorkspacePath: deletedAgent.workspace,
            recentWorkspacePaths: [deletedAgent.workspace, mainAgent.workspace],
            workspaceLabels: {
              [deletedAgent.workspace]: 'Deleted agent workspace',
              [mainAgent.workspace]: 'Main workspace',
            },
          },
          [stableStringify(['agents', 'list', null])]: baseSnapshot,
          [stableStringify(['agents', 'delete', { id: 'test1' }])]: deletedSnapshot,
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['providers', 'accounts', null])]: [],
          [stableStringify(['providers', 'accountKeyInfo', null])]: [],
          [stableStringify(['providers', 'vendors', null])]: [],
          [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: null },
          [stableStringify(['providers', 'list', null])]: [],
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByText('Deleted agent main')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Deleted agent chat')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      const agentCard = page.getByTestId('agent-card-test1');
      await expect(agentCard).toBeVisible();
      await agentCard.hover();
      await page.getByTestId('agent-delete-test1').click();

      await expect(page.getByText('Permanently delete Agent?')).toBeVisible();
      await expect(page.getByText(/all associated chat history/i)).toBeVisible();
      await expect(page.getByText(/cannot be undone/i)).toBeVisible();
      await page.getByTestId('confirm-dialog-confirm-button').click();

      await expect(agentCard).toHaveCount(0);
      await expect(page.getByText('Deleted agent main')).toHaveCount(0);
      await expect(page.getByText('Deleted agent chat')).toHaveCount(0);
      await expect(page.getByText('Main conversation')).toBeVisible();

      await app.evaluate(async ({ app: _app }, sessionKey) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('gateway:notification', {
            method: 'sessions.changed',
            params: {
              sessionKey,
              ts: 200,
              session: { key: sessionKey, derivedTitle: 'Delayed deleted-agent event' },
            },
          });
        }
      }, DELETED_AGENT_CHAT_KEY);
      await page.waitForTimeout(200);
      await expect(page.getByText('Delayed deleted-agent event')).toHaveCount(0);

      await expect.poll(async () => {
        const invocations = await getRecordedHostInvocations(app);
        return invocations.some((entry) => (
          entry.module === 'settings'
          && entry.action === 'setMany'
          && entry.payload?.patch?.chatWorkspacePath === '~/.openclaw/workspace'
          && JSON.stringify(entry.payload.patch.recentWorkspacePaths) === JSON.stringify([
            '~/.openclaw/workspace',
            mainAgent.workspace,
          ])
          && JSON.stringify(entry.payload.patch.workspaceLabels) === JSON.stringify({
            [mainAgent.workspace]: 'Main workspace',
          })
        ));
      }).toBe(true);

      await page.getByTestId('sidebar-new-chat').click();
      const workspaceSelector = page.getByTestId('chat-workspace-selector');
      await expect(workspaceSelector).not.toHaveAttribute('aria-disabled', 'true');
      await workspaceSelector.click();
      const workspaceMenu = page.getByTestId('chat-workspace-menu');
      await expect(workspaceMenu).toBeVisible();
      await expect(workspaceMenu.getByTestId(
        `chat-workspace-option-${encodeURIComponent(deletedAgent.workspace)}`,
      )).toHaveCount(0);

      await expect.poll(async () => {
        const invocations = await getRecordedHostInvocations(app);
        return invocations.some((entry) => (
          entry.module === 'agents'
          && entry.action === 'delete'
          && entry.payload?.id === 'test1'
        ));
      }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
