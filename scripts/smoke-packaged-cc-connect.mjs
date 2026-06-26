#!/usr/bin/env node
import { _electron as electron, expect } from '@playwright/test';
import { constants as fsConstants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function defaultAppPath() {
  if (process.platform !== 'darwin') {
    throw new Error('Packaged cc-connect smoke currently supports macOS .app bundles only.');
  }
  return join(root, 'release', `mac-${process.arch}`, 'ClawX.app');
}

function packagedExecutablePath(appPath) {
  if (process.platform === 'darwin') {
    return join(appPath, 'Contents', 'MacOS', 'ClawX');
  }
  throw new Error(`Unsupported packaged smoke platform: ${process.platform}`);
}

function packagedResourcesPath(appPath) {
  if (process.platform === 'darwin') return join(appPath, 'Contents', 'Resources');
  throw new Error(`Unsupported packaged smoke platform: ${process.platform}`);
}

function binaryName(base) {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

async function allocatePort() {
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
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

async function isPortOpen(port) {
  return await new Promise((resolveOpen) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolveOpen(true);
    });
    socket.once('error', () => resolveOpen(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolveOpen(false);
    });
  });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listProcessCommandsContaining(needle) {
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

async function waitForStableWindow(app) {
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
        if (!String(error).includes('has been closed')) throw error;
      }
    }
    try {
      page = await app.waitForEvent('window', { timeout: 2_000 });
    } catch {
      // Keep polling.
    }
  }

  throw new Error('No stable packaged Electron window became available');
}

async function closeElectronApp(app, timeoutMs = 5_000) {
  let closed = false;
  await Promise.race([
    (async () => {
      const [closeResult] = await Promise.allSettled([
        app.waitForEvent('close', { timeout: timeoutMs }),
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
      ]);
      if (closeResult.status === 'fulfilled') closed = true;
    })(),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  if (closed) return;
  try {
    await app.close();
    return;
  } catch {
    // Fall through.
  }
  try {
    app.process().kill('SIGKILL');
  } catch {
    // ignore
  }
}

async function seedCcConnectSettings(userDataDir) {
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

async function verifyExecutable(path) {
  await access(path, fsConstants.X_OK);
}

async function waitForCleanup({ pid, runtimeDir, ports }) {
  if (typeof pid === 'number') {
    await expect.poll(() => isPidAlive(pid), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
      message: `packaged cc-connect pid ${pid} should exit`,
    }).toBe(false);
  }

  for (const port of ports.filter((value) => typeof value === 'number')) {
    await expect.poll(async () => await isPortOpen(port), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
      message: `packaged cc-connect port ${port} should close`,
    }).toBe(false);
  }

  await expect.poll(async () => await listProcessCommandsContaining(runtimeDir), {
    timeout: 15_000,
    intervals: [250, 500, 1_000],
    message: `no packaged runtime process should reference ${runtimeDir}`,
  }).toEqual([]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appPath = resolve(args.app || defaultAppPath());
  const executablePath = packagedExecutablePath(appPath);
  const resourcesPath = packagedResourcesPath(appPath);
  const ccConnectPath = join(resourcesPath, 'cc-connect', binaryName('cc-connect'));
  const codexPath = join(resourcesPath, 'codex', 'bin', binaryName('codex'));

  await verifyExecutable(executablePath);
  await verifyExecutable(ccConnectPath);
  await verifyExecutable(codexPath);

  const homeDir = await mkdtemp(join(tmpdir(), 'clawx-packaged-smoke-home-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-packaged-smoke-user-data-'));
  await mkdir(join(homeDir, '.config'), { recursive: true });
  await seedCcConnectSettings(userDataDir);
  const hostApiPort = await allocatePort();
  const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');

  const app = await electron.launch({
    executablePath,
    args: ['--lang=en-US'],
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en',
      CLAWX_E2E: '1',
      CLAWX_E2E_SKIP_SETUP: '1',
      CLAWX_USER_DATA_DIR: userDataDir,
      CLAWX_PORT_CLAWX_HOST_API: String(hostApiPort),
    },
    timeout: 90_000,
  });

  let pid;
  let managementPort;
  let bridgePort = 9810;

  try {
    const page = await waitForStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.clawx?.hostInvoke), null, { timeout: 30_000 });

    const startResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-start',
        module: 'gateway',
        action: 'start',
      });
    });
    expect(startResult).toMatchObject({ ok: true, data: { success: true } });

    const statusResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-status',
        module: 'gateway',
        action: 'status',
      });
    });
    expect(statusResult).toMatchObject({
      ok: true,
      data: { runtimeKind: 'cc-connect' },
    });
    pid = statusResult.data?.pid;
    managementPort = statusResult.data?.port;
    expect(pid).toBeGreaterThan(0);
    expect(managementPort).toBeGreaterThan(0);

    const managedConfig = await readFile(join(runtimeDir, 'config.toml'), 'utf8');
    expect(managedConfig).toContain(`cmd = "${codexPath.replace(/\\/g, '\\\\')}"`);
    expect(managedConfig).toContain(`work_dir = "${join(runtimeDir, 'workspaces', 'main')}"`);
    const bridgeMatch = managedConfig.match(/\[bridge\][\s\S]*?port = (\d+)/);
    bridgePort = bridgeMatch ? Number(bridgeMatch[1]) : bridgePort;
  } finally {
    await closeElectronApp(app);
  }

  await waitForCleanup({
    pid,
    runtimeDir,
    ports: [managementPort, bridgePort],
  });

  await rm(userDataDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
  console.log(`Packaged cc-connect smoke passed for ${basename(appPath)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
