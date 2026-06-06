import electronBinaryPath from 'electron';
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type LaunchElectronOptions = {
  skipSetup?: boolean;
};

type IpcMockConfig = {
  gatewayStatus?: Record<string, unknown>;
  gatewayRpc?: Record<string, unknown>;
  hostApi?: Record<string, unknown>;
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
    args: ['--lang=en-US', electronEntry],
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
      type IpcInvokeHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
      const getInvokeHandler = (channel: string): IpcInvokeHandler | undefined => {
        return (ipcMain as unknown as {
          _invokeHandlers?: Map<string, IpcInvokeHandler>;
        })._invokeHandlers?.get(channel);
      };

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
      const getLegacyOverride = (channel: string, original?: IpcInvokeHandler) => {
        const current = getInvokeHandler(channel);
        return current && current !== original ? current : null;
      };

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

      if (mockConfig.gatewayRpc || mockConfig.hostApi || mockConfig.gatewayStatus) {
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
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
            const typedKey = stableStringify([
              request?.module ?? null,
              request?.action ?? null,
              request?.payload ?? null,
            ]);
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
