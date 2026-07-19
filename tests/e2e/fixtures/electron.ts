import electronBinaryPath from 'electron';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { build as buildWithEsbuild } from 'esbuild';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawMessage } from '../../../shared/chat/types';

export type LaunchElectronOptions = {
  skipSetup?: boolean;
  additionalArgs?: string[];
};

type IpcMockConfig = {
  gatewayStatus?: Record<string, unknown>;
  gatewayRpc?: Record<string, unknown>;
  hostApi?: Record<string, unknown>;
  hostApiErrors?: Record<string, string>;
  recordHostInvocations?: boolean;
  recordLegacyIpcInvocations?: boolean;
};

export type RecordedHostInvocation = {
  module?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

export type RecordedLegacyIpcInvocation = {
  channel: string;
  args: unknown[];
};

export type AttachmentFixtureSession = {
  key: string;
  title: string;
};

export type AttachmentFixtureTranscriptResponse = RawMessage[] | {
  messages: RawMessage[];
  deferId: string;
};

export type AttachmentOpenHandlersFixtureResult = {
  ok: boolean;
  platform?: 'darwin' | 'win32' | 'linux';
  handlers?: Array<{
    handlerId: string;
    name: string;
    iconDataUrl?: string;
    isDefault: boolean;
  }>;
  error?: string;
};

export type AttachmentHostFixture = {
  workspaceDir: string;
  openClawMediaDir: string;
  outsideDir: string;
  createWorkspaceFile: (relativePath: string, data: string | Uint8Array) => Promise<string>;
  createOpenClawMediaFile: (relativePath: string, data: string | Uint8Array) => Promise<string>;
  createOutsideFile: (relativePath: string, data: string | Uint8Array) => Promise<string>;
  registerStagedAttachment: (id: string, stagedPath: string, displayPath?: string) => Promise<void>;
  emitAcpSessionUpdates: (input: {
    sessionKey: string;
    updates: Array<Record<string, unknown> & { sessionUpdate: string }>;
    generation?: number;
    historical?: boolean;
  }) => Promise<void>;
  setPromptUpdates: (
    prompt: string,
    updates: Array<Record<string, unknown> & { sessionUpdate: string }>,
  ) => Promise<void>;
  setSessionReplay: (
    sessionKey: string,
    updates: Array<Record<string, unknown> & { sessionUpdate: string }>,
  ) => Promise<void>;
  setTranscriptResponses: (
    sessionKey: string,
    responses: AttachmentFixtureTranscriptResponse[],
  ) => Promise<void>;
  releaseTranscriptResponse: (deferId: string) => Promise<void>;
  waitForDeferredTranscriptReady: (deferId: string, timeoutMs?: number) => Promise<void>;
  waitForDeferredTranscriptCompleted: (deferId: string, timeoutMs?: number) => Promise<void>;
  waitForHistoryRequestCount: (sessionKey: string, count: number, timeoutMs?: number) => Promise<number[]>;
  clearHistoryRequestTimes: (sessionKey?: string) => Promise<void>;
  waitForHistoryQuiet: (sessionKey: string, quietMs?: number, timeoutMs?: number) => Promise<void>;
  setOpenHandlersResult: (result: AttachmentOpenHandlersFixtureResult) => Promise<void>;
  getHostInvocations: () => Promise<RecordedHostInvocation[]>;
  getShellInvocations: () => Promise<RecordedHostInvocation[]>;
  clearInvocations: () => Promise<void>;
};

type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
  homeDir: string;
  userDataDir: string;
  launchElectronApp: (options?: LaunchElectronOptions) => Promise<ElectronApplication>;
};

const repoRoot = resolve(process.cwd());
const electronEntry = join(repoRoot, 'dist-electron/main/index.js');
let productionAttachmentBundlePromise: Promise<string> | undefined;

function productionAttachmentBundle(): Promise<string> {
  // The app's production registry is closure-owned and cannot accept a provider-free
  // test grant. Bundle the real access service into Electron Main instead of
  // reimplementing its authorization or shell delegation in this fixture.
  productionAttachmentBundlePromise ??= buildWithEsbuild({
    stdin: {
      contents: [
        `export { createAttachmentAccess, StagedAttachmentRegistry } from ${JSON.stringify(join(repoRoot, 'electron/services/attachment-access.ts'))};`,
        `export { AcpSessionAccessRegistry } from ${JSON.stringify(join(repoRoot, 'electron/services/acp-session-access-registry.ts'))};`,
        `export { createMediaApi } from ${JSON.stringify(join(repoRoot, 'electron/services/media-api.ts'))};`,
      ].join('\n'),
      loader: 'ts',
      resolveDir: repoRoot,
      sourcefile: 'attachment-e2e-production-entry.ts',
    },
    bundle: true,
    define: {
      'import.meta.url': JSON.stringify(pathToFileURL(join(repoRoot, 'electron/utils/paths.ts')).href),
    },
    external: ['electron'],
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    tsconfig: join(repoRoot, 'tsconfig.node.json'),
    write: false,
  }).then((result) => {
    const output = result.outputFiles?.[0];
    if (!output) throw new Error('Failed to bundle production attachment services for Electron E2E');
    return output.text;
  });
  return productionAttachmentBundlePromise;
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function getStableWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;
  let page = await app.firstWindow();

  while (Date.now() < deadline) {
    const openWindows = app.windows().filter((candidate) => !candidate.isClosed());
    const currentWindow = openWindows.at(-1) ?? page;

    if (currentWindow && !currentWindow.isClosed()) {
      try {
        await currentWindow.waitForLoadState('domcontentloaded', { timeout: 2_000 });
        return currentWindow;
      } catch (error) {
        if (!String(error).includes('has been closed')) {
          throw error;
        }
      }
    }

    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling until a stable window is available or the deadline expires.
    }
  }

  throw new Error('No stable Electron window became available');
}

async function closeElectronApp(app: ElectronApplication, timeoutMs = 5_000): Promise<void> {
  let closed = false;

  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);

      if (closeResult.status === 'fulfilled') {
        closed = true;
      }
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) {
    return;
  }

  try {
    await app.close();
    return;
  } catch {
    // Fall through to process kill if Playwright cannot close the app cleanly.
  }

  try {
    app.process().kill('SIGKILL');
  } catch {
    // Ignore process kill failures during e2e teardown.
  }
}

async function seedE2eSettings(userDataDir: string): Promise<void> {
  const settingsPath = join(userDataDir, 'settings.json');
  try {
    await access(settingsPath);
    return;
  } catch {
    // Seed only once per isolated profile. Tests that switch language should
    // keep their persisted setting across relaunches in the same profile.
  }

  await writeFile(settingsPath, JSON.stringify({ language: 'en' }, null, 2), 'utf-8');
}

async function launchClawXElectron(
  homeDir: string,
  userDataDir: string,
  options: LaunchElectronOptions = {},
): Promise<ElectronApplication> {
  if (options.additionalArgs?.some((arg) => arg.startsWith('--use-fake-ui-for-media-stream'))) {
    throw new Error('Electron E2E must not bypass application media permission prompts');
  }
  await seedE2eSettings(userDataDir);
  const hostApiPort = await allocatePort();
  const electronEnv = process.platform === 'linux'
    ? {
      ELECTRON_DISABLE_SANDBOX: '1',
      DISPLAY: process.env.DISPLAY || ':1',
    }
    : {};
  return await electron.launch({
    executablePath: electronBinaryPath,
    args: ['--lang=en-US', ...(options.additionalArgs ?? []), electronEntry],
    env: {
      ...process.env,
      ...electronEnv,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en',
      CLAWX_E2E: '1',
      CLAWX_USER_DATA_DIR: userDataDir,
      ...(options.skipSetup ? { CLAWX_E2E_SKIP_SETUP: '1' } : {}),
      CLAWX_PORT_CLAWX_HOST_API: String(hostApiPort),
    },
    timeout: 90_000,
  });
}

export const test = base.extend<ElectronFixtures>({
  homeDir: async ({ browserName: _browserName }, provideHomeDir) => {
    const homeDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-home-'));
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Local'), { recursive: true });
    await mkdir(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
    try {
      await provideHomeDir(homeDir);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  },

  userDataDir: async ({ browserName: _browserName }, provideUserDataDir) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-e2e-user-data-'));
    try {
      await provideUserDataDir(userDataDir);
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  launchElectronApp: async ({ homeDir, userDataDir }, provideLauncher) => {
    await provideLauncher(async (options?: LaunchElectronOptions) => await launchClawXElectron(homeDir, userDataDir, options));
  },

  electronApp: async ({ launchElectronApp }, provideElectronApp) => {
    const app = await launchElectronApp();
    let appClosed = false;
    app.once('close', () => {
      appClosed = true;
    });

    try {
      await provideElectronApp(app);
    } finally {
      if (!appClosed) {
        await closeElectronApp(app);
      }
    }
  },

  page: async ({ electronApp }, providePage) => {
    const page = await getStableWindow(electronApp);
    await providePage(page);
  },
});

export async function completeSetup(page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await page.getByTestId('setup-skip-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible();
}

export { closeElectronApp };
export { getStableWindow };
export { expect };

export async function installIpcMocks(
  app: ElectronApplication,
  config: IpcMockConfig,
): Promise<void> {
  await app.evaluate(
    async ({ app: _app }, mockConfig) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const stableStringify = (value: unknown): string => {
        if (value == null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
        const entries = Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
        return `{${entries.join(',')}}`;
      };

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const globals = globalThis as unknown as {
        __e2eHostInvocations?: RecordedHostInvocation[];
        __e2eLegacyIpcInvocations?: RecordedLegacyIpcInvocation[];
      };
      if (mockConfig.recordHostInvocations) globals.__e2eHostInvocations = [];
      if (mockConfig.recordLegacyIpcInvocations) globals.__e2eLegacyIpcInvocations = [];
      type IpcInvokeHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
      const getInvokeHandler = (channel: string): IpcInvokeHandler | undefined => {
        return (ipcMain as unknown as {
          _invokeHandlers?: Map<string, IpcInvokeHandler>;
        })._invokeHandlers?.get(channel);
      };
      const instrumentedLegacyHandlers = new Map<string, IpcInvokeHandler>();

      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });
      const fail = (id: unknown, message: string) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: false,
        error: { code: 'INTERNAL', message },
      });

      const unwrapLegacyResponse = (response: unknown): unknown => {
        if (!response || typeof response !== 'object') return response;
        const record = response as Record<string, unknown>;
        const data = record.data;
        if (data && typeof data === 'object' && 'json' in (data as Record<string, unknown>)) {
          return (data as Record<string, unknown>).json;
        }
        return data ?? response;
      };
      const respondGatewayRpc = (id: unknown, response: unknown) => {
        if (response && typeof response === 'object') {
          const record = response as Record<string, unknown>;
          if (record.success === false) {
            return fail(id, String(record.error || 'Gateway RPC failed'));
          }
          if (record.success === true && 'result' in record) {
            return respond(id, record.result);
          }
        }
        return respond(id, response);
      };
      const originalLegacyGatewayRpc = getInvokeHandler('gateway:rpc');
      const originalLegacyFileStat = getInvokeHandler('file:stat');
      const originalLegacyFileReadText = getInvokeHandler('file:readText');
      const originalLegacyFileListTree = getInvokeHandler('file:listTree');
      const getLegacyOverride = (channel: string, original?: IpcInvokeHandler) => {
        const current = getInvokeHandler(channel);
        if (current === instrumentedLegacyHandlers.get(channel)) return null;
        return current && current !== original ? current : null;
      };

      if (mockConfig.recordLegacyIpcInvocations) {
        const forbiddenLegacyChannels = [
          'file:readText',
          'file:readBinary',
          'file:writeText',
          'file:stat',
          'file:listDir',
          'file:listTree',
          'shell:openExternal',
          'shell:showItemInFolder',
          'shell:openPath',
        ];
        for (const channel of forbiddenLegacyChannels) {
          const instrumentedHandler: IpcInvokeHandler = async (_event: unknown, ...args: unknown[]) => {
            globals.__e2eLegacyIpcInvocations?.push({ channel, args });
            if (channel === 'shell:openPath') return 'legacyIpcForbidden';
            if (channel.startsWith('file:')) return { ok: false, error: 'legacyIpcForbidden' };
            return undefined;
          };
          instrumentedLegacyHandlers.set(channel, instrumentedHandler);
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, instrumentedHandler);
        }
      }

      const legacyPathForHostRequest = (request: {
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }): [string, string] | null => {
        const payload = request.payload ?? {};
        if (request.module === 'gateway') {
          if (request.action === 'status') return ['/api/gateway/status', 'GET'];
          if (request.action === 'start') return ['/api/gateway/start', 'POST'];
          if (request.action === 'restart') return ['/api/gateway/restart', 'POST'];
        }
        if (request.module === 'agents' && request.action === 'list') return ['/api/agents', 'GET'];
        if (request.module === 'settings' && request.action === 'getAll') return ['/api/settings', 'GET'];
        if (request.module === 'channels') {
          if (request.action === 'accounts') return ['/api/channels/accounts', 'GET'];
          if (request.action === 'validateCredentials') return ['/api/channels/credentials/validate', 'POST'];
          if (request.action === 'saveConfig') return ['/api/channels/config', 'POST'];
          if (request.action === 'bindingSave') return ['/api/channels/binding', 'PUT'];
          if (request.action === 'bindingDelete') return ['/api/channels/binding', 'DELETE'];
          if (request.action === 'formValues') {
            const channelType = encodeURIComponent(String(payload.channelType ?? ''));
            return [`/api/channels/config/${channelType}`, 'GET'];
          }
        }
        if (request.module === 'diagnostics' && request.action === 'gatewaySnapshot') {
          return ['/api/diagnostics/gateway-snapshot', 'GET'];
        }
        if (request.module === 'cron' && request.action === 'list') return ['/api/cron/jobs', 'GET'];
        if (request.module === 'skills' && request.action === 'quickAccess') return ['/api/skills/quick-access', 'POST'];
        if (request.module === 'files' && request.action === 'thumbnails') return ['/api/files/thumbnails', 'POST'];
        if (request.module === 'media') {
          if (request.action === 'thumbnails') return ['/api/files/thumbnails', 'POST'];
          if (request.action === 'imageGenerationSettings') return ['/api/media/image-generation', 'GET'];
          if (request.action === 'saveImageGenerationSettings') return ['/api/media/image-generation', 'PUT'];
        }
        if (request.module === 'sessions') {
          if (request.action === 'history') {
            const params = new URLSearchParams();
            if (typeof payload.sessionKey === 'string') params.set('sessionKey', payload.sessionKey);
            if (typeof payload.agentId === 'string') params.set('agentId', payload.agentId);
            if (typeof payload.sessionId === 'string') params.set('sessionId', payload.sessionId);
            if (typeof payload.limit === 'number') params.set('limit', String(payload.limit));
            return [`/api/sessions/transcript?${params.toString()}`, 'GET'];
          }
          if (request.action === 'summaries') return ['/api/sessions/summaries', 'POST'];
        }
        return null;
      };

      if (mockConfig.gatewayRpc || mockConfig.hostApi || mockConfig.hostApiErrors || mockConfig.gatewayStatus) {
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (mockConfig.recordHostInvocations) {
            globals.__e2eHostInvocations?.push({
              module: request?.module,
              action: request?.action,
              payload: request?.payload,
            });
          }

          const typedKey = stableStringify([
            request?.module ?? null,
            request?.action ?? null,
            request?.payload ?? null,
          ]);
          if (mockConfig.hostApiErrors && typedKey in mockConfig.hostApiErrors) {
            return fail(request.id, mockConfig.hostApiErrors[typedKey]);
          }

          if (mockConfig.gatewayStatus && request?.module === 'gateway' && request.action === 'status') {
            return respond(request.id, mockConfig.gatewayStatus);
          }

          if (mockConfig.gatewayRpc && request?.module === 'gateway' && request.action === 'rpc') {
            const payload = request.payload ?? {};
            const method = typeof payload.method === 'string' ? payload.method : '';
            const params = 'params' in payload ? payload.params : null;
            const key = stableStringify([method, params ?? null]);
            if (key in mockConfig.gatewayRpc) return respondGatewayRpc(request.id, mockConfig.gatewayRpc[key]);
            if (method === 'sessions.list') {
              const emptySessionsListKey = stableStringify([method, {}]);
              if (emptySessionsListKey in mockConfig.gatewayRpc) {
                return respondGatewayRpc(request.id, mockConfig.gatewayRpc[emptySessionsListKey]);
              }
            }
            const fallbackKey = stableStringify([method, null]);
            if (fallbackKey in mockConfig.gatewayRpc) return respondGatewayRpc(request.id, mockConfig.gatewayRpc[fallbackKey]);
            const legacyGatewayRpc = getLegacyOverride('gateway:rpc', originalLegacyGatewayRpc);
            if (legacyGatewayRpc) {
              return respondGatewayRpc(
                request.id,
                await legacyGatewayRpc(event, method, params, payload.timeoutMs),
              );
            }
            return respond(request.id, {});
          }

          if (mockConfig.hostApi) {
            if (typedKey in mockConfig.hostApi) {
              return respond(request.id, unwrapLegacyResponse(mockConfig.hostApi[typedKey]));
            }

            const legacyPath = legacyPathForHostRequest(request ?? {});
            if (legacyPath) {
              const key = stableStringify(legacyPath);
              if (key in mockConfig.hostApi) {
                return respond(request.id, unwrapLegacyResponse(mockConfig.hostApi[key]));
              }
            }
          }

          if (request?.module === 'files') {
            const payload = request.payload ?? {};
            const path = typeof payload.path === 'string' ? payload.path : '';
            if (request.action === 'resolveWorkspaceContext') {
              const workspaceRoot = typeof payload.workspaceRoot === 'string'
                ? payload.workspaceRoot.trim()
                : '';
              const executionCwd = typeof payload.executionCwd === 'string'
                ? payload.executionCwd.trim()
                : '';
              if (!workspaceRoot || !executionCwd) {
                return respond(request.id, { ok: false, error: 'outsideSandbox' });
              }
              return respond(request.id, {
                ok: true,
                workspaceRoot,
                executionCwd,
              });
            }
            if (request.action === 'stat') {
              const legacyFileStat = getLegacyOverride('file:stat', originalLegacyFileStat);
              if (legacyFileStat) {
                return respond(request.id, await legacyFileStat(event, path));
              }
            }
            if (request.action === 'readText') {
              const legacyFileReadText = getLegacyOverride('file:readText', originalLegacyFileReadText);
              if (legacyFileReadText) {
                return respond(request.id, await legacyFileReadText(event, path));
              }
            }
            if (request.action === 'listTree') {
              const legacyFileListTree = getLegacyOverride('file:listTree', originalLegacyFileListTree);
              if (legacyFileListTree) {
                return respond(request.id, await legacyFileListTree(event, path, payload.opts));
              }
            }
          }

          return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
        });
      }

      if (mockConfig.gatewayStatus) {
        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => mockConfig.gatewayStatus);
      }
    },
    config,
  );
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export async function installAttachmentHostFixture(
  app: ElectronApplication,
  options: { sessions: AttachmentFixtureSession[] },
): Promise<AttachmentHostFixture> {
  if (options.sessions.length === 0) throw new Error('Attachment fixture requires at least one session');
  const homeDir = await app.evaluate(async () => process.env.HOME || process.env.USERPROFILE || '');
  if (!homeDir) throw new Error('Attachment fixture could not resolve the isolated home directory');
  const fixtureRoot = join(homeDir, 'attachment-e2e');
  const workspacePath = join(fixtureRoot, 'workspace');
  const outsidePath = join(fixtureRoot, 'outside');
  const openClawMediaPath = join(homeDir, '.openclaw', 'media');
  await Promise.all([
    mkdir(workspacePath, { recursive: true }),
    mkdir(outsidePath, { recursive: true }),
    mkdir(openClawMediaPath, { recursive: true }),
  ]);
  const [workspaceDir, outsideDir, openClawMediaDir] = await Promise.all([
    realpath(workspacePath),
    realpath(outsidePath),
    realpath(openClawMediaPath),
  ]);
  const productionAttachmentBundlePath = join(fixtureRoot, 'production-attachment-access.cjs');
  await writeFile(productionAttachmentBundlePath, await productionAttachmentBundle(), 'utf-8');

  const now = Date.now();
  const sessionRecords = options.sessions.map((session, index) => ({
    key: session.key,
    displayName: session.title,
    derivedTitle: session.title,
    workspacePath: workspaceDir,
    updatedAt: new Date(now - index).toISOString(),
  }));
  const sessionsList = { success: true, result: { sessions: sessionRecords } };
  const sessionKeys = options.sessions.map((session) => session.key);
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: now },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: sessionsList,
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: sessionsList,
      [stableStringify(['chat.history', null])]: { success: true, result: { messages: [] } },
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        setupComplete: true,
        chatWorkspacePath: workspaceDir,
        recentWorkspacePaths: [workspaceDir],
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{
          id: 'main',
          name: 'main',
          workspace: workspaceDir,
          mainSessionKey: options.sessions[0]!.key,
        }],
      },
      [stableStringify(['sessions', 'summaries', { sessionKeys }])]: {
        success: true,
        summaries: options.sessions.map((session, index) => ({
          sessionKey: session.key,
          firstUserText: session.title,
          lastTimestamp: now - index,
          workspacePath: workspaceDir,
        })),
      },
    },
    recordLegacyIpcInvocations: true,
  });

  await app.evaluate(async ({ app: _app }, payload) => {
    const { BrowserWindow, ipcMain, shell } = process.mainModule!.require('electron') as typeof import('electron');
    type AcpUpdate = Record<string, unknown> & { sessionUpdate: string };
    type TranscriptResponse = { messages: RawMessage[]; deferId?: string };
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    type HostHandler = (event: unknown, request: HostRequest) => Promise<unknown>;
    type FixtureState = {
      activeSessionKey: string;
      generation: number;
      replays: Record<string, AcpUpdate[]>;
      promptUpdates: Record<string, AcpUpdate[]>;
      transcriptResponses: Record<string, TranscriptResponse[]>;
      transcriptIndexes: Record<string, number>;
      historyRequestTimes: Record<string, number[]>;
      replayReady: Record<string, Promise<void> | undefined>;
      deferredTranscriptResolvers: Record<string, (() => void) | undefined>;
      deferredTranscriptReady: Record<string, boolean>;
      deferredTranscriptReturned: Record<string, boolean>;
      deferredTranscriptCompleted: Record<string, boolean>;
      openHandlersResult: AttachmentOpenHandlersFixtureResult;
      hostInvocations: RecordedHostInvocation[];
      shellInvocations: RecordedHostInvocation[];
      stagedAttachments?: { register: (id: string, canonicalPath: string, displayPath?: string) => void };
    };
    const globals = globalThis as unknown as { __e2eAttachmentFixture?: FixtureState };
    const state: FixtureState = {
      activeSessionKey: '',
      generation: 0,
      replays: {},
      promptUpdates: {},
      transcriptResponses: {},
      transcriptIndexes: {},
      historyRequestTimes: {},
      replayReady: {},
      deferredTranscriptResolvers: {},
      deferredTranscriptReady: {},
      deferredTranscriptReturned: {},
      deferredTranscriptCompleted: {},
      openHandlersResult: {
        ok: true,
        platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
        handlers: [],
      },
      hostInvocations: [],
      shellInvocations: [],
    };
    globals.__e2eAttachmentFixture = state;

    const instrumentedShell = shell as unknown as {
      openPath: (path: string) => Promise<string>;
      openExternal: (url: string) => Promise<void>;
      showItemInFolder: (path: string) => void;
    };
    instrumentedShell.openPath = async (path) => {
      state.shellInvocations.push({ module: 'shell', action: 'openPath', payload: { path } });
      return '';
    };
    instrumentedShell.openExternal = async (url) => {
      state.shellInvocations.push({ module: 'shell', action: 'openExternal', payload: { url } });
    };
    instrumentedShell.showItemInFolder = (path) => {
      state.shellInvocations.push({ module: 'shell', action: 'showItemInFolder', payload: { path } });
    };

    type ProductionAttachmentModule = {
      AcpSessionAccessRegistry: new () => {
        prepareGrant: (input: {
          sessionKey: string;
          generation: number;
          workspaceRoot: string;
          executionCwd: string;
        }) => Promise<unknown>;
        commitGrant: (grant: unknown) => void;
      };
      StagedAttachmentRegistry: new () => {
        register: (id: string, canonicalPath: string, displayPath?: string) => void;
      };
      createMediaApi: (dependencies: { attachmentAccess: unknown }) => {
        thumbnails: (input: unknown) => Promise<unknown>;
      };
      createAttachmentAccess: (dependencies: {
        sessionAccessRegistry: unknown;
        stagedAttachments: unknown;
      }) => {
        resolveAttachment: (input: unknown) => Promise<unknown>;
        readAttachmentText: (input: unknown) => Promise<unknown>;
        readAttachmentBinary: (input: unknown) => Promise<unknown>;
        openAttachment: (input: unknown) => Promise<unknown>;
      };
    };
    const production = process.mainModule!.require(payload.productionAttachmentBundlePath) as ProductionAttachmentModule;
    const productionSessionAccess = new production.AcpSessionAccessRegistry();
    const productionStagedAttachments = new production.StagedAttachmentRegistry();
    state.stagedAttachments = productionStagedAttachments;
    const productionAttachmentAccess = production.createAttachmentAccess({
      sessionAccessRegistry: productionSessionAccess,
      stagedAttachments: productionStagedAttachments,
    });
    const productionMediaApi = production.createMediaApi({ attachmentAccess: productionAttachmentAccess });

    const respond = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });
    const emitUpdates = (sessionKey: string, generation: number, historical: boolean, updates: AcpUpdate[]) => {
      for (const update of updates) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('chat:acp-session-update', {
            sessionKey,
            generation,
            ...(historical ? { historical: true } : {}),
            notification: { sessionId: sessionKey, update },
          });
        }
      }
    };
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      state.hostInvocations.push({ module: request.module, action: request.action, payload: request.payload });

      if (request.module === 'chat' && request.action === 'loadAcpSession') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        state.generation += 1;
        state.activeSessionKey = sessionKey;
        const generation = state.generation;
        const grant = await productionSessionAccess.prepareGrant({
          sessionKey,
          generation,
          workspaceRoot: payload.workspaceDir,
          executionCwd: payload.workspaceDir,
        });
        productionSessionAccess.commitGrant(grant);
        const replay = state.replays[sessionKey] ?? [];
        state.replayReady[sessionKey] = new Promise((resolveReplay) => {
          setTimeout(() => {
            emitUpdates(sessionKey, generation, true, replay);
            resolveReplay();
          }, 0);
        });
        return respond(request.id, { success: true, generation });
      }
      if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        const prompt = String(request.payload?.message ?? '');
        if (sessionKey === state.activeSessionKey) {
          emitUpdates(sessionKey, state.generation, false, state.promptUpdates[prompt] ?? []);
        }
        return respond(request.id, { success: true, generation: state.generation });
      }
      if (request.module === 'sessions' && request.action === 'history') {
        const sessionKey = String(request.payload?.sessionKey ?? '');
        const times = state.historyRequestTimes[sessionKey] ?? [];
        times.push(Date.now());
        state.historyRequestTimes[sessionKey] = times;
        await state.replayReady[sessionKey];
        const responses = state.transcriptResponses[sessionKey] ?? [{ messages: [] }];
        const index = state.transcriptIndexes[sessionKey] ?? 0;
        state.transcriptIndexes[sessionKey] = index + 1;
        const response = responses[Math.min(index, responses.length - 1)] ?? { messages: [] };
        if (response.deferId) {
          state.deferredTranscriptReady[response.deferId] = true;
          await new Promise<void>((resolveResponse) => {
            state.deferredTranscriptResolvers[response.deferId!] = resolveResponse;
          });
          delete state.deferredTranscriptResolvers[response.deferId];
          state.deferredTranscriptReturned[response.deferId] = true;
        }
        return respond(request.id, { success: true, messages: response.messages });
      }
      if (request.module === 'files' && request.action === 'resolveWorkspaceContext') {
        const workspaceRoot = typeof request.payload?.workspaceRoot === 'string'
          ? request.payload.workspaceRoot.trim()
          : '';
        const executionCwd = typeof request.payload?.executionCwd === 'string'
          ? request.payload.executionCwd.trim()
          : '';
        if (!workspaceRoot || !executionCwd) {
          return respond(request.id, { ok: false, error: 'outsideSandbox' });
        }
        return respond(request.id, {
          ok: true,
          workspaceRoot,
          executionCwd,
        });
      }
      if (request.module === 'files' && request.action === 'resolveAttachment') {
        return respond(request.id, await productionAttachmentAccess.resolveAttachment(request.payload));
      }
      if (request.module === 'files' && request.action === 'readAttachmentText') {
        return respond(request.id, await productionAttachmentAccess.readAttachmentText(request.payload));
      }
      if (request.module === 'files' && request.action === 'readAttachmentBinary') {
        return respond(request.id, await productionAttachmentAccess.readAttachmentBinary(request.payload));
      }
      if (request.module === 'files' && request.action === 'openAttachment') {
        return respond(request.id, await productionAttachmentAccess.openAttachment(request.payload));
      }
      if (request.module === 'files' && request.action === 'listAttachmentOpenHandlers') {
        return respond(request.id, state.openHandlersResult);
      }
      if (request.module === 'files' && request.action === 'openAttachmentWith') {
        return respond(request.id, { ok: true });
      }
      if (request.module === 'files' && request.action === 'revealAttachment') {
        return respond(request.id, { ok: true });
      }
      if (request.module === 'media' && request.action === 'thumbnails') {
        return respond(request.id, await productionMediaApi.thumbnails(request.payload));
      }
      if (request.module === 'diagnostics' && request.action === 'recordAcpTrace') {
        if (request.payload?.event === 'openclaw-media:projection-stale') {
          for (const deferId of Object.keys(state.deferredTranscriptReturned)) {
            state.deferredTranscriptCompleted[deferId] = true;
          }
        }
        return respond(request.id, { success: true });
      }

      return originalHostInvoke?.(event, request) ?? respond(request.id, {});
    });
  }, { workspaceDir, productionAttachmentBundlePath });

  const writeFixtureFile = async (root: string, relativePath: string, data: string | Uint8Array) => {
    const filePath = resolve(root, relativePath);
    const fromRoot = relative(root, filePath);
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error(`Attachment fixture path escapes its root: ${relativePath}`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return filePath;
  };
  const readState = async () => await app.evaluate(async () => {
    const state = (globalThis as unknown as {
      __e2eAttachmentFixture?: {
        historyRequestTimes: Record<string, number[]>;
        deferredTranscriptReady: Record<string, boolean>;
        deferredTranscriptCompleted: Record<string, boolean>;
        hostInvocations: RecordedHostInvocation[];
        shellInvocations: RecordedHostInvocation[];
      };
    }).__e2eAttachmentFixture;
    if (!state) throw new Error('Attachment fixture is not installed');
    return {
      historyRequestTimes: state.historyRequestTimes,
      deferredTranscriptReady: state.deferredTranscriptReady,
      deferredTranscriptCompleted: state.deferredTranscriptCompleted,
      hostInvocations: state.hostInvocations,
      shellInvocations: state.shellInvocations,
    };
  });

  return {
    workspaceDir,
    openClawMediaDir,
    outsideDir,
    createWorkspaceFile: async (path, data) => await writeFixtureFile(workspaceDir, path, data),
    createOpenClawMediaFile: async (path, data) => await writeFixtureFile(openClawMediaDir, path, data),
    createOutsideFile: async (path, data) => await writeFixtureFile(outsideDir, path, data),
    registerStagedAttachment: async (id, stagedPath, displayPath) => {
      await app.evaluate(async ({ app: _app }, input) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: {
            stagedAttachments?: { register: (id: string, canonicalPath: string, displayPath?: string) => void };
          };
        }).__e2eAttachmentFixture;
        if (!state?.stagedAttachments) throw new Error('Attachment staging fixture is not installed');
        state.stagedAttachments.register(input.id, input.stagedPath, input.displayPath);
      }, { id, stagedPath, displayPath });
    },
    emitAcpSessionUpdates: async (input) => {
      await app.evaluate(async ({ app: _app }, event) => {
        const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { activeSessionKey: string; generation: number };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        const generation = event.generation ?? state.generation;
        for (const update of event.updates) {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('chat:acp-session-update', {
              sessionKey: event.sessionKey,
              generation,
              ...(event.historical ? { historical: true } : {}),
              notification: { sessionId: event.sessionKey, update },
            });
          }
        }
      }, input);
    },
    setPromptUpdates: async (prompt, updates) => {
      await app.evaluate(async ({ app: _app }, input) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { promptUpdates: Record<string, unknown[]> };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        state.promptUpdates[input.prompt] = input.updates;
      }, { prompt, updates });
    },
    setSessionReplay: async (sessionKey, updates) => {
      await app.evaluate(async ({ app: _app }, input) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { replays: Record<string, unknown[]> };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        state.replays[input.sessionKey] = input.updates;
      }, { sessionKey, updates });
    },
    setTranscriptResponses: async (sessionKey, responses) => {
      const normalized = responses.map((response) => Array.isArray(response)
        ? { messages: response }
        : response);
      await app.evaluate(async ({ app: _app }, input) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: {
            transcriptResponses: Record<string, unknown[]>;
            transcriptIndexes: Record<string, number>;
          };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        state.transcriptResponses[input.sessionKey] = input.responses;
        state.transcriptIndexes[input.sessionKey] = 0;
      }, { sessionKey, responses: normalized });
    },
    releaseTranscriptResponse: async (deferId) => {
      await app.evaluate(async ({ app: _app }, id) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { deferredTranscriptResolvers: Record<string, (() => void) | undefined> };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        const release = state.deferredTranscriptResolvers[id];
        if (!release) throw new Error(`Deferred transcript response is not ready: ${id}`);
        delete state.deferredTranscriptResolvers[id];
        release();
      }, deferId);
    },
    waitForDeferredTranscriptReady: async (deferId, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await readState()).deferredTranscriptReady[deferId]) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      throw new Error(`Timed out waiting for deferred transcript response to become ready: ${deferId}`);
    },
    waitForDeferredTranscriptCompleted: async (deferId, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await readState()).deferredTranscriptCompleted[deferId]) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      throw new Error(`Timed out waiting for deferred transcript response to complete: ${deferId}`);
    },
    waitForHistoryRequestCount: async (sessionKey, count, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const times = (await readState()).historyRequestTimes[sessionKey] ?? [];
        if (times.length >= count) return times;
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      throw new Error(`Timed out waiting for ${count} transcript requests for ${sessionKey}`);
    },
    clearHistoryRequestTimes: async (sessionKey) => {
      await app.evaluate(async ({ app: _app }, key) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { historyRequestTimes: Record<string, number[]> };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        if (key) {
          state.historyRequestTimes[key] = [];
          return;
        }
        state.historyRequestTimes = {};
      }, sessionKey);
    },
    waitForHistoryQuiet: async (sessionKey, quietMs = 300, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      let lastCount = -1;
      let quietSince = Date.now();
      while (Date.now() < deadline) {
        const times = (await readState()).historyRequestTimes[sessionKey] ?? [];
        if (times.length !== lastCount) {
          lastCount = times.length;
          quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
          return;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      throw new Error(`Timed out waiting for transcript requests to stay quiet for ${sessionKey}`);
    },
    setOpenHandlersResult: async (result) => {
      await app.evaluate(async ({ app: _app }, nextResult) => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: { openHandlersResult: AttachmentOpenHandlersFixtureResult };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        state.openHandlersResult = nextResult;
      }, result);
    },
    getHostInvocations: async () => (await readState()).hostInvocations,
    getShellInvocations: async () => (await readState()).shellInvocations,
    clearInvocations: async () => {
      await app.evaluate(async () => {
        const state = (globalThis as unknown as {
          __e2eAttachmentFixture?: {
            hostInvocations: RecordedHostInvocation[];
            shellInvocations: RecordedHostInvocation[];
          };
        }).__e2eAttachmentFixture;
        if (!state) throw new Error('Attachment fixture is not installed');
        state.hostInvocations = [];
        state.shellInvocations = [];
      });
    },
  };
}

export async function getRecordedHostInvocations(app: ElectronApplication): Promise<RecordedHostInvocation[]> {
  return await app.evaluate(async ({ app: _app }) => (
    (globalThis as unknown as { __e2eHostInvocations?: RecordedHostInvocation[] }).__e2eHostInvocations ?? []
  ));
}

export async function getRecordedLegacyIpcInvocations(app: ElectronApplication): Promise<RecordedLegacyIpcInvocation[]> {
  return await app.evaluate(async ({ app: _app }) => (
    (globalThis as unknown as { __e2eLegacyIpcInvocations?: RecordedLegacyIpcInvocation[] })
      .__e2eLegacyIpcInvocations ?? []
  ));
}

export async function clearRecordedFileAccessInvocations(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app: _app }) => {
    const globals = globalThis as unknown as {
      __e2eHostInvocations?: RecordedHostInvocation[];
      __e2eLegacyIpcInvocations?: RecordedLegacyIpcInvocation[];
    };
    globals.__e2eHostInvocations = [];
    globals.__e2eLegacyIpcInvocations = [];
  });
}
