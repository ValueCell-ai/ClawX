import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeElectronApp,
  emitAcpSessionUpdates,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

const PARENT_KEY = 'agent:main:main';
const HISTORICAL_CHILD_KEY = 'agent:main:subagent:historical-child';
const LIVE_CHILD_KEY = 'agent:main:subagent:canonical-live-child';
const SIGNAL_ONLY_CHILD_KEY = 'agent:main:subagent:signal-only';
const OTHER_KEY = 'agent:main:other';
const WORKSPACE = '/workspace';
const LIST_PAYLOAD = { includeDerivedTitles: true, includeLastMessage: true };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function loadResponses(sessionKey: string): Record<string, unknown> {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey, workspaceRoot: WORKSPACE, cwd: WORKSPACE }])]: {
      success: true,
      generation: 1,
    },
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey,
      workspaceRoot: WORKSPACE,
      cwd: WORKSPACE,
      createIfMissing: true,
    }])]: { success: true, generation: 1 },
  };
}

async function installSubagentFixture(app: ElectronApplication): Promise<void> {
  const now = Date.now();
  const sessions = [
    {
      key: PARENT_KEY,
      displayName: 'Parent conversation',
      derivedTitle: 'Parent conversation',
      workspacePath: WORKSPACE,
      updatedAt: now,
      status: 'done',
      hasActiveRun: false,
    },
    {
      key: HISTORICAL_CHILD_KEY,
      displayName: '[Subagent Context] Gateway historical title',
      derivedTitle: '[Subagent Context] Gateway historical title',
      workspacePath: WORKSPACE,
      updatedAt: now - 1,
      status: 'running',
      hasActiveRun: true,
    },
    {
      key: LIVE_CHILD_KEY,
      displayName: 'Gateway live title',
      derivedTitle: 'Gateway live title',
      workspacePath: WORKSPACE,
      updatedAt: now - 2,
      status: 'done',
      hasActiveRun: false,
    },
    {
      key: OTHER_KEY,
      displayName: 'Other conversation',
      derivedTitle: 'Other conversation',
      workspacePath: WORKSPACE,
      updatedAt: now - 3,
      status: 'done',
      hasActiveRun: false,
    },
  ];
  const sessionKeys = sessions.map((session) => session.key);
  const listResult = { success: true, result: { ts: now, sessions } };

  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 4242, connectedAt: now - 1000 },
    gatewayRpc: {
      [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
      [stableStringify(['sessions.list', LIST_PAYLOAD])]: listResult,
      [stableStringify(['sessions.list', {}])]: listResult,
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
        agents: [{ id: 'main', name: 'Main', workspace: WORKSPACE, mainSessionKey: PARENT_KEY }],
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
      ...loadResponses(PARENT_KEY),
      ...loadResponses(HISTORICAL_CHILD_KEY),
      ...loadResponses(LIVE_CHILD_KEY),
      ...loadResponses(OTHER_KEY),
    },
  });

  await app.evaluate(async ({ app: _app }, keys) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type HostHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const state = {
      includeLiveChild: false,
      familyRequests: [] as string[],
    };
    (globalThis as unknown as { __subagentFixture?: typeof state }).__subagentFixture = state;
    const member = (sessionKey: string, title: string, parentSessionKey: string | null) => ({
      sessionKey,
      title,
      updatedAt: null,
      parentSessionKey,
    });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (request.module === 'chat' && request.action === 'getAcpSessionFamily') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        state.familyRequests.push(sessionKey);
        if (sessionKey === keys.parentKey) {
          return {
            id: request.id,
            ok: true,
            data: {
              success: true,
              current: member(keys.parentKey, 'Parent conversation', null),
              children: [
                member(keys.historicalChildKey, '[Subagent Context] Historical ACP child', keys.parentKey),
                ...(state.includeLiveChild
                  ? [member(keys.liveChildKey, '[Subagent Context] Canonical live ACP child', keys.parentKey)]
                  : []),
              ],
            },
          };
        }
        if (sessionKey === keys.historicalChildKey || sessionKey === keys.liveChildKey) {
          return {
            id: request.id,
            ok: true,
            data: {
              success: true,
              current: member(sessionKey, 'Child conversation', keys.parentKey),
              children: [],
            },
          };
        }
        return { id: request.id, ok: true, data: { success: true, current: null, children: [] } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, {
    parentKey: PARENT_KEY,
    historicalChildKey: HISTORICAL_CHILD_KEY,
    liveChildKey: LIVE_CHILD_KEY,
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

async function emitSessionStatus(
  app: ElectronApplication,
  sessionKey: string,
  status: 'running' | 'done',
  hasActiveRun: boolean,
): Promise<void> {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('gateway:notification', {
        method: 'sessions.changed',
        params: {
          sessionKey: payload.sessionKey,
          ts: Date.now(),
          session: {
            key: payload.sessionKey,
            status: payload.status,
            hasActiveRun: payload.hasActiveRun,
            updatedAt: Date.now(),
          },
        },
      });
    }
  }, { sessionKey, status, hasActiveRun });
}

async function emitSessionDeletion(app: ElectronApplication, sessionKey: string): Promise<void> {
  await app.evaluate(async ({ app: _app }, key) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('gateway:notification', {
        method: 'sessions.changed',
        params: { sessionKey: key, reason: 'delete', ts: Date.now() },
      });
    }
  }, sessionKey);
}

async function emitSuccessfulSpawn(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app: _app }, keys) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const state = (globalThis as unknown as {
      __subagentFixture?: { includeLiveChild: boolean };
    }).__subagentFixture;
    if (!state) throw new Error('Subagent fixture is not installed');
    state.includeLiveChild = true;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('chat:acp-session-update', {
        sessionKey: keys.parentKey,
        generation: 1,
        notification: {
          sessionId: keys.parentKey,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'spawn-live-child',
            title: 'sessions_spawn: live child',
            status: 'completed',
            rawOutput: {
              content: [{ type: 'text', text: 'accepted' }],
              details: {
                status: 'accepted',
                runId: 'run-signal-only',
                childSessionKey: keys.signalOnlyChildKey,
              },
            },
          },
        },
      });
    }
  }, { parentKey: PARENT_KEY, signalOnlyChildKey: SIGNAL_ONLY_CHILD_KEY });
}

test.describe('ClawX embedded subagent sessions', () => {
  test('restores, updates, and navigates ACP children while keeping their catalog rows out of the sidebar', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installSubagentFixture(app);
      let page = await reloadStableWindow(app);

      await expect(page.getByTestId(`sidebar-session-${PARENT_KEY}`)).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${HISTORICAL_CHILD_KEY}`)).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-${LIVE_CHILD_KEY}`)).toHaveCount(0);

      const toggle = page.getByTestId('acp-subagent-sessions-toggle');
      await expect(toggle).toContainText('Dispatched 1 subagents');
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveAccessibleName('Subagents working…');
      const position = await page.evaluate(() => {
        const indicator = document.querySelector<HTMLElement>('[data-testid="chat-composer-working-indicator"]');
        const subagents = document.querySelector<HTMLElement>('[data-testid="acp-subagent-sessions-toggle"]');
        if (!indicator || !subagents) return null;
        const indicatorBox = indicator.getBoundingClientRect();
        const subagentsBox = subagents.getBoundingClientRect();
        return {
          indicatorRight: indicatorBox.right,
          indicatorTop: indicatorBox.top,
          subagentsRight: subagentsBox.right,
          subagentsTop: subagentsBox.top,
        };
      });
      expect(position).not.toBeNull();
      expect(position!.subagentsRight).toBeCloseTo(position!.indicatorRight, 0);
      expect(position!.subagentsTop).toBeCloseTo(position!.indicatorTop, 0);
      await toggle.click();
      let panel = page.getByTestId('acp-subagent-sessions-panel');
      await expect(panel).toBeVisible();
      const panelBox = await panel.boundingBox();
      const toggleBox = await toggle.boundingBox();
      expect(panelBox).toBeTruthy();
      expect(toggleBox).toBeTruthy();
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(toggleBox!.y);
      await expect(panel.getByTestId('acp-subagent-session-row').filter({ hasText: 'Historical ACP child' })).toBeVisible();
      await expect(panel).not.toContainText('[Subagent Context]');
      await expect(panel).not.toContainText('Gateway historical title');

      await emitSessionStatus(app, HISTORICAL_CHILD_KEY, 'running', true);
      await expect(page.getByTestId('acp-subagent-sessions-status')).toHaveText('Subagents: Running');
      await expect(panel).toBeVisible();
      await panel.getByRole('button', { name: 'Open subagent Historical ACP child' }).click();
      await expect(page.getByTestId('chat-subagent-marker')).toHaveText('Subagent');
      await expect(page.getByTestId('chat-composer-box')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveAccessibleName('Thinking…');
      await emitAcpSessionUpdates(app, {
        sessionKey: HISTORICAL_CHILD_KEY,
        generation: 1,
        updates: [
          {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Checking live child evidence.' },
          },
          {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'live-child-message',
            content: { type: 'text', text: 'Live child progress before completion.' },
          },
        ],
      });
      await expect(page.getByTestId('acp-thought-block')).toContainText('Checking live child evidence.');
      const liveChildMessage = page.getByTestId('acp-assistant-message')
        .filter({ hasText: 'Live child progress before completion.' });
      await expect(liveChildMessage).toBeVisible();
      await expect(liveChildMessage.locator('[data-sd-animate]')).not.toHaveCount(0);
      await emitAcpSessionUpdates(app, {
        sessionKey: HISTORICAL_CHILD_KEY,
        generation: 1,
        updates: [{
          sessionUpdate: 'tool_call',
          toolCallId: 'live-child-tool',
          title: 'Fetch live child source',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'Fetching source live.' } }],
          locations: [],
        }],
      });
      const liveChildTool = page.getByTestId('acp-tool-call-card')
        .filter({ hasText: 'Fetch live child source' });
      await expect(liveChildTool).toBeVisible();
      await expect(liveChildTool).toContainText('Running');
      await expect(liveChildTool).toHaveAttribute('data-expanded', 'true');
      await emitAcpSessionUpdates(app, {
        sessionKey: HISTORICAL_CHILD_KEY,
        generation: 1,
        updates: [{
          sessionUpdate: 'tool_call_update',
          toolCallId: 'live-child-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Source fetched live.' } }],
          locations: [],
        }],
      });
      await expect(liveChildTool).toContainText('Completed');
      await expect(liveChildTool).toContainText('Source fetched live.');
      await emitAcpSessionUpdates(app, {
        sessionKey: HISTORICAL_CHILD_KEY,
        generation: 1,
        updates: [{
          sessionUpdate: 'agent_message_chunk',
          messageId: 'live-child-message',
          content: { type: 'text', text: ' More output arrived live.' },
        }],
      });
      const laterLiveChildMessage = page.getByTestId('acp-assistant-message')
        .filter({ hasText: 'More output arrived live.' });
      await expect(laterLiveChildMessage).toBeVisible();
      const orderedLiveParts = page.getByTestId('acp-assistant-turn')
        .locator('[data-testid="acp-assistant-message"], [data-testid="acp-tool-call-card"]');
      await expect(orderedLiveParts).toHaveCount(3);
      await expect(orderedLiveParts.nth(0)).toContainText('Live child progress before completion.');
      await expect(orderedLiveParts.nth(1)).toContainText('Fetch live child source');
      await expect(orderedLiveParts.nth(2)).toContainText('More output arrived live.');
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveAccessibleName('Thinking…');
      await emitSessionStatus(app, HISTORICAL_CHILD_KEY, 'done', false);
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0);
      await expect(laterLiveChildMessage.locator('[data-sd-animate]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Return to parent conversation' }).click();
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      panel = page.getByTestId('acp-subagent-sessions-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('acp-subagent-sessions-status')).toHaveText('Subagents: Settled');
      await expect(panel).toBeVisible();

      await emitSuccessfulSpawn(app);
      await expect(toggle).toContainText('Dispatched 2 subagents');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId('acp-subagent-session-row').filter({ hasText: 'Canonical live ACP child' })).toBeVisible();
      await expect(panel).not.toContainText(SIGNAL_ONLY_CHILD_KEY);

      await panel.getByRole('button', { name: 'Open subagent Historical ACP child' }).click();
      await expect(page.getByTestId('chat-subagent-marker')).toHaveText('Subagent');
      await expect(page.getByRole('button', { name: 'Return to parent conversation' })).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${HISTORICAL_CHILD_KEY}`)).toHaveCount(0);

      await page.getByRole('button', { name: 'Return to parent conversation' }).click();
      await expect(page.getByTestId('acp-subagent-sessions-toggle')).toContainText('Dispatched 2 subagents');

      page = await reloadStableWindow(app);
      await expect(page.getByTestId('acp-subagent-sessions-toggle')).toContainText('Dispatched 2 subagents');
      await expect(page.getByTestId(`sidebar-session-${HISTORICAL_CHILD_KEY}`)).toHaveCount(0);
      await expect(page.getByTestId(`sidebar-session-${LIVE_CHILD_KEY}`)).toHaveCount(0);

      await page.getByTestId('acp-subagent-sessions-toggle').click();
      await page.getByRole('button', { name: 'Open subagent Historical ACP child' }).click();
      await expect(page.getByTestId('chat-subagent-marker')).toHaveText('Subagent');
      await expect(page.getByRole('button', { name: 'Return to parent conversation' })).toBeVisible();

      await emitSessionDeletion(app, PARENT_KEY);

      await expect(page.getByTestId('chat-subagent-marker')).toHaveText('Subagent');
      await expect(page.getByRole('button', { name: 'Return to parent conversation' })).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
