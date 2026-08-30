import type { ElectronApplication } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getRecordedHostInvocations,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';
import { expandAcpToolCallsGroup } from './fixtures/acp-timeline';

const MAIN_SESSION_KEY = 'agent:main:main';
const TALK_SESSION_KEY = 'agent:main:talk-e2e';
const MAIN_WORKSPACE = '/workspace';
const DEFAULT_WORKSPACE = '~/.openclaw/workspace';
const REVIEWER_SESSION_KEY = 'agent:reviewer:main';
const REVIEWER_WORKSPACE = '/workspace/reviewer';
const IMAGE_TASK_ID = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
const GENERATED_IMAGE_PATH = '/workspace/.openclaw/media/tool-image-generation/generated-image.png';
const GENERATED_IMAGE_PREVIEW = 'data:image/png;base64,iVBORw0KGgo=';
const GENERATED_IMAGE_IDENTITY = 'e2e-transcript-generated-image';
const DEFAULT_WORKSPACE_SEGMENT = '~%2F.openclaw%2Fworkspace';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };
type AcpSessionCatalog = Array<{ key: string; displayName: string; workspacePath: string }>;
type AcpSessionReplayResponses = Record<string, AcpSessionUpdate[][]>;

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function defaultWorkspaceSessionGroupTestId(): string {
  return `workspace-session-group-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function baseHostApiMocks(loadResult: Record<string, unknown> = { success: true, generation: 1 }) {
  return {
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE, createIfMissing: true }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: '/', cwd: '/' }])]: loadResult,
    [stableStringify(['chat', 'loadAcpSession', { sessionKey: MAIN_SESSION_KEY, workspaceRoot: '/', cwd: '/', createIfMissing: true }])]: loadResult,
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          agents: [{
            id: 'main',
            name: 'main',
            workspace: MAIN_WORKSPACE,
            mainSessionKey: MAIN_SESSION_KEY,
          }],
        },
      },
    },
  };
}

async function installAcpChatMocks(
  app: ElectronApplication,
  loadResult: Record<string, unknown> = { success: true, generation: 1 },
  sessionCatalog: AcpSessionCatalog = [{
    key: MAIN_SESSION_KEY,
    displayName: 'main',
    workspacePath: MAIN_WORKSPACE,
  }],
) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: {
          sessions: sessionCatalog,
        },
      },
    },
    hostApi: baseHostApiMocks(loadResult),
    recordHostInvocations: true,
  });
}

async function installAcpLoadReplayMock(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  timings: Array<{
    normalizedUserText: string;
    userOccurrenceFromTail: number;
    durationMs: number;
  }> = [],
) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; args?: unknown[] }) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        return {
          id: request.id,
          ok: true,
          data: {
            success: true,
            generation: 1,
            sessionUpdates: (payload.updates as AcpSessionUpdate[]).map((update) => ({
              sessionKey: payload.sessionKey,
              generation: 1,
              historical: true,
              notification: {
                sessionId: payload.sessionKey,
                update,
              },
            })),
          },
        };
      }
      if (request?.module === 'sessions' && request.action === 'turnTimings') {
        return {
          id: request.id,
          ok: true,
          data: { success: true, timings: payload.timings },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { sessionKey: MAIN_SESSION_KEY, updates, timings });
}

async function installAcpLoadReplayBySessionMock(
  app: ElectronApplication,
  updatesBySessionKey: AcpSessionReplayResponses,
) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
      args?: unknown[];
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as {
      __acpLoadSessionKeys?: string[];
      __acpLoadReplayResponseIndexes?: Record<string, number>;
    };
    globals.__acpLoadSessionKeys = [];
    globals.__acpLoadReplayResponseIndexes = {};
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] : undefined);
        const sessionKey = requestPayload && typeof requestPayload === 'object'
          ? String((requestPayload as Record<string, unknown>).sessionKey ?? '')
          : '';
        globals.__acpLoadSessionKeys?.push(sessionKey);
        const responseIndex = globals.__acpLoadReplayResponseIndexes?.[sessionKey] ?? 0;
        if (globals.__acpLoadReplayResponseIndexes) {
          globals.__acpLoadReplayResponseIndexes[sessionKey] = responseIndex + 1;
        }
        return {
          id: request.id,
          ok: true,
          data: {
            success: true,
            generation: 1,
            sessionUpdates: (payload.updatesBySessionKey[sessionKey]?.[responseIndex] ?? []).map((update) => ({
              sessionKey,
              generation: 1,
              historical: true,
              notification: {
                sessionId: sessionKey,
                update,
              },
            })),
          },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { updatesBySessionKey });
}

async function installConsultReplayLoadMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
      args?: unknown[];
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    let consultSessionLoads = 0;
    const globals = globalThis as unknown as {
      __consultAcpLoadCount?: number;
      __consultAcpDurableReplayFlags?: boolean[];
    };
    globals.__consultAcpLoadCount = 0;
    globals.__consultAcpDurableReplayFlags = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] : undefined);
      if (
        request?.module === 'chat'
        && request.action === 'loadAcpSession'
        && requestPayload?.sessionKey === payload.sessionKey
      ) {
        consultSessionLoads += 1;
        globals.__consultAcpLoadCount = consultSessionLoads;
        globals.__consultAcpDurableReplayFlags?.push(requestPayload?.forceDurableReplay === true);
        return {
          id: request.id,
          ok: true,
          data: consultSessionLoads === 1
            ? { success: true, generation: 1 }
            : {
              success: true,
              generation: 2,
              sessionUpdates: [
                {
                  sessionKey: payload.sessionKey,
                  generation: 2,
                  historical: true,
                  notification: {
                    sessionId: payload.sessionKey,
                    update: {
                      sessionUpdate: 'user_message',
                      messageId: 'consult-user',
                      content: [{ type: 'text', text: 'Durable consult prompt' }],
                    },
                  },
                },
                {
                  sessionKey: payload.sessionKey,
                  generation: 2,
                  historical: true,
                  notification: {
                    sessionId: payload.sessionKey,
                    update: {
                      sessionUpdate: 'agent_message',
                      messageId: 'consult-assistant',
                      content: [{ type: 'text', text: 'Durable consult answer' }],
                    },
                  },
                },
              ],
            },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { sessionKey: TALK_SESSION_KEY });
}

async function getConsultAcpLoadCount(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => (
    (globalThis as unknown as { __consultAcpLoadCount?: number }).__consultAcpLoadCount ?? 0
  ));
}

async function getConsultAcpDurableReplayFlags(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => (
    (globalThis as unknown as { __consultAcpDurableReplayFlags?: boolean[] }).__consultAcpDurableReplayFlags ?? []
  ));
}

async function installAcpLoadRecorderMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
      args?: unknown[];
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as { __acpLoadSessionKeys?: string[] };
    globals.__acpLoadSessionKeys = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'chat' && request.action === 'loadAcpSession') {
        const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] : undefined);
        const sessionKey = requestPayload && typeof requestPayload === 'object'
          ? String((requestPayload as Record<string, unknown>).sessionKey ?? '')
          : '';
        globals.__acpLoadSessionKeys?.push(sessionKey);

        if (sessionKey === payload.mainSessionKey) {
          return {
            id: request.id,
            ok: true,
            data: { success: false, error: 'Unexpected heartbeat-only session load in E2E test' },
          };
        }
        if (/^agent:main:session-/.test(sessionKey)) {
          return { id: request.id, ok: true, data: { success: true, generation: 1 } };
        }
        return {
          id: request.id,
          ok: true,
          data: { success: false, error: `Unexpected ACP session load in E2E test: ${sessionKey}` },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, { mainSessionKey: MAIN_SESSION_KEY });
}

async function getRecordedAcpLoadSessionKeys(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as { __acpLoadSessionKeys?: string[] }).__acpLoadSessionKeys ?? [];
  });
}

async function installMediaSaveRecorder(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as { __mediaSaveImagePayloads?: Record<string, unknown>[] };
    globals.__mediaSaveImagePayloads = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (request?.module === 'media' && request.action === 'saveImage' && request.payload) {
        globals.__mediaSaveImagePayloads?.push(request.payload);
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function getRecordedMediaSaveImagePayloads(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as { __mediaSaveImagePayloads?: Record<string, unknown>[] }).__mediaSaveImagePayloads ?? [];
  });
}

async function installAcpPromptSuccessMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function installAcpPromptTimingMock(
  app: ElectronApplication,
  timing: { normalizedUserText: string; durationMs: number },
) {
  await app.evaluate(async ({ app: _app }, transcriptTiming) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: {
      id?: string;
      module?: string;
      action?: string;
    }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: {
      id?: string;
      module?: string;
      action?: string;
    }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      if (request?.module === 'sessions' && request.action === 'turnTimings') {
        return {
          id: request.id,
          ok: true,
          data: {
            success: true,
            timings: [{
              ...transcriptTiming,
              userOccurrenceFromTail: 1,
            }],
          },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, timing);
}

async function installAcpPromptFailureMock(app: ElectronApplication, error: string) {
  await app.evaluate(async ({ app: _app }, promptError) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return { id: request.id, ok: true, data: { success: false, error: promptError } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, error);
}

async function installTargetAgentRequestRecorder(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, targetSessionKey) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
      args?: unknown[];
    };
    type RecordedRequest = { action: string; payload: Record<string, unknown> };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    const globals = globalThis as unknown as { __targetAgentRequests?: RecordedRequest[] };
    globals.__targetAgentRequests = [];

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] : undefined);
      if (
        request?.module === 'chat'
        && (request.action === 'loadAcpSession' || request.action === 'sendAcpPrompt')
        && requestPayload?.sessionKey === targetSessionKey
      ) {
        globals.__targetAgentRequests?.push({
          action: request.action,
          payload: requestPayload,
        });
        return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  }, REVIEWER_SESSION_KEY);
}

async function getTargetAgentRequests(app: ElectronApplication) {
  return await app.evaluate(async ({ app: _app }) => {
    return (globalThis as unknown as {
      __targetAgentRequests?: Array<{ action: string; payload: Record<string, unknown> }>;
    }).__targetAgentRequests ?? [];
  });
}

async function installAcpPromptDeferredMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return await new Promise((resolve) => {
          (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt = () => resolve({ id: request.id, ok: true, data: { success: true, generation: 1 } });
        });
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function resolveDeferredAcpPrompt(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt?.();
  });
}

async function installAcpReactivationWithPartialTimingMock(
  app: ElectronApplication,
  prompt: string,
) {
  await app.evaluate(async ({ app: _app }, payload) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostInvokeRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    let mainSessionLoadCount = 0;

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
      if (
        request.module === 'chat'
        && request.action === 'loadAcpSession'
        && request.payload?.sessionKey === payload.sessionKey
      ) {
        mainSessionLoadCount += 1;
        return {
          id: request.id,
          ok: true,
          data: {
            success: true,
            generation: 1,
            ...(mainSessionLoadCount > 1 ? { resumedActivePrompt: true } : {}),
          },
        };
      }
      if (request.module === 'sessions' && request.action === 'turnTimings') {
        return {
          id: request.id,
          ok: true,
          data: {
            success: true,
            timings: mainSessionLoadCount > 1
              ? [{
                normalizedUserText: payload.prompt,
                userOccurrenceFromTail: 1,
                durationMs: 5_000,
              }]
              : [],
          },
        };
      }
      return originalHostInvoke?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, { sessionKey: MAIN_SESSION_KEY, prompt });
}

async function emitAcpSessionUpdates(
  app: ElectronApplication,
  updates: AcpSessionUpdate[],
  generation = 1,
) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const update of payload.updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey: payload.sessionKey,
            generation: payload.generation,
            notification: {
              sessionId: payload.sessionKey,
              update,
            },
          });
        }
      }
    },
    { sessionKey: MAIN_SESSION_KEY, generation, updates },
  );
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('ClawX ACP inline timeline', () => {
  test('does not use legacy history on startup or current-session clicks', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await page.waitForTimeout(100);

      expect((await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'gateway'
        && call.action === 'rpc'
        && call.payload?.method === 'chat.history'
      ))).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows active ACP context usage from usage updates', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-context-usage')).toHaveCount(0);

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'usage_update',
        used: 25_000,
        size: 100_000,
      }]);

      const indicator = page.getByRole('progressbar', { name: '25% context used: 25,000 / 100,000 tokens' });
      await expect(indicator).toBeVisible({ timeout: 30_000 });
      await expect(indicator).toHaveAttribute('data-testid', 'chat-composer-context-usage');
      await expect(indicator).toHaveAttribute('aria-valuenow', '25');
      await expect(indicator).toContainText('25%');
      await expect(page.getByTestId('chat-composer-footer').getByTestId('chat-composer-context-usage')).toBeVisible();
      await expect(page.getByTestId('chat-composer-box').getByTestId('chat-composer-context-usage')).toHaveCount(0);
      const indicatorBox = await indicator.boundingBox();
      const gatewayBox = await page.getByTestId('chat-composer-gateway-status').boundingBox();
      expect(indicatorBox).toBeTruthy();
      expect(gatewayBox).toBeTruthy();
      expect(indicatorBox!.x).toBeLessThan(gatewayBox!.x);
      await indicator.focus();
      await expect(page.getByRole('tooltip')).toHaveText('25% context used: 25,000 / 100,000 tokens');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('plan indicator renders a live running session plan', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'tool_call',
        toolCallId: 'live-session-plan',
        title: 'update_plan: plan current work',
        status: 'in_progress',
        rawInput: {
          plan: [
            { step: 'Inspect the current implementation', status: 'completed' },
            { step: 'Exercise the live plan indicator', status: 'in_progress' },
            { step: 'Verify the replay path', status: 'pending' },
          ],
        },
        content: [],
        locations: [],
      }]);

      const toggle = page.getByTestId('acp-session-plan-toggle');
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveText('1 / 3');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('acp-session-plan-panel')).toHaveCount(0);
      await expect(toggle.locator('..').getByRole('button')).toHaveCount(1);
      const composerBox = await page.getByTestId('chat-composer-box').boundingBox();
      const toggleBox = await toggle.boundingBox();
      expect(composerBox).toBeTruthy();
      expect(toggleBox).toBeTruthy();
      expect(toggleBox!.x + toggleBox!.width).toBeGreaterThan(composerBox!.x + composerBox!.width - 100);
      expect(toggleBox!.y).toBeLessThan(composerBox!.y);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = page.getByTestId('acp-session-plan-panel');
      const steps = panel.getByTestId('acp-session-plan-step');
      await expect(steps).toHaveCount(3);
      await expect(steps.nth(0)).toHaveText('Inspect the current implementation');
      await expect(steps.nth(1)).toHaveText('Exercise the live plan indicator');
      await expect(steps.nth(2)).toHaveText('Verify the replay path');
      await expect(steps.nth(1).locator('.lucide-circle-ellipsis')).toBeVisible();
      await expect(steps.nth(1).locator('.lucide-circle-ellipsis')).not.toHaveClass(/animate-spin/);
      await expect(steps.nth(1)).not.toHaveText(/Running|Pending|Completed/);
      await expect(toggle.locator('..').getByRole('button')).toHaveCount(1);
      await expect(panel.locator('button, a, input, select, textarea, [contenteditable="true"]')).toHaveCount(0);
      await expect(page.getByTestId('acp-tool-input-pre')).toContainText('Exercise the live plan indicator');
      const panelBox = await panel.boundingBox();
      const expandedComposerBox = await page.getByTestId('chat-composer-box').boundingBox();
      expect(panelBox).toBeTruthy();
      expect(expandedComposerBox).toBeTruthy();
      expect(panelBox!.y + panelBox!.height).toBeLessThan(expandedComposerBox!.y);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('session plan replay isolates session A through an A-to-B-to-A switch', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const sessionBKey = 'agent:main:session-plan-b';

    try {
      await installAcpChatMocks(app, undefined, [
        { key: MAIN_SESSION_KEY, displayName: 'session A', workspacePath: MAIN_WORKSPACE },
        { key: sessionBKey, displayName: 'session B', workspacePath: MAIN_WORKSPACE },
      ]);
      await installAcpLoadReplayBySessionMock(app, {
        [MAIN_SESSION_KEY]: [
          [{
            sessionUpdate: 'tool_call',
            toolCallId: 'session-a-plan',
            title: 'update_plan: session A',
            status: 'in_progress',
            rawInput: {
              plan: [
                { step: 'Keep session A isolated', status: 'completed' },
                { step: 'Restore session A from replay', status: 'in_progress' },
              ],
            },
            content: [],
            locations: [],
          }],
          [{
            sessionUpdate: 'tool_call',
            toolCallId: 'session-a-plan-return',
            title: 'update_plan: fresh session A',
            status: 'in_progress',
            rawInput: {
              plan: [
                { step: 'Load fresh session A replay', status: 'completed' },
                { step: 'Render structured session A response', status: 'in_progress' },
              ],
            },
            content: [],
            locations: [],
          }],
        ],
        [sessionBKey]: [[{
          sessionUpdate: 'tool_call',
          toolCallId: 'session-b-plan',
          title: 'update_plan: session B',
          status: 'in_progress',
          rawInput: {
            plan: [{ step: 'Keep session B separate', status: 'in_progress' }],
          },
          content: [],
          locations: [],
        }]],
      });

      const page = await openChat(app);
      const toggle = page.getByTestId('acp-session-plan-toggle');
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveText('1 / 2');
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([MAIN_SESSION_KEY]);

      await page.getByTestId(`sidebar-session-${sessionBKey}`).click();
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveText('0 / 1');
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([MAIN_SESSION_KEY, sessionBKey]);
      await toggle.click();
      await expect(page.getByTestId('acp-session-plan-panel')).toContainText('Keep session B separate');

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveText('1 / 2');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('acp-session-plan-panel')).toHaveCount(0);
      await toggle.click();
      const returnedPanel = page.getByTestId('acp-session-plan-panel');
      const returnedSteps = returnedPanel.getByTestId('acp-session-plan-step');
      await expect(returnedSteps).toHaveCount(2);
      await expect(returnedSteps.nth(0)).toHaveText('Load fresh session A replay');
      await expect(returnedSteps.nth(1)).toHaveText('Render structured session A response');
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([MAIN_SESSION_KEY, sessionBKey, MAIN_SESSION_KEY]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('session plan replay restores a collapsed plan after renderer reload', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayBySessionMock(app, {
        [MAIN_SESSION_KEY]: [
          [{
            sessionUpdate: 'tool_call',
            toolCallId: 'reload-session-plan',
            title: 'update_plan: reload session plan',
            status: 'in_progress',
            rawInput: {
              plan: [
                { step: 'Load plan history again', status: 'completed' },
                { step: 'Restore collapsed state', status: 'in_progress' },
              ],
            },
            content: [],
            locations: [],
          }],
          [{
            sessionUpdate: 'tool_call',
            toolCallId: 'reload-session-plan-fresh',
            title: 'update_plan: fresh renderer reload',
            status: 'in_progress',
            rawInput: {
              plan: [
                { step: 'Load a fresh plan after renderer reload', status: 'pending' },
                { step: 'Consume new structured replay data', status: 'pending' },
              ],
            },
            content: [],
            locations: [],
          }],
        ],
      });

      const page = await openChat(app);
      const toggle = page.getByTestId('acp-session-plan-toggle');
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([MAIN_SESSION_KEY]);
      await toggle.click();
      await expect(page.getByTestId('acp-session-plan-panel')).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await expect(toggle).toHaveText('0 / 2');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('acp-session-plan-panel')).toHaveCount(0);
      await toggle.click();
      const reloadedPanel = page.getByTestId('acp-session-plan-panel');
      const reloadedSteps = reloadedPanel.getByTestId('acp-session-plan-step');
      await expect(reloadedSteps).toHaveCount(2);
      await expect(reloadedSteps.nth(0)).toHaveText('Load a fresh plan after renderer reload');
      await expect(reloadedSteps.nth(1)).toHaveText('Consume new structured replay data');
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([MAIN_SESSION_KEY, MAIN_SESSION_KEY]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('supplements an ACP-replayed assistant turn with historical duration', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message_chunk',
          messageId: 'timed-history-user',
          content: { type: 'text', text: 'Measure this historical turn' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'timed-history-assistant',
          content: { type: 'text', text: 'Historical turn measured' },
        },
      ], [{
        normalizedUserText: 'Measure this historical turn',
        userOccurrenceFromTail: 1,
        durationMs: 6_400,
      }]);

      const page = await openChat(app);
      await expect(page.getByText('Historical turn measured')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-turn-duration')).toHaveText('Took 6 sec');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders the full restart-recovered historical duration', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message_chunk',
          messageId: 'restart-timed-user',
          content: { type: 'text', text: 'Continue this turn across a Gateway restart' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'restart-timed-assistant',
          content: { type: 'text', text: 'Recovered turn completed' },
        },
      ], [{
        normalizedUserText: 'Continue this turn across a Gateway restart',
        userOccurrenceFromTail: 1,
        durationMs: 280_564,
      }]);

      const page = await openChat(app);
      await expect(page.getByText('Recovered turn completed')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-turn-duration')).toHaveText('Took 280 sec');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('reconciles a completed live turn to transcript timing', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const prompt = 'Keep this live duration stable';

    try {
      await installAcpChatMocks(app);
      await installAcpPromptTimingMock(app, {
        normalizedUserText: prompt,
        durationMs: 6_400,
      });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill(prompt);
      await page.getByTestId('chat-composer-send').click();
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'timed-live-assistant',
        content: { type: 'text', text: 'Live turn measured' },
      }]);

      await expect(page.getByText('Live turn measured')).toBeVisible();
      await expect(page.getByTestId('acp-turn-duration')).toHaveText('Took 6 sec');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('commits a long historical replay without exposing partial assistant text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const paragraphChunks = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}.\n\n`);
    const sessionUpdates = [
      {
        sessionKey: MAIN_SESSION_KEY,
        generation: 1,
        historical: true,
        notification: {
          sessionId: MAIN_SESSION_KEY,
          update: {
            sessionUpdate: 'user_message_chunk',
            messageId: 'long-history-user',
            content: { type: 'text', text: 'Write a 12-paragraph article' },
          },
        },
      },
      ...paragraphChunks.map((text) => ({
        sessionKey: MAIN_SESSION_KEY,
        generation: 1,
        historical: true,
        notification: {
          sessionId: MAIN_SESSION_KEY,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'long-history-assistant',
            content: { type: 'text', text },
          },
        },
      })),
    ];

    try {
      await installAcpChatMocks(app, { success: true, generation: 1, sessionUpdates });
      const initialPage = await getStableWindow(app);
      await initialPage.addInitScript(() => {
        const observedLengths: number[] = [];
        Object.defineProperty(window, '__acpObservedAssistantLengths', {
          value: observedLengths,
          configurable: true,
        });
        const observer = new MutationObserver(() => {
          const assistant = document.querySelector('[data-testid="acp-assistant-message"]');
          const length = assistant?.textContent?.length ?? 0;
          if (length > 0 && observedLengths.at(-1) !== length) observedLengths.push(length);
        });
        const observe = () => {
          observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
        };
        if (document.documentElement) observe();
        else window.addEventListener('DOMContentLoaded', observe, { once: true });
      });

      const page = await openChat(app);
      const assistant = page.getByTestId('acp-assistant-message');
      await expect(assistant).toContainText('Paragraph 1.', { timeout: 30_000 });
      await expect(assistant).toContainText('Paragraph 12.');
      const finalLength = await assistant.evaluate((element) => element.textContent?.length ?? 0);
      const observedLengths = await page.evaluate(() => (
        (window as unknown as { __acpObservedAssistantLengths?: number[] }).__acpObservedAssistantLengths ?? []
      ));
      expect(observedLengths).toEqual([finalLength]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ACP tool updates inline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'inline-user',
          content: [{ type: 'text', text: 'Inspect the project files' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-package',
          title: 'read: path: package.json',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Loaded package metadata' } }],
          locations: [],
        },
      ]);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText('Read: path: package.json');
      await expect(card).toContainText('Loaded package metadata');
      const toolLabel = card.getByText('Tool', { exact: true });
      expect(await toolLabel.evaluate((element) => element.previousElementSibling?.classList.contains('lucide-wrench'))).toBe(true);
      expect(await toolLabel.evaluate((element) => element.nextElementSibling?.getAttribute('data-testid'))).toBe('acp-tool-icon-scan-text');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows optimistic user messages immediately and coalesces streamed assistant chunks', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptSuccessMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('Plan the migration');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Plan the migration')).toBeVisible();

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-stream',
          content: { type: 'text', text: 'Streaming' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-stream',
          content: { type: 'text', text: ' response' },
        },
      ]);

      await expect(page.locator('.prose').filter({ hasText: 'Streaming response' })).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('continues an ACP response while Chat is unmounted and shows the latest stream on return', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptDeferredMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('Keep working while I navigate');
      await page.getByTestId('chat-composer-send').click();
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'navigation-stream',
        content: { type: 'text', text: 'Before navigation. ' },
      }]);
      await expect(page.getByTestId('acp-assistant-message')).toContainText('Before navigation.');
      const duration = page.getByTestId('acp-turn-duration');
      await expect(duration).toContainText('elapsed');
      const beforeNavigationSeconds = Number.parseFloat((await duration.textContent()) ?? '0');

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await page.waitForTimeout(1_100);
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'navigation-stream',
        content: { type: 'text', text: 'While away. ' },
      }]);

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('acp-assistant-message')).toContainText('Before navigation. While away.');
      await expect(duration).toContainText('elapsed');
      expect(Number.parseFloat((await duration.textContent()) ?? '0')).toBeGreaterThan(beforeNavigationSeconds);
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'navigation-stream',
        content: { type: 'text', text: 'After return.' },
      }]);
      await expect(page.getByTestId('acp-assistant-message')).toContainText(
        'Before navigation. While away. After return.',
      );

      await resolveDeferredAcpPrompt(app);
      await expect(page.getByTestId('chat-composer-send')).toBeVisible();
      await expect(duration).toContainText('Took');
      const completedDuration = await duration.textContent();
      await page.waitForTimeout(1_100);
      await expect(duration).toHaveText(completedDuration ?? '');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps elapsed duration running after switching conversations and returning', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const prompt = 'Keep timing across conversations';
    const otherSessionKey = 'agent:main:session-duration-other';

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE },
                { key: otherSessionKey, displayName: 'other', workspacePath: MAIN_WORKSPACE },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['chat', 'loadAcpSession', {
            sessionKey: otherSessionKey,
            workspaceRoot: MAIN_WORKSPACE,
            cwd: MAIN_WORKSPACE,
          }])]: { success: true, generation: 2 },
        },
        recordHostInvocations: true,
      });
      await installAcpPromptDeferredMock(app);
      await installAcpReactivationWithPartialTimingMock(app, prompt);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill(prompt);
      await page.getByTestId('chat-composer-send').click();
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'conversation-switch-stream',
        content: { type: 'text', text: 'Before switch. ' },
      }]);
      const duration = page.getByTestId('acp-turn-duration');
      await expect(duration).toContainText('elapsed');
      const beforeSwitchSeconds = Number.parseFloat((await duration.textContent()) ?? '0');

      await page.getByTestId(`sidebar-session-${otherSessionKey}`).click();
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await page.waitForTimeout(1_100);
      await emitAcpSessionUpdates(app, [{
        sessionUpdate: 'agent_message_chunk',
        messageId: 'conversation-switch-stream',
        content: { type: 'text', text: 'While away.' },
      }]);

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByTestId('acp-assistant-message')).toContainText('Before switch. While away.');
      await expect(duration).toContainText('elapsed');
      const afterReturnSeconds = Number.parseFloat((await duration.textContent()) ?? '0');
      expect(afterReturnSeconds).toBeGreaterThan(beforeSwitchSeconds);

      await page.waitForTimeout(1_100);
      await expect(duration).toContainText('elapsed');
      expect(Number.parseFloat((await duration.textContent()) ?? '0')).toBeGreaterThan(afterReturnSeconds);
    } finally {
      await resolveDeferredAcpPrompt(app);
      await closeElectronApp(app);
    }
  });

  test('shows assistant identity and copies ACP assistant text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: (value: string) => {
              (window as unknown as { __acpCopiedText?: string }).__acpCopiedText = value;
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message',
          messageId: 'assistant-copy',
          content: [{ type: 'text', text: 'Copy this ACP answer' }],
        },
      ]);

      const assistantMessage = page.getByTestId('acp-assistant-message');
      await expect(assistantMessage).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toBeVisible();

      await assistantMessage.hover();
      const copyButton = page.getByTestId('acp-assistant-copy');
      await expect.poll(async () => {
        const [assistantBox, copyBox] = await Promise.all([
          assistantMessage.boundingBox(),
          copyButton.boundingBox(),
        ]);
        return !!assistantBox && !!copyBox && copyBox.x <= assistantBox.x + 8;
      }).toBe(true);
      await copyButton.click();

      await expect(copyButton).toHaveAttribute('aria-label', 'Copied');
      await expect.poll(() => page.evaluate(() => (window as unknown as { __acpCopiedText?: string }).__acpCopiedText)).toBe('Copy this ACP answer');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves ACP tool output newlines and indentation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      const output = 'line one\n  indented line\ncolumn_a\tcolumn_b';
      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'format-output',
          title: 'Inspect formatted output',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: output } }],
          locations: [],
        },
      ]);

      const pre = page.getByTestId('acp-tool-output-pre');
      await expect(pre).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => pre.evaluate((element) => element.textContent)).toBe(output);
      await expect.poll(() => pre.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps a shorter trailing assistant chunk after a tool call', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: {
            type: 'text',
            text: 'I will inspect the generated report before answering.',
          },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'read-grouped',
          title: 'Read grouped file',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'grouped output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: {
            type: 'text',
            text: 'Inspection complete. The generated report passed all validation checks.\n\n- Source: `report.txt`\n- Result: val',
          },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'assistant-turn',
          content: {
            type: 'text',
            text: 'id\n- Package: `report.zip`',
          },
        },
      ]);

      await expect(page.getByTestId('acp-assistant-turn')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toHaveCount(1);
      await expect(page.getByTestId('acp-assistant-copy')).toHaveCount(1);
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Read grouped file');
      await expect.poll(async () => await page.getByTestId('acp-tool-call-card').evaluate((element) => Boolean(element.closest('[data-testid="acp-assistant-turn"]')))).toBe(true);
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('I will inspect the generated report');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Inspection complete');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Source: report.txt');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Result: valid');
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Package: report.zip');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('auto-collapses completed tool cards and respects manual override', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'collapse-tool',
          title: 'Collapsible tool',
          status: 'in_progress',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toHaveAttribute('data-expanded', 'true', { timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output' } }],
          locations: [],
        },
      ]);

      await expect(card).toHaveAttribute('data-expanded', 'false', { timeout: 30_000 });

      await page.getByTestId('acp-tool-toggle').click();
      await expect(card).toHaveAttribute('data-expanded', 'true');

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'collapse-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'collapsible output after override' } }],
          locations: [],
        },
      ]);

      await page.waitForTimeout(1_200);
      await expect(card).toHaveAttribute('data-expanded', 'true');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders ledger-style replayed ACP tool events as historical tool cards', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-user',
          content: [{ type: 'text', text: 'Replay the tool call' }],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'history-assistant-before',
          content: { type: 'text', text: 'Before the historical tool' },
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool',
          title: 'Historical tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'historical output' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'history-assistant-after',
          content: { type: 'text', text: 'After the historical tool' },
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      const card = page.getByTestId('acp-tool-call-card');
      await expect(card).toContainText('Historical tool');
      await expect(card).toHaveAttribute('data-expanded', 'false');
      await page.getByTestId('acp-tool-toggle').click();
      await expect(card).toHaveAttribute('data-expanded', 'true');
      await expect(card).toContainText('historical output');
      const turn = page.getByTestId('acp-assistant-turn');
      await expect(turn).toContainText('Before the historical tool');
      await expect(turn).toContainText('After the historical tool');
      const orderedParts = turn.locator('[data-testid="acp-assistant-message"], [data-testid="acp-tool-call-card"]');
      await expect(orderedParts).toHaveCount(3);
      await expect(orderedParts.nth(0)).toContainText('Before the historical tool');
      await expect(orderedParts.nth(1)).toContainText('Historical tool');
      await expect(orderedParts.nth(2)).toContainText('After the historical tool');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('collapses multiple replayed tool calls into one group after the turn completes', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-user',
          content: [{ type: 'text', text: 'Check weather' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-1',
          title: 'update_plan: plan: [{"step":"Check weather"}]',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'plan updated' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-2',
          title: 'web_fetch: url: https://example.com/weather',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'fetch results' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-3',
          title: 'browser: action: navigate',
          status: 'failed',
          content: [{ type: 'content', content: { type: 'text', text: 'browser failed' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-4',
          title: 'exec: command: pwd',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: '/workspace' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-5',
          title: 'read: path: weather.txt',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-6',
          title: 'sessions_spawn: runtime: subagent, task: Check weather',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'subagent started' } }],
          locations: [],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool-7',
          title: 'memory_search: query: weather history',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'memory results' } }],
          locations: [],
        },
        {
          sessionUpdate: 'agent_message',
          messageId: 'history-assistant',
          content: [{ type: 'text', text: 'Hangzhou is cloudy today.' }],
        },
      ], [{
        normalizedUserText: 'Check weather',
        userOccurrenceFromTail: 0,
        durationMs: 12_000,
      }]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      const group = page.getByTestId('acp-tool-calls-group');
      await expect(group).toBeVisible();
      await expect(group).toHaveAttribute('data-collapsed', 'true');
      await expect(group.locator('svg').first()).not.toHaveClass(/group-hover:translate-x-0\.5/);
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(0);

      await expandAcpToolCallsGroup(page);
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(7);
      await expect(page.getByText('Update plan: plan: [{"step":"Check weather"}]', { exact: true })).toBeVisible();
      await expect(page.getByText('Read web page: url: https://example.com/weather', { exact: true })).toBeVisible();
      await expect(page.getByText('Control browser: action: navigate', { exact: true })).toBeVisible();
      await expect(page.getByText('Run command: command: pwd', { exact: true })).toBeVisible();
      await expect(page.getByText('Read: path: weather.txt', { exact: true })).toBeVisible();
      await expect(page.getByText('Spawn subagent: runtime: subagent, task: Check weather', { exact: true })).toBeVisible();
      await expect(page.getByText('Search memory: query: weather history', { exact: true })).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-list-checks')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-globe')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-square-mouse-pointer')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-monitor-play')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-scan-text')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-bot')).toBeVisible();
      await expect(page.getByTestId('acp-tool-icon-database')).toBeVisible();
      await expect(page.getByTestId('acp-assistant-turn')).toContainText('Hangzhou is cloudy today.');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hydrates historical image-generation completions from transcript history when ACP replay omits them', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE }],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'history', { sessionKey: MAIN_SESSION_KEY, limit: 1000 }])]: {
            success: true,
            messages: [
              {
                id: 'transcript-image-start',
                role: 'toolresult',
                toolName: 'image_generate',
                toolCallId: 'history-image-tool',
                content: `Background task started for image generation (${IMAGE_TASK_ID})`,
                details: { taskId: IMAGE_TASK_ID },
              },
              {
                id: 'transcript-image-complete',
                role: 'assistant',
                content: `Here is the generated image.\nMEDIA:${GENERATED_IMAGE_PATH}`,
              },
            ],
          },
          [stableStringify(['files', 'resolveAttachment', {
            ref: {
              sessionKey: MAIN_SESSION_KEY,
              generation: 1,
              uri: GENERATED_IMAGE_PATH,
              transcriptMessageId: 'transcript-image-complete',
            },
            mimeType: 'image/png',
          }])]: {
            ok: true,
            identity: GENERATED_IMAGE_IDENTITY,
            displayName: 'generated-image.png',
            mimeType: 'image/png',
            size: 128,
            target: {
              kind: 'local',
              scope: 'openclaw-media',
              ref: {
                sessionKey: MAIN_SESSION_KEY,
                generation: 1,
                uri: GENERATED_IMAGE_PATH,
                transcriptMessageId: 'transcript-image-complete',
              },
            },
          },
          [stableStringify(['media', 'thumbnails', {
            paths: [{
              attachmentFileRef: {
                sessionKey: MAIN_SESSION_KEY,
                generation: 1,
                uri: GENERATED_IMAGE_PATH,
                transcriptMessageId: 'transcript-image-complete',
              },
              key: GENERATED_IMAGE_IDENTITY,
              mimeType: 'image/png',
            }],
          }])]: {
            [GENERATED_IMAGE_IDENTITY]: { preview: GENERATED_IMAGE_PREVIEW, fileSize: 128 },
          },
          [stableStringify(['media', 'saveImage', {
            base64: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            defaultFileName: 'generated-image.png',
          }])]: {
            success: true,
            savedPath: '/tmp/generated-image.png',
          },
        },
      });
      await installMediaSaveRecorder(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message',
          messageId: 'history-image-user',
          content: [{ type: 'text', text: 'Generate an image' }],
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-image-tool',
          title: 'Generate image',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${IMAGE_TASK_ID})` } }],
          locations: [],
        },
      ]);

      const page = await openChat(app);
      await page.evaluate(() => {
        class TestClipboardItem {
          readonly items: Record<string, Blob>;
          constructor(items: Record<string, Blob>) {
            this.items = items;
          }
        }
        Object.defineProperty(window, 'ClipboardItem', { value: TestClipboardItem, configurable: true });
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            write: (items: unknown[]) => {
              const first = items[0] as { items?: Record<string, Blob> } | undefined;
              (window as unknown as { __imageClipboardTypes?: string[] }).__imageClipboardTypes = Object.keys(first?.items ?? {});
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      });

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-tool-call-card')).toContainText('Generate image');
      const imagePart = page.getByTestId('acp-image-part');
      const image = imagePart.locator('img');
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('src', GENERATED_IMAGE_PREVIEW);
      await imagePart.hover();
      await expect(page.getByTestId('acp-image-copy')).toBeVisible();
      await expect(page.getByTestId('acp-image-save')).toBeVisible();

      await page.getByTestId('acp-image-copy').click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __imageClipboardTypes?: string[] }).__imageClipboardTypes ?? [])).toEqual(['image/png']);

      await page.getByTestId('acp-image-save').click();
      await expect.poll(async () => await getRecordedMediaSaveImagePayloads(app)).toEqual([{
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        defaultFileName: 'generated-image.png',
      }]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not synthesize tool cards for transcript fallback text replay', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpLoadReplayMock(app, [
        {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Old transcript prompt' },
        },
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Transcript text mentions tool_call but has no structured tool event.' },
        },
      ]);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Transcript text mentions tool_call')).toBeVisible();
      await expect(page.getByTestId('acp-tool-call-card')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts on a new empty chat instead of selecting a heartbeat-only ClawX session', async ({ launchElectronApp }) => {
    const now = 1711111111111;
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'ClawX',
                workspacePath: MAIN_WORKSPACE,
                lastMessagePreview: '[OpenClaw heartbeat poll]',
                updatedAt: new Date(now).toISOString(),
              }],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });
      await installAcpLoadRecorderMock(app);

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`)).toHaveCount(0);
      await expect(page.getByText('[OpenClaw heartbeat poll]')).toHaveCount(0);
      expect(await getRecordedAcpLoadSessionKeys(app)).toEqual([]);

      await page.getByTestId('chat-composer-input').fill('Start a real conversation');
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(async () => {
        const loadSessionKeys = await getRecordedAcpLoadSessionKeys(app);
        return loadSessionKeys.some((sessionKey) => /^agent:main:session-/.test(sessionKey));
      }, { timeout: 30_000 }).toBe(true);
      const loadSessionKeys = await getRecordedAcpLoadSessionKeys(app);
      expect(loadSessionKeys).not.toContain(MAIN_SESSION_KEY);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the composer dot pulse and thinking label only while sending', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptDeferredMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-dot-pulse')).toHaveCount(0);

      await page.getByTestId('chat-composer-input').fill('Hold the send state');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-composer-working-indicator')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-working-indicator')).toContainText('Thinking…');
      await expect(page.getByTestId('chat-composer-dot-pulse')).toBeVisible();
      await expect(page.getByTestId('chat-composer-zoomies')).toHaveCount(0);

      await resolveDeferredAcpPrompt(app);
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-dot-pulse')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps a blank new chat interactive after a recoverable initial ACP load failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, updatedAt: new Date().toISOString() }],
            },
          },
        },
        hostApi: baseHostApiMocks({
          success: false,
          error: "Error invoking remote method 'host:invoke': reply was never sent",
        }),
      });

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-error-banner')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('creates and sends the first prompt to a newly targeted agent workspace', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, updatedAt: new Date().toISOString() },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'main',
                    workspace: MAIN_WORKSPACE,
                    mainSessionKey: MAIN_SESSION_KEY,
                  },
                  {
                    id: 'reviewer',
                    name: 'reviewer',
                    workspace: REVIEWER_WORKSPACE,
                    mainSessionKey: REVIEWER_SESSION_KEY,
                    modelDisplay: 'mock-model',
                  },
                ],
              },
            },
          },
        },
      });
      await installTargetAgentRequestRecorder(app);

      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-agent').click();
      await page.getByRole('button', { name: 'reviewer mock-model' }).click();
      await page.getByTestId('chat-composer-input').fill('Hello reviewer');
      await page.getByTestId('chat-composer-send').click();

      await expect.poll(async () => {
        const requests = await getTargetAgentRequests(app);
        return requests.some((request) => request.action === 'sendAcpPrompt');
      }).toBe(true);

      const reviewerSessionRow = page.getByTestId(`sidebar-session-${REVIEWER_SESSION_KEY}`);
      await expect(reviewerSessionRow).toContainText('Hello reviewer');
      await expect(reviewerSessionRow).not.toContainText('ACP');

      const requests = await getTargetAgentRequests(app);
      expect(requests.filter((request) => request.action === 'loadAcpSession')).toEqual([{
        action: 'loadAcpSession',
        payload: {
          sessionKey: REVIEWER_SESSION_KEY,
          workspaceRoot: REVIEWER_WORKSPACE,
          cwd: REVIEWER_WORKSPACE,
          createIfMissing: true,
        },
      }]);
      expect(requests.some((request) => (
        request.action === 'sendAcpPrompt'
        && request.payload.sessionKey === REVIEWER_SESSION_KEY
        && request.payload.cwd === REVIEWER_WORKSPACE
        && request.payload.message === 'Hello reviewer'
      ))).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps recoverable target-agent prompt failures visible after switching sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const error = "Error invoking remote method 'host:invoke': reply was never sent";

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, updatedAt: new Date().toISOString() },
                { key: REVIEWER_SESSION_KEY, displayName: 'reviewer', workspacePath: REVIEWER_WORKSPACE, updatedAt: new Date().toISOString() },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: REVIEWER_SESSION_KEY, workspaceRoot: REVIEWER_WORKSPACE, cwd: REVIEWER_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['chat', 'loadAcpSession', { sessionKey: REVIEWER_SESSION_KEY, workspaceRoot: DEFAULT_WORKSPACE, cwd: DEFAULT_WORKSPACE }])]: {
            success: true,
            generation: 1,
          },
          [stableStringify(['sessions', 'summaries', { sessionKeys: [MAIN_SESSION_KEY, REVIEWER_SESSION_KEY] }])]: {
            summaries: [
              { sessionKey: MAIN_SESSION_KEY, workspacePath: MAIN_WORKSPACE },
              { sessionKey: REVIEWER_SESSION_KEY, workspacePath: REVIEWER_WORKSPACE },
            ],
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  {
                    id: 'main',
                    name: 'main',
                    workspace: MAIN_WORKSPACE,
                    mainSessionKey: MAIN_SESSION_KEY,
                  },
                  {
                    id: 'reviewer',
                    name: 'reviewer',
                    workspace: REVIEWER_WORKSPACE,
                    mainSessionKey: REVIEWER_SESSION_KEY,
                    modelDisplay: 'mock-model',
                  },
                ],
              },
            },
          },
        },
      });
      await installAcpPromptFailureMock(app, error);

      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('workspace-session-group-%2Fworkspace%2Freviewer')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-agent').click();
      await page.getByRole('button', { name: 'reviewer mock-model' }).click();
      await page.getByTestId('chat-composer-input').fill('Trigger target send failure');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('acp-error-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-error-banner')).toContainText(error);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides heartbeat-only ClawX sessions from the sidebar without hiding normal sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const updatedAt = new Date().toISOString();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                {
                  key: 'agent:main:heartbeat',
                  displayName: 'ClawX',
                  lastMessagePreview: '[OpenClaw heartbeat poll]',
                  updatedAt,
                },
                {
                  key: 'agent:main:session-1710000000000',
                  displayName: 'ClawX',
                  derivedTitle: 'ClawX',
                  lastMessagePreview: 'Summarize the repository structure',
                  updatedAt,
                },
              ],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await openChat(app);

      await expect(page.getByTestId(defaultWorkspaceSessionGroupTestId())).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar-session-agent:main:heartbeat')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-session-agent:main:session-1710000000000')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders typed Talk events as transient direct bubbles without microphone hardware', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE },
                { key: TALK_SESSION_KEY, displayName: 'Talk', workspacePath: MAIN_WORKSPACE },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['chat', 'loadAcpSession', {
            sessionKey: TALK_SESSION_KEY, workspaceRoot: MAIN_WORKSPACE, cwd: MAIN_WORKSPACE,
          }])]: { success: true, generation: 1 },
          [stableStringify(['talk', 'catalog', null])]: {
            modes: ['realtime'],
            transports: ['gateway-relay'],
            brains: ['agent-consult'],
            realtime: { ready: true, providers: [] },
          },
          [stableStringify(['talk', 'startRelay', { sessionKey: TALK_SESSION_KEY }])]: {
            relaySessionId: 'relay-e2e',
            provider: 'mock',
            transport: 'gateway-relay',
            audio: {
              inputEncoding: 'pcm16',
              inputSampleRateHz: 24_000,
              outputEncoding: 'pcm16',
              outputSampleRateHz: 24_000,
            },
          },
          [stableStringify(['talk', 'stopRelay', { relaySessionId: 'relay-e2e' }])]: { ok: true },
        },
        recordHostInvocations: true,
      });
      const initialPage = await getStableWindow(app);
      await initialPage.addInitScript(() => {
        class FakeAudioContext {
          sampleRate = 24_000;
          audioWorklet = { addModule: async () => undefined };
          destination = {};
          createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
          createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
          async close() {}
        }
        class FakeAudioWorkletNode {
          port = { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null };
          constructor(_context: AudioContext, _name: string) {}
          connect() {}
          disconnect() {}
        }
        Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
        Object.defineProperty(window, 'AudioWorkletNode', { value: FakeAudioWorkletNode, configurable: true });
        Object.defineProperty(navigator, 'mediaDevices', {
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
          configurable: true,
        });
      });

      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-dev-mode-switch').click();
      await page.getByTestId(`sidebar-session-${TALK_SESSION_KEY}`).click();
      await expect(page.getByTestId('sidebar-talk')).toBeEnabled();
      await page.getByTestId('chat-composer-input').fill('Preserve this draft');
      await page.getByTestId('sidebar-talk').click();
      await expect(page.getByTestId('chat-composer-input')).toBeDisabled();

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          for (const event of [
            { role: 'user', text: '帮我看看前', final: false },
            { role: 'assistant', text: '帮你查一下', final: false },
            { role: 'user', text: '部落有什么剑。', final: false },
            { role: 'assistant', text: '项目里的文件情况。', final: false },
            { role: 'user', text: '帮我看看前部落有什么剑。', final: true },
            { role: 'assistant', text: '好的，我来帮你查一下项目里的文件情况。', final: true },
            { role: 'assistant', text: '我来看看', final: false },
            { role: 'assistant', text: '我来看看进度，然后告诉你现在的情况。', final: true },
            { role: 'assistant', text: '目录里大致', final: false },
            { role: 'assistant', text: '目录里大致有这些文件和目录。', final: true },
          ] as const) {
            window.webContents.send('talk:event', {
              relaySessionId: 'relay-e2e', type: 'transcript', ...event,
            });
          }
        }
      });
      await expect(page.getByTestId('live-talk-user-message')).toHaveCount(1);
      await expect(page.getByTestId('live-talk-user-message')).toContainText('帮我看看前部落有什么剑。');
      await expect(page.getByTestId('live-talk-assistant-message')).toHaveCount(1);
      await expect(page.getByTestId('live-talk-assistant-message')).toContainText(
        '好的，我来帮你查一下项目里的文件情况。我来看看进度，然后告诉你现在的情况。目录里大致有这些文件和目录。',
      );
      await expect(page.getByTestId('acp-chat-timeline')).toHaveCount(0);

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'transcript', role: 'user', text: 'Second request', final: false,
          });
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'transcript', role: 'assistant', text: 'Second answer', final: true,
          });
        }
      });
      await expect(page.getByTestId('live-talk-user-message')).toHaveCount(2);
      await expect(page.getByTestId('live-talk-user-message').last()).toContainText('Second request');
      await expect(page.getByTestId('live-talk-assistant-message')).toHaveCount(2);
      await expect(page.getByTestId('live-talk-assistant-message').last()).toContainText('Second answer');

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'toolCall', callId: 'unknown-tool', name: 'untrusted_tool', args: {},
          });
        }
      });
      await page.waitForTimeout(50);
      expect((await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'talk' && call.action === 'startAgentConsult'
      ))).toBe(false);

      await page.getByTestId('sidebar-talk').click();
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('Preserve this draft');
      await expect(page.getByTestId('live-talk-transcript')).toHaveCount(0);

      await page.getByTestId('sidebar-talk').click();
      await expect(page.getByTestId('chat-composer-input')).toBeDisabled();
      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'transcript', role: 'assistant', text: 'Direct assistant after restart', final: true,
          });
        }
      });
      await expect(page.getByTestId('live-talk-assistant-message')).toContainText('Direct assistant after restart');

      await page.reload();
      await expect(page.getByTestId('live-talk-transcript')).toHaveCount(0);
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'talk' && call.action === 'stopRelay'
      ))).toBe(true);
      expect((await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'talk' && call.action === 'startRelay'
      ))).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('replays durable consult history only after the provider output mark while Talk stays active', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE },
                { key: TALK_SESSION_KEY, displayName: 'Talk', workspacePath: MAIN_WORKSPACE },
              ],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['talk', 'catalog', null])]: {
            modes: ['realtime'],
            transports: ['gateway-relay'],
            brains: ['agent-consult'],
            realtime: { ready: true, providers: [] },
          },
          [stableStringify(['talk', 'startRelay', { sessionKey: TALK_SESSION_KEY }])]: {
            relaySessionId: 'relay-e2e',
            provider: 'mock',
            transport: 'gateway-relay',
            audio: {
              inputEncoding: 'pcm16',
              inputSampleRateHz: 24_000,
              outputEncoding: 'pcm16',
              outputSampleRateHz: 24_000,
            },
          },
          [stableStringify(['talk', 'startAgentConsult', {
            relaySessionId: 'relay-e2e', sessionKey: TALK_SESSION_KEY, callId: 'consult-1', args: { prompt: 'Review this' },
          }])]: { runId: 'consult-run', text: 'Consult completion' },
          [stableStringify(['talk', 'submitToolResult', {
            relaySessionId: 'relay-e2e', callId: 'consult-1', result: 'Consult completion',
          }])]: { ok: true },
          [stableStringify(['talk', 'acknowledgeMark', {
            relaySessionId: 'relay-e2e', markName: 'consult-output-complete',
          }])]: { ok: true },
          [stableStringify(['talk', 'stopRelay', { relaySessionId: 'relay-e2e' }])]: { ok: true },
        },
        recordHostInvocations: true,
      });
      await installConsultReplayLoadMock(app);
      const initialPage = await getStableWindow(app);
      await initialPage.addInitScript(() => {
        class FakeAudioContext {
          sampleRate = 24_000;
          currentTime = 0;
          audioWorklet = { addModule: async () => undefined };
          destination = {};
          createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
          createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
          createBuffer(_channels: number, length: number, sampleRate: number) {
            return { duration: length / sampleRate, copyToChannel() {} };
          }
          createBufferSource() {
            return {
              buffer: null,
              onended: null as (() => void) | null,
              connect() {},
              start() { queueMicrotask(() => this.onended?.()); },
              stop() { this.onended?.(); },
            };
          }
          async close() {}
        }
        class FakeAudioWorkletNode {
          port = { onmessage: null as ((event: MessageEvent<Float32Array>) => void) | null };
          constructor(_context: AudioContext, _name: string) {}
          connect() {}
          disconnect() {}
        }
        Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
        Object.defineProperty(window, 'AudioWorkletNode', { value: FakeAudioWorkletNode, configurable: true });
        Object.defineProperty(navigator, 'mediaDevices', {
          value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
          configurable: true,
        });
      });

      const page = await openChat(app);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-dev-mode-switch').click();
      await page.getByTestId(`sidebar-session-${TALK_SESSION_KEY}`).click();
      await expect(page.getByTestId('sidebar-talk')).toBeEnabled();
      await page.getByTestId('sidebar-talk').click();
      await expect(page.getByTestId('chat-composer-input')).toBeDisabled();

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'transcript', role: 'assistant', text: 'Transient direct reply', final: true,
          });
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'toolCall', callId: 'consult-1', name: 'openclaw_agent_consult', args: { prompt: 'Review this' },
          });
        }
      });
      await expect(page.getByTestId('live-talk-assistant-message')).toContainText('Transient direct reply');
      await expect.poll(async () => (await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'talk' && call.action === 'submitToolResult'
      ))).toBe(true);

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'toolResult', callId: 'consult-1', final: true,
          });
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'audio', audioBase64: 'AAD/fw==',
          });
        }
      });
      const loadsBeforeProviderMark = await getConsultAcpLoadCount(app);
      expect(loadsBeforeProviderMark).toBe(1);
      await expect(page.getByText('Durable consult answer')).toHaveCount(0);

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'mark', markName: 'consult-output-complete',
          });
        }
      });
      await expect.poll(() => getConsultAcpLoadCount(app)).toBe(loadsBeforeProviderMark + 1);
      await expect.poll(() => getConsultAcpDurableReplayFlags(app)).toEqual([false, true]);
      // Active Talk renders its transient transcript in place of the ACP timeline.
      await expect(page.getByText('Durable consult prompt')).toHaveCount(0);
      await expect(page.getByText('Durable consult answer')).toHaveCount(0);
      await expect(page.getByTestId('live-talk-transcript')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeDisabled();
      await expect(page.getByTestId('sidebar-talk')).toHaveAttribute('aria-pressed', 'true');
      expect((await getRecordedHostInvocations(app)).some((call) => (
        call.module === 'talk' && call.action === 'stopRelay'
      ))).toBe(false);

      await app.evaluate(async ({ app: _app }) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('talk:event', {
            relaySessionId: 'relay-e2e', type: 'transcript', role: 'assistant', text: 'Talk remains usable', final: true,
          });
        }
      });
      await expect(page.getByTestId('live-talk-assistant-message')).toContainText('Talk remains usable');
    } finally {
      await closeElectronApp(app);
    }
  });
});
