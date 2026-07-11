import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createConnection, createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);

async function realRuntimeBundles(): Promise<{ ccConnectPath: string; codexPath: string } | null> {
  const platformArch = `${process.platform}-${process.arch}`;
  const ccConnectPath = join(
    process.cwd(),
    'build',
    'cc-connect',
    platformArch,
    process.platform === 'win32' ? 'cc-connect.exe' : 'cc-connect',
  );
  const codexPath = join(
    process.cwd(),
    'build',
    'codex',
    platformArch,
    'bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex',
  );
  try {
    await access(ccConnectPath);
    await access(codexPath);
    return { ccConnectPath, codexPath };
  } catch {
    return null;
  }
}

async function isPortOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPortClosed(port: number): Promise<void> {
  await expect.poll(async () => await isPortOpen(port), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `cc-connect port ${port} should be free before real bundle smoke starts`,
  }).toBe(false);
}

async function occupyPort(port: number): Promise<Server | null> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function closeServer(server: Server | null | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listProcessCommandsContaining(needle: string): Promise<string[]> {
  if (process.platform === 'win32') return [];
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command='], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(needle))
    .filter((line) => !line.includes('ps -axo'));
}

async function expectRuntimeProcessCleanedUp(options: {
  pid?: number;
  runtimeDir: string;
  managementPort?: number;
  bridgePort?: number;
}): Promise<void> {
  if (typeof options.pid === 'number') {
    await expect.poll(() => isPidAlive(options.pid), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
      message: `cc-connect pid ${options.pid} should exit`,
    }).toBe(false);
  }

  for (const port of [options.managementPort, options.bridgePort].filter((value): value is number => typeof value === 'number')) {
    await expect.poll(async () => await isPortOpen(port), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
      message: `cc-connect port ${port} should close`,
    }).toBe(false);
  }

  if (process.platform !== 'win32') {
    await expect.poll(async () => await listProcessCommandsContaining(options.runtimeDir), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
      message: `no process should reference ${options.runtimeDir}`,
    }).toEqual([]);
  }
}

async function seedCcConnectRuntimeSettings(userDataDir: string): Promise<void> {
  const createdAt = '2026-06-07T00:00:00.000Z';
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
    language: 'en',
    devModeUnlocked: true,
    runtimeKind: 'cc-connect',
    gatewayAutoStart: false,
  }, null, 2), 'utf8');
  await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
    schemaVersion: 0,
    providerAccounts: {
      'ollama-local': {
        id: 'ollama-local',
        vendorId: 'ollama',
        label: 'Ollama',
        authMode: 'local',
        model: 'qwen3:latest',
        enabled: true,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
      },
    },
    providerSecrets: {},
    apiKeys: {},
    defaultProviderAccountId: 'ollama-local',
  }, null, 2), 'utf8');
}

async function seedCanonicalRuntimeConfig(userDataDir: string, config: Record<string, unknown>): Promise<void> {
  const appDir = join(userDataDir, 'app');
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, 'runtime-config.json'), JSON.stringify({
    schema: 'clawx-runtime-config',
    version: 1,
    updatedAt: new Date().toISOString(),
    config,
  }, null, 2), 'utf8');
}

test.describe('cc-connect real runtime bundle smoke', () => {
  test('probes the public Management and Bridge session APIs exposed by the bundled runtime', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(userDataDir);
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect.poll(async () => {
        const result = await page.evaluate(async () => window.clawx.hostInvoke({
          id: 'runtime-start-session-api-probe',
          module: 'gateway',
          action: 'start',
        }));
        return result.ok;
      }, { timeout: 30_000 }).toBe(true);

      const config = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      const managementBlock = config.match(/\[management\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
      const bridgeBlock = config.match(/\[bridge\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
      const managementPort = Number(managementBlock.match(/^port\s*=\s*(\d+)/m)?.[1]);
      const managementToken = managementBlock.match(/^token\s*=\s*"([^"]+)"/m)?.[1] ?? '';
      const bridgePort = Number(bridgeBlock.match(/^port\s*=\s*(\d+)/m)?.[1]);
      const bridgeToken = bridgeBlock.match(/^token\s*=\s*"([^"]+)"/m)?.[1] ?? '';
      expect(managementPort).toBeGreaterThan(0);
      expect(bridgePort).toBeGreaterThan(0);
      expect(managementToken).not.toBe('');
      expect(bridgeToken).not.toBe('');

      const managementSessions = await fetch(`http://127.0.0.1:${managementPort}/api/v1/projects/clawx-main/sessions`, {
        headers: { Authorization: `Bearer ${managementToken}` },
      });
      expect(managementSessions.status).toBe(200);
      await expect(managementSessions.json()).resolves.toMatchObject({ ok: true });

      const createResponse = await fetch(`http://127.0.0.1:${bridgePort}/bridge/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bridgeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          project: 'clawx-main',
          session_key: 'clawx:main:public-api-probe',
          name: 'Public API probe',
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = await createResponse.json() as { ok?: boolean; data?: { id?: string }; id?: string };
      expect(created.ok ?? true).toBe(true);
      const sessionId = created.data?.id ?? created.id;
      expect(sessionId).toBeTruthy();

      const listResponse = await fetch(
        `http://127.0.0.1:${bridgePort}/bridge/sessions?project=clawx-main&session_key=clawx%3Amain%3Apublic-api-probe`,
        { headers: { Authorization: `Bearer ${bridgeToken}` } },
      );
      expect(listResponse.status).toBe(200);
      const bridgeListBody = await listResponse.json();
      expect(JSON.stringify(bridgeListBody)).toContain(String(sessionId));

      const detailResponse = await fetch(
        `http://127.0.0.1:${bridgePort}/bridge/sessions/${encodeURIComponent(String(sessionId))}?project=clawx-main&session_key=clawx%3Amain%3Apublic-api-probe`,
        { headers: { Authorization: `Bearer ${bridgeToken}` } },
      );
      expect(detailResponse.status).toBe(200);
      expect(JSON.stringify(await detailResponse.json())).toContain(String(sessionId));

      const deleteResponse = await fetch(
        `http://127.0.0.1:${bridgePort}/bridge/sessions/${encodeURIComponent(String(sessionId))}?project=clawx-main&session_key=clawx%3Amain%3Apublic-api-probe`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${bridgeToken}` },
        },
      );
      expect(deleteResponse.status).toBe(200);

      const listAfterDelete = await fetch(
        `http://127.0.0.1:${bridgePort}/bridge/sessions?project=clawx-main&session_key=clawx%3Amain%3Apublic-api-probe`,
        { headers: { Authorization: `Bearer ${bridgeToken}` } },
      );
      expect(listAfterDelete.status).toBe(200);
      expect(JSON.stringify(await listAfterDelete.json())).not.toContain(String(sessionId));
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts cc-connect from bundled binaries in a local dev Electron run', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(userDataDir);

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const statusResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-real-bundle',
          module: 'gateway',
          action: 'status',
        });
      });
      expect(statusResult).toMatchObject({
        ok: true,
        data: {
          runtimeKind: 'cc-connect',
        },
      });
      const healthResult = await page.evaluate(async () => window.clawx.hostInvoke({
        id: 'runtime-health-real-bundle',
        module: 'gateway',
        action: 'health',
        payload: { probe: true },
      }));
      expect(healthResult).toMatchObject({ ok: true, data: { ok: true } });

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('Managed by ClawX');
      expect(managedConfig).toContain('BridgePlatform');
      expect(managedConfig).toContain(`work_dir = "${join(userDataDir, 'workspaces', 'agents', 'main')}"`);
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());
      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('"vendorId": "ollama"');
      expect(publicProfile).toContain('qwen3:latest');

      const diagnostics = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-diagnostics-real-bundle',
          module: 'diagnostics',
          action: 'gatewaySnapshot',
        });
      }) as {
        ok: boolean;
        data?: {
          runtime?: {
            activeKind?: string;
            status?: { runtimeKind?: string; state?: string };
            operationCapabilities?: Record<string, { support?: string }>;
            ccConnect?: {
              managedDir?: string;
              configPath?: string;
              codexHomeDir?: string;
              providerProfilePath?: string;
              providerProfile?: { vendorId?: string; envKeys?: string[] };
              managementApi?: { success?: boolean; port?: number };
              cron?: { success?: boolean; jobCount?: number; knownGaps?: string[]; jobs?: unknown[] };
              binaries?: {
                ccConnect?: { versionCommand?: { success?: boolean; output?: string } };
                codex?: { versionCommand?: { success?: boolean; output?: string } };
              };
              logTail?: string;
            };
          };
        };
      };
      expect(diagnostics).toMatchObject({
        ok: true,
        data: {
          runtime: {
            activeKind: 'cc-connect',
            status: { runtimeKind: 'cc-connect', state: 'running' },
            operationCapabilities: expect.objectContaining({
              'chat.send': expect.objectContaining({ support: 'native' }),
              'doctor.fix': expect.objectContaining({ support: 'unsupported' }),
            }),
            ccConnect: expect.objectContaining({
              managedDir: join(userDataDir, 'runtimes', 'cc-connect'),
              configPath: join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'),
              codexHomeDir: join(userDataDir, 'runtimes', 'cc-connect', 'codex-home'),
              providerProfilePath: join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'),
              providerProfile: expect.objectContaining({ vendorId: 'ollama' }),
              managementApi: expect.objectContaining({ success: true }),
              cron: expect.objectContaining({
                success: true,
                jobCount: 0,
                jobs: [],
                knownGaps: expect.arrayContaining([
                  'scheduled-prompt-delivery-unproven',
                ]),
              }),
              binaries: expect.objectContaining({
                ccConnect: expect.objectContaining({
                  versionCommand: expect.objectContaining({ success: true }),
                }),
                codex: expect.objectContaining({
                  versionCommand: expect.objectContaining({ success: true }),
                }),
              }),
            }),
          },
        },
      });
      const diagnosticsText = JSON.stringify(diagnostics);
      expect(diagnosticsText).not.toContain('runtime-management-token');
      expect(diagnosticsText).not.toContain('token = "');
      const runtimeLogTail = diagnostics.data?.runtime?.ccConnect?.logTail ?? '';
      expect(runtimeLogTail).toContain('## cc-connect stdout/stderr');
      expect(runtimeLogTail).toContain('## ClawX runtime manager');
      expect(runtimeLogTail).toContain('## Managed config (redacted)');
      const runtimeLogPath = join(userDataDir, 'runtimes', 'cc-connect', 'logs', 'runtime.log');
      await expect.poll(async () => {
        try {
          await access(runtimeLogPath);
          return true;
        } catch {
          return false;
        }
      }, { timeout: 10_000 }).toBe(true);
      const runtimeLogFile = await readFile(runtimeLogPath, 'utf8');
      expect(runtimeLogFile.length).toBeGreaterThan(0);
      expect(runtimeLogFile).not.toContain('runtime-management-token');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts bundled cc-connect on fallback ports when defaults are occupied', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    const occupiedBridge = await occupyPort(9810);
    const occupiedManagement = await occupyPort(9820);
    await seedCcConnectRuntimeSettings(userDataDir);

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle-port-fallback',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const statusResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-real-bundle-port-fallback',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { runtimeKind?: string; port?: number } };
      expect(statusResult).toMatchObject({
        ok: true,
        data: { runtimeKind: 'cc-connect' },
      });
      expect(statusResult.data?.port).not.toBe(9820);

      const controlUiResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-control-ui-real-bundle-port-fallback',
          module: 'gateway',
          action: 'controlUi',
        });
      }) as { ok: boolean; data?: { success?: boolean; port?: number; url?: string } };
      expect(controlUiResult).toMatchObject({
        ok: true,
        data: {
          success: true,
          port: statusResult.data?.port,
        },
      });
      expect(controlUiResult.data?.url).toBe(`http://127.0.0.1:${statusResult.data?.port}/`);

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('[management]');
      expect(managedConfig).toContain(`port = ${statusResult.data?.port}`);
      if (occupiedBridge) {
        expect(managedConfig).not.toContain('\nport = 9810\n');
      }
    } finally {
      await closeElectronApp(app);
      await closeServer(occupiedBridge);
      await closeServer(occupiedManagement);
    }
  });

  test('reloads managed channel config and reads live project platform status without restarting cc-connect', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(join(userDataDir, 'app'));
    const workspace = join(userDataDir, 'line-reload-workspace');
    await seedCanonicalRuntimeConfig(userDataDir, {
      agents: {
        defaults: { workspace },
        list: [{ id: 'main', name: 'Main Agent', default: true, workspace }],
      },
    });

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_DATA_HOME: userDataDir,
        CLAWX_USER_DATA_DIR: join(userDataDir, 'system', 'electron'),
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle-channel-reload',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const beforeReloadStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-before-channel-reload',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(beforeReloadStatus).toMatchObject({
        ok: true,
        data: { runtimeKind: 'cc-connect' },
      });
      expect(beforeReloadStatus.data?.pid).toBeGreaterThan(0);

      const saveResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-save-real-bundle-line-reload',
          module: 'channels',
          action: 'saveConfig',
          payload: {
            channelType: 'line',
            accountId: 'local_line',
            config: {
              channelSecret: 'line-secret',
              channelToken: 'line-token',
              port: '0',
              callbackPath: '/callback',
            },
          },
        });
      });
      expect(saveResult).toMatchObject({ ok: true, data: { success: true } });

      const connectResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-connect-real-bundle-line-reload',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'channels.connect',
            params: { channelType: 'line' },
            timeoutMs: 60_000,
          },
        });
      });
      expect(connectResult).toMatchObject({ ok: true, data: { success: true } });

      const afterReloadStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-after-channel-reload',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(afterReloadStatus).toMatchObject({
        ok: true,
        data: {
          runtimeKind: 'cc-connect',
          pid: beforeReloadStatus.data?.pid,
          port: beforeReloadStatus.data?.port,
        },
      });

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('type = "line"');
      expect(managedConfig).toContain('channel_secret = "${CLAWX_CHANNEL_LINE_LOCAL_LINE_CHANNEL_SECRET}"');
      expect(managedConfig).toContain('channel_token = "${CLAWX_CHANNEL_LINE_LOCAL_LINE_CHANNEL_TOKEN}"');
      expect(managedConfig).not.toContain('line-secret');
      expect(managedConfig).not.toContain('line-token');
      await expect(access(join(homeDir, '.openclaw', 'openclaw.json'))).rejects.toThrow();

      const channelsAccounts = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-accounts-real-bundle-line-reload',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAccounts).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'line',
              accounts: expect.arrayContaining([
                expect.objectContaining({
                  accountId: 'local_line',
                  configured: true,
                  connected: true,
                  running: true,
                  linked: true,
                }),
              ]),
            }),
          ]),
        },
      });

      const disableResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-disable-real-bundle-line-reload',
          module: 'channels',
          action: 'setEnabled',
          payload: { channelType: 'line', enabled: false },
        });
      });
      expect(disableResult).toMatchObject({ ok: true, data: { success: true } });

      const disconnectResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-disconnect-real-bundle-line-reload',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'channels.disconnect',
            params: { channelType: 'line' },
            timeoutMs: 60_000,
          },
        });
      });
      expect(disconnectResult).toMatchObject({ ok: true, data: { success: true } });

      const afterDisconnectStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-after-channel-disconnect',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(afterDisconnectStatus).toMatchObject({
        ok: true,
        data: {
          runtimeKind: 'cc-connect',
          pid: beforeReloadStatus.data?.pid,
          port: beforeReloadStatus.data?.port,
        },
      });

      const managedConfigAfterDisconnect = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfigAfterDisconnect).not.toContain('channel_secret = "line-secret"');
      expect(managedConfigAfterDisconnect).not.toContain('channel_token = "line-token"');
      expect(managedConfigAfterDisconnect).toContain('channel_secret = "clawx-local-placeholder"');
      expect(managedConfigAfterDisconnect).toContain('channel_token = "clawx-local-placeholder"');

      const channelsAccountsAfterDisconnect = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-accounts-after-disconnect-real-bundle-line-reload',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAccountsAfterDisconnect).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.not.arrayContaining([
            expect.objectContaining({ channelType: 'line' }),
          ]),
        },
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('projects Feishu and Lark channel config through cc-connect runtime lifecycle without tenant credentials', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(join(userDataDir, 'app'));
    const mainWorkspace = join(userDataDir, 'feishu-main-workspace');
    const opsWorkspace = join(userDataDir, 'feishu-ops-workspace');
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(opsWorkspace, { recursive: true });
    await seedCanonicalRuntimeConfig(userDataDir, {
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          {
            id: 'main',
            name: 'Main Agent',
            default: true,
            workspace: mainWorkspace,
          },
          {
            id: 'ops',
            name: 'Ops Agent',
            workspace: opsWorkspace,
          },
        ],
      },
    });

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_DATA_HOME: userDataDir,
        CLAWX_USER_DATA_DIR: join(userDataDir, 'system', 'electron'),
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle-feishu-projection',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      for (const [agentId, modelRef] of [
        ['main', 'ollama/main-model-e2e'],
        ['ops', 'ollama/ops-model-e2e'],
      ] as const) {
        const updateModelResult = await page.evaluate(async ({ id, model }) => await window.clawx.hostInvoke({
          id: `runtime-agent-model-${id}-real-bundle-feishu-projection`,
          module: 'agents',
          action: 'updateModel',
          payload: { id, modelRef: model, providerAccountId: 'ollama-local' },
        }), { id: agentId, model: modelRef });
        expect(updateModelResult).toMatchObject({ ok: true, data: { success: true } });
      }

      const beforeReloadStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-before-feishu-projection',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(beforeReloadStatus).toMatchObject({
        ok: true,
        data: { runtimeKind: 'cc-connect' },
      });
      expect(beforeReloadStatus.data?.pid).toBeGreaterThan(0);

      const saveCnResult = await page.evaluate(async () => await window.clawx.hostInvoke({
        id: 'runtime-channel-save-real-bundle-feishu-cn',
        module: 'channels',
        action: 'saveConfig',
        payload: {
          channelType: 'feishu',
          accountId: 'cn_bot',
          config: {
            appId: 'cli_feishu_cn',
            appSecret: 'feishu-secret-cn',
            domain: 'feishu',
            allowFrom: ['oc_main', 'ou_user'],
            adminUsers: 'ou_cron_admin',
            shareSessionInChannel: true,
            enableFeishuCard: false,
            callbackPath: '/feishu/callback',
          },
        },
      }));
      expect(saveCnResult).toMatchObject({ ok: true, data: { success: true } });
      const bindCnResult = await page.evaluate(async () => await window.clawx.hostInvoke({
        id: 'runtime-channel-bind-real-bundle-feishu-cn',
        module: 'channels',
        action: 'bindingSave',
        payload: { channelType: 'feishu', accountId: 'cn_bot', agentId: 'ops' },
      }));
      expect(bindCnResult).toMatchObject({ ok: true, data: { success: true } });

      const saveGlobalResult = await page.evaluate(async () => await window.clawx.hostInvoke({
        id: 'runtime-channel-save-real-bundle-lark-global',
        module: 'channels',
        action: 'saveConfig',
        payload: {
          channelType: 'feishu',
          accountId: 'global_bot',
          config: {
            appId: 'cli_lark_global',
            appSecret: 'lark-secret-global',
            domain: 'global',
            allowFrom: '*',
            adminUsers: 'ou_lark_admin',
            shareSessionInChannel: false,
            enableFeishuCard: true,
          },
        },
      }));
      expect(saveGlobalResult).toMatchObject({ ok: true, data: { success: true } });
      const bindGlobalResult = await page.evaluate(async () => await window.clawx.hostInvoke({
        id: 'runtime-channel-bind-real-bundle-lark-global',
        module: 'channels',
        action: 'bindingSave',
        payload: { channelType: 'feishu', accountId: 'global_bot', agentId: 'main' },
      }));
      expect(bindGlobalResult).toMatchObject({ ok: true, data: { success: true } });

      const connectResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-connect-real-bundle-feishu-projection',
          module: 'gateway',
          action: 'rpc',
          payload: {
            method: 'channels.connect',
            params: { channelType: 'feishu' },
            timeoutMs: 60_000,
          },
        });
      });
      expect(connectResult).toMatchObject({ ok: true, data: { success: true } });

      const afterReloadStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-after-feishu-projection',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(afterReloadStatus).toMatchObject({
        ok: true,
        data: {
          runtimeKind: 'cc-connect',
          pid: beforeReloadStatus.data?.pid,
          port: beforeReloadStatus.data?.port,
        },
      });

      const managedConfigPath = join(userDataDir, 'runtimes', 'cc-connect', 'config.toml');
      const managedConfig = await readFile(managedConfigPath, 'utf8');
      expect(managedConfig).toContain('name = "clawx-ops"');
      expect(managedConfig).toContain('name = "clawx-main"');
      expect(managedConfig).toContain(`work_dir = "${opsWorkspace}"`);
      expect(managedConfig).toContain(`work_dir = "${mainWorkspace}"`);
      const mainProjectBlock = managedConfig.slice(
        managedConfig.indexOf('name = "clawx-main"'),
        managedConfig.indexOf('name = "clawx-ops"'),
      );
      const opsProjectBlock = managedConfig.slice(managedConfig.indexOf('name = "clawx-ops"'));
      expect(mainProjectBlock).toContain('model = "main-model-e2e"');
      expect(opsProjectBlock).toContain('model = "ops-model-e2e"');
      expect(managedConfig).toContain('type = "feishu"');
      expect(managedConfig).toContain('type = "lark"');
      expect(managedConfig).toContain('app_id = "cli_feishu_cn"');
      expect(managedConfig).toContain('app_id = "cli_lark_global"');
      expect(managedConfig).toContain('domain = "https://open.feishu.cn"');
      expect(managedConfig).toContain('domain = "https://open.larksuite.com"');
      expect(managedConfig).toContain('allow_from = "oc_main,ou_user"');
      expect(managedConfig).toContain('allow_from = "*"');
      expect(managedConfig).toContain('admin_from = "clawx-desktop,ou_cron_admin"');
      expect(managedConfig).toContain('admin_from = "clawx-desktop,ou_lark_admin"');
      expect(managedConfig).not.toContain('feishu-secret-cn');
      expect(managedConfig).not.toContain('lark-secret-global');
      expect(managedConfig).toContain('share_session_in_channel = true');
      expect(managedConfig).toContain('share_session_in_channel = false');
      expect(managedConfig).toContain('enable_feishu_card = false');
      expect(managedConfig).toContain('enable_feishu_card = true');
      expect(managedConfig).toContain('callback_path = "/feishu/callback"');
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());

      const canonicalConfig = await readFile(join(userDataDir, 'app', 'runtime-config.json'), 'utf8');
      expect(canonicalConfig).toContain('cli_feishu_cn');
      expect(canonicalConfig).toContain('cli_lark_global');
      expect(canonicalConfig).toContain('ou_cron_admin');
      expect(canonicalConfig).not.toContain('feishu-secret-cn');
      expect(canonicalConfig).not.toContain('lark-secret-global');
      const encryptedVault = await readFile(join(userDataDir, 'credentials', 'secrets.enc'));
      expect(encryptedVault.includes(Buffer.from('feishu-secret-cn', 'utf8'))).toBe(false);
      expect(encryptedVault.includes(Buffer.from('lark-secret-global', 'utf8'))).toBe(false);
      const credentialIndex = await readFile(join(userDataDir, 'credentials', 'index.json'), 'utf8');
      expect(credentialIndex).toContain('feishu:cn_bot');
      expect(credentialIndex).toContain('feishu:global_bot');
      expect(credentialIndex).not.toContain('feishu-secret-cn');
      expect(credentialIndex).not.toContain('lark-secret-global');
      await expect(access(join(homeDir, '.openclaw', 'openclaw.json'))).rejects.toThrow();

      const channelsAccounts = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-accounts-real-bundle-feishu-projection',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAccounts).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'feishu',
              defaultAccountId: 'cn_bot',
              accounts: expect.arrayContaining([
                expect.objectContaining({
                  accountId: 'cn_bot',
                  configured: true,
                  linked: true,
                  name: 'feishu',
                }),
                expect.objectContaining({
                  accountId: 'global_bot',
                  configured: true,
                  linked: true,
                  name: 'lark',
                }),
              ]),
            }),
          ]),
        },
      });

      const deleteConfigResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channel-delete-config-real-bundle-feishu-projection',
          module: 'channels',
          action: 'deleteConfig',
          payload: { channelType: 'feishu', accountId: 'cn_bot' },
        });
      });
      expect(deleteConfigResult).toMatchObject({ ok: true, data: { success: true } });

      await expect.poll(async () => {
        const refreshedConfig = await readFile(managedConfigPath, 'utf8');
        return {
          hasCnBot: refreshedConfig.includes('cli_feishu_cn') || refreshedConfig.includes('feishu-secret-cn'),
          hasGlobalBot: refreshedConfig.includes('cli_lark_global')
            && refreshedConfig.includes('CLAWX_CHANNEL_FEISHU_GLOBAL_BOT_APP_SECRET')
            && !refreshedConfig.includes('lark-secret-global'),
        };
      }, {
        timeout: 60_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual({ hasCnBot: false, hasGlobalBot: true });

      const channelsAfterDelete = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-channels-after-delete-real-bundle-feishu-projection',
          module: 'channels',
          action: 'accounts',
          payload: { probe: true },
        });
      });
      expect(channelsAfterDelete).toMatchObject({
        ok: true,
        data: {
          success: true,
          channels: expect.arrayContaining([
            expect.objectContaining({
              channelType: 'feishu',
              defaultAccountId: 'global_bot',
              accounts: [
                expect.objectContaining({
                  accountId: 'global_bot',
                  configured: true,
                  linked: true,
                  name: 'lark',
                }),
              ],
            }),
          ]),
        },
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('manages cron lifecycle through the real cc-connect Management API without model credentials', async ({
    launchElectronApp,
    homeDir,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);

    await seedCcConnectRuntimeSettings(userDataDir);
    const openClawConfigDir = join(homeDir, '.openclaw');
    const researchWorkspace = join(userDataDir, 'cron-research-workspace');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(researchWorkspace, { recursive: true });
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: join(userDataDir, 'cron-main-workspace') },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: join(userDataDir, 'cron-main-workspace') },
          { id: 'research', name: 'Research Agent', workspace: researchWorkspace },
        ],
      },
    }, null, 2), 'utf8');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle-cron-lifecycle',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({ ok: true, data: { success: true } });

      const createResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-real-bundle-lifecycle',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real bundle research cron',
            message: 'Local real bundle cron prompt',
            schedule: { kind: 'cron', expr: '0 11 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
            mute: true,
            agentId: 'research',
          },
        });
      });
      expect(createResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real bundle research cron',
          message: 'Local real bundle cron prompt',
          enabled: true,
          agentId: 'research',
          mute: true,
        }),
      });
      const cronId = (createResult as { data?: { id?: string } }).data?.id;
      expect(cronId).toBeTruthy();

      const listResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-real-bundle-lifecycle',
          module: 'cron',
          action: 'list',
        });
      });
      expect(listResult).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: cronId,
            agentId: 'research',
            message: 'Local real bundle cron prompt',
          }),
        ]),
      });

      const updateResult = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-update-real-bundle-lifecycle',
          module: 'cron',
          action: 'update',
          payload: {
            id,
            input: {
              name: 'Real bundle research cron updated',
              message: 'Updated real bundle cron prompt',
              schedule: { kind: 'cron', expr: '30 11 * * *' },
              delivery: { mode: 'announce' },
              enabled: true,
              mute: false,
              agentId: 'research',
            },
          },
        });
      }, cronId);
      expect(updateResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          id: cronId,
          name: 'Real bundle research cron updated',
          message: 'Updated real bundle cron prompt',
          enabled: true,
          agentId: 'research',
          delivery: { mode: 'announce' },
        }),
      });

      const toggleResult = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-toggle-real-bundle-lifecycle',
          module: 'cron',
          action: 'toggle',
          payload: { id, enabled: false },
        });
      }, cronId);
      expect(toggleResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          id: cronId,
          enabled: false,
          agentId: 'research',
        }),
      });

      const execMarkerPath = join(researchWorkspace, 'cc-connect-exec-cron-marker.txt');
      const execCreateResult = await page.evaluate(async (workDir) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-create-exec-real-bundle-lifecycle',
          module: 'cron',
          action: 'create',
          payload: {
            name: 'Real bundle research exec cron',
            exec: "node -e \"require('fs').writeFileSync('cc-connect-exec-cron-marker.txt', 'CLAWX_EXEC_CRON_OK')\"",
            workDir,
            sessionMode: 'new_per_run',
            timeoutMins: 3,
            schedule: { kind: 'cron', expr: '15 12 * * *' },
            enabled: true,
            delivery: { mode: 'none' },
            agentId: 'research',
          },
        });
      }, researchWorkspace);
      expect(execCreateResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          name: 'Real bundle research exec cron',
          enabled: true,
          agentId: 'research',
          exec: expect.stringContaining('cc-connect-exec-cron-marker.txt'),
          workDir: researchWorkspace,
          sessionMode: 'new_per_run',
          timeoutMins: 3,
        }),
      });
      const execCronId = (execCreateResult as { data?: { id?: string } }).data?.id;
      expect(execCronId).toBeTruthy();

      const execUpdateResult = await page.evaluate(async ({ id, workDir }) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-update-exec-real-bundle-lifecycle',
          module: 'cron',
          action: 'update',
          payload: {
            id,
            input: {
              exec: "node -e \"require('fs').writeFileSync('cc-connect-exec-cron-marker.txt', 'CLAWX_EXEC_CRON_UPDATED_OK')\"",
              workDir,
              sessionMode: 'continue',
              timeoutMins: 4,
              agentId: 'research',
            },
          },
        });
      }, { id: execCronId, workDir: researchWorkspace });
      expect(execUpdateResult, JSON.stringify(execUpdateResult)).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          id: execCronId,
          agentId: 'research',
          exec: expect.stringContaining('CLAWX_EXEC_CRON_UPDATED_OK'),
          workDir: researchWorkspace,
          sessionMode: 'continue',
          timeoutMins: 4,
        }),
      });

      const execListResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-exec-real-bundle-lifecycle',
          module: 'cron',
          action: 'list',
        });
      });
      expect(execListResult).toMatchObject({
        ok: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            id: execCronId,
            agentId: 'research',
            exec: expect.stringContaining('CLAWX_EXEC_CRON_UPDATED_OK'),
            workDir: researchWorkspace,
            sessionMode: 'continue',
            timeoutMins: 4,
          }),
        ]),
      });

      const execRunResult = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-run-exec-real-bundle-lifecycle',
          module: 'cron',
          action: 'trigger',
          payload: { id },
        });
      }, execCronId) as { ok?: boolean; data?: unknown; error?: string };
      expect(execRunResult).toMatchObject({ ok: true, data: { success: true } });
      await expect.poll(async () => (await readFile(execMarkerPath, 'utf8').catch(() => '')).trim(), {
        timeout: 30_000,
        intervals: [500, 1_000, 2_000],
      }).toBe('CLAWX_EXEC_CRON_UPDATED_OK');

      const execDeleteResult = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete-exec-real-bundle-lifecycle',
          module: 'cron',
          action: 'delete',
          payload: { id },
        });
      }, execCronId);
      expect(execDeleteResult).toMatchObject({ ok: true, data: { success: true } });

      const deleteResult = await page.evaluate(async (id) => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-delete-real-bundle-lifecycle',
          module: 'cron',
          action: 'delete',
          payload: { id },
        });
      }, cronId);
      expect(deleteResult).toMatchObject({ ok: true, data: { success: true } });

      const listAfterDelete = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-cron-list-after-delete-real-bundle-lifecycle',
          module: 'cron',
          action: 'list',
        });
      });
      const jobs = (listAfterDelete as { data?: Array<{ id?: string }> }).data ?? [];
      expect(jobs.some((job) => job.id === cronId)).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('runs cc-connect doctor against the managed config through the Host API', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');

    await seedCcConnectRuntimeSettings(userDataDir);
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const doctorResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-doctor-real-bundle',
          module: 'app',
          action: 'openClawDoctor',
          payload: { mode: 'diagnose' },
        });
      });
      expect(doctorResult).toMatchObject({
        ok: true,
        data: expect.objectContaining({
          mode: 'diagnose',
          command: expect.stringContaining('cc-connect doctor user-isolation --config'),
          cwd: expect.stringContaining(join('runtimes', 'cc-connect')),
          stdout: expect.any(String),
          stderr: expect.any(String),
        }),
      });
      expect((doctorResult as { data?: { error?: string; timedOut?: boolean } }).data?.timedOut).not.toBe(true);
      expect((doctorResult as { data?: { error?: string } }).data?.error || '').not.toContain('spawn');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('cleans up the bundled cc-connect process tree on app quit', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);
    await seedCcConnectRuntimeSettings(userDataDir);
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const startResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'runtime-start-real-bundle-quit-cleanup',
        module: 'gateway',
        action: 'start',
      });
    });
    expect(startResult).toMatchObject({
      ok: true,
      data: { success: true },
    });

    const statusResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'runtime-status-real-bundle-quit-cleanup',
        module: 'gateway',
        action: 'status',
      });
    }) as { ok: boolean; data?: { pid?: number; port?: number } };
    expect(statusResult).toMatchObject({ ok: true });
    expect(statusResult.data?.pid).toBeGreaterThan(0);

    await closeElectronApp(app);

    await expectRuntimeProcessCleanedUp({
      pid: statusResult.data?.pid,
      runtimeDir,
      managementPort: statusResult.data?.port,
      bridgePort: 9810,
    });
  });

  test('cleans up bundled cc-connect when rolling back to OpenClaw runtime', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    const bundles = await realRuntimeBundles();
    test.skip(!bundles, 'Run pnpm run bundle:cc-connect:current && pnpm run bundle:codex:current first.');
    await waitForPortClosed(9810);
    await waitForPortClosed(9820);
    await seedCcConnectRuntimeSettings(userDataDir);
    const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_CC_CONNECT_PATH: bundles!.ccConnectPath,
        CLAWX_CODEX_PATH: bundles!.codexPath,
      },
    });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const startResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-start-real-bundle-rollback-cleanup',
          module: 'gateway',
          action: 'start',
        });
      });
      expect(startResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const statusResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-real-bundle-rollback-cleanup',
          module: 'gateway',
          action: 'status',
        });
      }) as { ok: boolean; data?: { pid?: number; port?: number; runtimeKind?: string } };
      expect(statusResult).toMatchObject({
        ok: true,
        data: { runtimeKind: 'cc-connect' },
      });
      expect(statusResult.data?.pid).toBeGreaterThan(0);

      const switchResult = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-switch-openclaw-real-bundle-rollback-cleanup',
          module: 'settings',
          action: 'set',
          payload: {
            key: 'runtimeKind',
            value: 'openclaw',
          },
        });
      });
      expect(switchResult).toMatchObject({
        ok: true,
        data: { success: true },
      });

      const openClawStatus = await page.evaluate(async () => {
        return await window.clawx.hostInvoke({
          id: 'runtime-status-openclaw-after-rollback-cleanup',
          module: 'gateway',
          action: 'status',
        });
      });
      expect(openClawStatus).toMatchObject({
        ok: true,
        data: { runtimeKind: 'openclaw' },
      });

      await expectRuntimeProcessCleanedUp({
        pid: statusResult.data?.pid,
        runtimeDir,
        managementPort: statusResult.data?.port,
        bridgePort: 9810,
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
