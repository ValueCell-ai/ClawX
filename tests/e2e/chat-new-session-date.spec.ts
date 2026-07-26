import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const CANONICAL_LIST_BARRIER_KEY = 'agent:main:canonical-list-barrier';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const DEFAULT_WORKSPACE_SEGMENT = '~%2F.openclaw%2Fworkspace';
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

function defaultWorkspaceSessionGroupTestId(): string {
  return `workspace-session-group-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function defaultWorkspaceSessionGroupToggleTestId(): string {
  return `workspace-session-group-toggle-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function defaultWorkspaceSessionLoadMoreTestId(): string {
  return `workspace-session-load-more-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function installDynamicAcpPromptMocks(app: ElectronApplication): Promise<void> {
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
    const globals = globalThis as unknown as {
      __newChatSessionKey?: string;
      __resolveNewChatLoad?: () => void;
    };

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (
        request.module === 'gateway'
        && request.action === 'rpc'
        && request.payload?.method === 'sessions.list'
        && globals.__newChatSessionKey
      ) {
        const now = Date.now();
        return {
          id: request.id,
          ok: true,
          data: {
            ts: now,
            sessions: [
              {
                key: globals.__newChatSessionKey,
                displayName: 'ACP',
                updatedAt: now,
                status: 'running',
              },
              {
                key: keys.barrierKey,
                displayName: 'Canonical list applied',
                updatedAt: now - 500,
              },
              { key: keys.mainSessionKey, displayName: 'main', updatedAt: now - 1000 },
            ],
          },
        };
      }
      if (request.module === 'chat' && (request.action === 'loadAcpSession' || request.action === 'sendAcpPrompt')) {
        const sessionKey = typeof request.payload?.sessionKey === 'string' ? request.payload.sessionKey : '';
        if (sessionKey) {
          globals.__newChatSessionKey = sessionKey;
        }
        if (request.action === 'loadAcpSession' && request.payload?.createIfMissing === true) {
          return await new Promise((resolve) => {
            globals.__resolveNewChatLoad = () => {
              globals.__resolveNewChatLoad = undefined;
              resolve({ id: request.id, ok: true, data: { success: true, generation: 1 } });
            };
          });
        }
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, { mainSessionKey: MAIN_SESSION_KEY, barrierKey: CANONICAL_LIST_BARRIER_KEY });
}

async function getNewChatSessionKey(app: ElectronApplication): Promise<string> {
  return await app.evaluate(async () => (
    (globalThis as unknown as { __newChatSessionKey?: string }).__newChatSessionKey ?? ''
  ));
}

async function releaseNewChatLoad(app: ElectronApplication): Promise<void> {
  await app.evaluate(async () => {
    (globalThis as unknown as { __resolveNewChatLoad?: () => void }).__resolveNewChatLoad?.();
  });
}

async function emitAcpSessionDisplayName(app: ElectronApplication, sessionKey: string): Promise<void> {
  await app.evaluate(async ({ app: _app }, key) => {
    const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('gateway:notification', {
        method: 'sessions.changed',
        params: {
          sessionKey: key,
          reason: 'message',
          ts: Date.now(),
          displayName: 'ACP',
          updatedAt: Date.now(),
        },
      });
    }
  }, sessionKey);
}

test.describe('ClawX chat workspace session list', () => {
  test('shows the first five default workspace sessions, loads more, and collapses all groups', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    const sessions = Array.from({ length: 6 }, (_entry, index) => ({
      key: index === 0 ? MAIN_SESSION_KEY : `agent:main:session-${nowMs - index}`,
      displayName: `Workspace conversation ${index + 1}`,
      updatedAt: nowMs - index,
    }));

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
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
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

      const defaultWorkspaceGroup = page.getByTestId(defaultWorkspaceSessionGroupTestId());
      const defaultWorkspaceToggle = page.getByTestId(defaultWorkspaceSessionGroupToggleTestId());
      const toggleAllButton = page.getByTestId('session-list-toggle-all');

      await expect(defaultWorkspaceToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggleAllButton).toHaveAttribute('aria-label', 'Collapse all');
      await expect(toggleAllButton).toHaveAttribute('title', 'Collapse all');
      for (let index = 1; index <= 5; index += 1) {
        await expect(defaultWorkspaceGroup.getByText(`Workspace conversation ${index}`)).toBeVisible();
      }
      await expect(defaultWorkspaceGroup.getByText('Workspace conversation 6')).toHaveCount(0);

      await page.getByTestId(defaultWorkspaceSessionLoadMoreTestId()).click();
      await expect(defaultWorkspaceGroup.getByText('Workspace conversation 6')).toBeVisible();
      await expect(page.getByTestId(defaultWorkspaceSessionLoadMoreTestId())).toHaveCount(0);

      await toggleAllButton.click();
      await expect(defaultWorkspaceToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggleAllButton).toHaveAttribute('aria-label', 'Expand all');
      await expect(toggleAllButton).toHaveAttribute('title', 'Expand all');
      await expect(defaultWorkspaceGroup.getByText('Workspace conversation 1')).toHaveCount(0);

      await toggleAllButton.click();
      await expect(defaultWorkspaceToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(defaultWorkspaceGroup.getByText('Workspace conversation 1')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('new chat stays hidden until its first prompt becomes the sidebar title', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const oldTimestampMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const prompt = 'Investigate the sidebar title race';
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
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
        },
      });
      await installDynamicAcpPromptMocks(app);

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId(defaultWorkspaceSessionGroupTestId())).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar-new-chat')).toBeVisible();

      await page.getByTestId('sidebar-new-chat').click();

      await expect(page.getByTestId(defaultWorkspaceSessionGroupTestId()).getByText(/agent:main:session-/)).toHaveCount(0);
      await expect(page.getByTestId(defaultWorkspaceSessionGroupToggleTestId())).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await page.getByTestId('chat-composer-input').fill(prompt);
      await page.getByTestId('chat-composer-send').click();

      await expect.poll(() => getNewChatSessionKey(app)).not.toBe('');
      const sessionKey = await getNewChatSessionKey(app);
      const sessionRow = page.getByTestId(`sidebar-session-${sessionKey}`);
      await page.evaluate((key) => {
        const state = { sawAcpTitle: false };
        const inspect = () => {
          const row = document.querySelector(`[data-testid="sidebar-session-${key}"]`);
          if (row?.textContent?.includes('ACP')) state.sawAcpTitle = true;
        };
        const observer = new MutationObserver(inspect);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
        (globalThis as unknown as {
          __newChatTitleObservation?: { observer: MutationObserver; state: typeof state };
        }).__newChatTitleObservation = { observer, state };
        inspect();
      }, sessionKey);
      await emitAcpSessionDisplayName(app, sessionKey);
      await expect(page.getByTestId(`sidebar-session-${CANONICAL_LIST_BARRIER_KEY}`)).toBeVisible();
      await expect(sessionRow).toHaveCount(0);
      await releaseNewChatLoad(app);

      await expect(sessionRow).toContainText(prompt);
      await expect(sessionRow).not.toContainText('ACP');
      const sawAcpTitle = await page.evaluate(() => {
        const observation = (globalThis as unknown as {
          __newChatTitleObservation?: { observer: MutationObserver; state: { sawAcpTitle: boolean } };
        }).__newChatTitleObservation;
        observation?.observer.disconnect();
        return observation?.state.sawAcpTitle ?? false;
      });
      expect(sawAcpTitle).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('cold-start heartbeat replacement uses its first prompt as the initial title', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    const prompt = 'Tell me a startup joke';

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              ts: nowMs,
              sessions: [
                {
                  key: MAIN_SESSION_KEY,
                  displayName: 'ClawX',
                  lastMessagePreview: '[OpenClaw heartbeat poll]',
                  updatedAt: nowMs,
                },
                {
                  key: 'agent:main:session-history',
                  displayName: 'Existing conversation',
                  derivedTitle: 'Existing conversation',
                  updatedAt: nowMs - 1000,
                },
              ],
            },
          },
          [stableStringify(['chat.history', null])]: {
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
              json: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
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
      await installDynamicAcpPromptMocks(app);

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill(prompt);
      await page.getByTestId('chat-composer-send').click();

      await expect.poll(() => getNewChatSessionKey(app)).not.toBe('');
      const sessionKey = await getNewChatSessionKey(app);
      const sessionRow = page.getByTestId(`sidebar-session-${sessionKey}`);
      await expect(sessionRow).toHaveCount(0);

      await releaseNewChatLoad(app);
      await expect(sessionRow).toContainText(prompt);
      await emitAcpSessionDisplayName(app, sessionKey);
      await expect(sessionRow).toContainText(prompt);
      await expect(sessionRow).not.toContainText('ACP');
    } finally {
      await closeElectronApp(app);
    }
  });
});
