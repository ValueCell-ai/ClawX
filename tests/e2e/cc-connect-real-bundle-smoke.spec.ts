import { access, readFile, writeFile } from 'node:fs/promises';
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

test.describe('cc-connect real runtime bundle smoke', () => {
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

      const managedConfig = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      expect(managedConfig).toContain('Managed by ClawX');
      expect(managedConfig).toContain('BridgePlatform');
      expect(managedConfig).toContain(`work_dir = "${join(userDataDir, 'runtimes', 'cc-connect', 'workspaces', 'main')}"`);
      const workDirLines = managedConfig.split('\n').filter((line) => line.startsWith('work_dir =')).join('\n');
      expect(workDirLines).not.toContain(process.cwd());
      const publicProfile = await readFile(join(userDataDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('"vendorId": "ollama"');
      expect(publicProfile).toContain('qwen3:latest');
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
