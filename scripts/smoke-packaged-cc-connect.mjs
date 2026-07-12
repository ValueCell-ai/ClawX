#!/usr/bin/env node
import { _electron as electron, expect } from '@playwright/test';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  defaultPackagedAppPath,
  packagedExecutablePath,
  packagedResourcesPath,
  shouldVerifyPackagedCodeSignature,
} from './packaged-runtime-layout.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg === '--') continue;
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2];
    } else if (arg.startsWith('--')) {
      result[arg.slice(2)] = '1';
    }
  }
  return result;
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
  if (process.platform === 'win32') {
    const command = [
      '$needle = $env:CLAWX_SMOKE_PROCESS_NEEDLE;',
      'Get-CimInstance Win32_Process',
      '| Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) }',
      '| ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }',
    ].join(' ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      env: { ...process.env, CLAWX_SMOKE_PROCESS_NEEDLE: needle },
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }
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

async function seedCcConnectSettings(userDataDir, options = {}) {
  const createdAt = '2026-06-07T00:00:00.000Z';
  const providerAccounts = options.realOAuth
    ? {
        'openai-oauth': {
          id: 'openai-oauth',
          vendorId: 'openai',
          label: 'OpenAI Codex OAuth',
          authMode: 'oauth_browser',
          model: process.env.CLAWX_REAL_OPENAI_MODEL?.trim() || 'gpt-5.5',
          enabled: true,
          isDefault: true,
          metadata: { resourceUrl: 'openai-codex' },
          createdAt,
          updatedAt: createdAt,
        },
      }
    : {
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
      };
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({
    language: 'en',
    devModeUnlocked: true,
    runtimeKind: 'cc-connect',
    gatewayAutoStart: false,
  }, null, 2), 'utf8');
  await writeFile(join(userDataDir, 'clawx-providers.json'), JSON.stringify({
    schemaVersion: 0,
    providerAccounts,
    providerSecrets: {},
    apiKeys: {},
    defaultProviderAccountId: options.realOAuth ? 'openai-oauth' : 'ollama-local',
  }, null, 2), 'utf8');
}

async function copyLocalCodexAuthToManagedHome(userDataDir) {
  const source = process.env.CLAWX_REAL_CODEX_AUTH_JSON?.trim();
  if (!source) {
    throw new Error('Set CLAWX_REAL_CODEX_AUTH_JSON before running packaged real OAuth smoke.');
  }
  const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
  await mkdir(managedCodexHome, { recursive: true });
  await copyFile(source, join(managedCodexHome, 'auth.json'));
  return source;
}

async function verifyExecutable(path) {
  await access(path, fsConstants.X_OK);
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function readManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyCodeSignature(binaryPath, allowUnsigned) {
  if (!shouldVerifyPackagedCodeSignature(process.platform, allowUnsigned)) return;
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', binaryPath], { timeout: 30_000 });
}

async function verifyBundleManifest({
  manifestPath,
  binaryPath,
  sourceBinaryPath,
  expectedName,
  expectedBinaryName,
  allowUnsigned,
}) {
  const manifest = await readManifest(manifestPath);
  expect(manifest).toMatchObject({
    name: expectedName,
    nodePlatform: process.platform,
    nodeArch: process.arch,
    binaryName: expectedBinaryName,
    verifiedWithVersionCommand: true,
  });
  expect(typeof manifest.version).toBe('string');
  expect(manifest.version.length).toBeGreaterThan(0);
  expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
  if (sourceBinaryPath && await pathExists(sourceBinaryPath)) {
    expect(await sha256File(sourceBinaryPath)).toBe(manifest.sha256);
  }

  const { stdout } = await execFileAsync(binaryPath, ['--version'], { timeout: 30_000 });
  expect(stdout).toContain(manifest.version);
  await verifyCodeSignature(binaryPath, allowUnsigned);
  return manifest;
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
  const appPath = resolve(args.app || defaultPackagedAppPath({ rootDir: root }));
  const executablePath = packagedExecutablePath(appPath);
  const resourcesPath = packagedResourcesPath(appPath);
  const ccConnectPath = join(resourcesPath, 'cc-connect', binaryName('cc-connect'));
  const codexPath = join(resourcesPath, 'codex', 'bin', binaryName('codex'));
  const codexRipgrepPath = join(resourcesPath, 'codex', 'codex-path', binaryName('rg'));
  const platformArch = `${process.platform}-${process.arch}`;
  const sourceCcConnectPath = join(root, 'build', 'cc-connect', platformArch, binaryName('cc-connect'));
  const sourceCodexPath = join(root, 'build', 'codex', platformArch, 'bin', binaryName('codex'));
  const realOAuth = args['real-oauth'] === '1' || args['real-oauth'] === 'true';
  const allowUnsigned = args['allow-unsigned'] === '1' || args['allow-unsigned'] === 'true';

  await verifyExecutable(executablePath);
  await verifyExecutable(ccConnectPath);
  await verifyExecutable(codexPath);
  await verifyExecutable(codexRipgrepPath);
  const ccConnectManifest = await verifyBundleManifest({
    manifestPath: join(resourcesPath, 'cc-connect', 'manifest.json'),
    binaryPath: ccConnectPath,
    sourceBinaryPath: sourceCcConnectPath,
    expectedName: 'cc-connect',
    expectedBinaryName: binaryName('cc-connect'),
    allowUnsigned,
  });
  const codexManifest = await verifyBundleManifest({
    manifestPath: join(resourcesPath, 'codex', 'manifest.json'),
    binaryPath: codexPath,
    sourceBinaryPath: sourceCodexPath,
    expectedName: 'codex',
    expectedBinaryName: binaryName('codex'),
    allowUnsigned,
  });
  expect(ccConnectManifest.sourceUrl).toContain(ccConnectManifest.assetName);
  expect(codexManifest.packageSuffix).toContain(process.arch === 'arm64' ? 'arm64' : 'x64');

  const homeDir = await mkdtemp(join(tmpdir(), 'clawx-packaged-smoke-home-'));
  const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-packaged-smoke-user-data-'));
  const mainWorkspace = join(userDataDir, 'packaged-workspaces', 'main');
  const researchWorkspace = join(userDataDir, 'packaged-workspaces', 'research');
  const runtimeDir = join(userDataDir, 'runtimes', 'cc-connect');

  let pid;
  let managementPort;
  let bridgePort;
  let app;
  let smokeError;

  try {
    await mkdir(join(homeDir, '.config'), { recursive: true });
    await seedCcConnectSettings(userDataDir, { realOAuth });
    if (realOAuth) {
      await access(await copyLocalCodexAuthToManagedHome(userDataDir));
    }
    const openClawConfigDir = join(homeDir, '.openclaw');
    await mkdir(openClawConfigDir, { recursive: true });
    await mkdir(mainWorkspace, { recursive: true });
    await mkdir(researchWorkspace, { recursive: true });
    await writeFile(join(openClawConfigDir, 'openclaw.json'), JSON.stringify({
      agents: {
        defaults: { workspace: mainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: mainWorkspace },
          { id: 'research', name: 'Research Agent', workspace: researchWorkspace },
        ],
      },
    }, null, 2), 'utf8');
    const hostApiPort = await allocatePort();

    app = await electron.launch({
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
    const managedLauncherPath = join(
      runtimeDir,
      'config',
      'launchers',
      process.platform === 'win32' ? 'codex-openai-oauth.cmd' : 'codex-openai-oauth',
    );
    const expectedCodexCommand = realOAuth ? managedLauncherPath : codexPath;
    expect(managedConfig).toContain(`cmd = "${expectedCodexCommand.replace(/\\/g, '\\\\')}"`);
    expect(managedConfig).toContain(`work_dir = "${mainWorkspace}"`);
    expect(managedConfig).toContain('name = "clawx-research"');
    expect(managedConfig).toContain(`work_dir = "${researchWorkspace}"`);
    const bridgeMatch = managedConfig.match(/\[bridge\][\s\S]*?port = (\d+)/);
    bridgePort = bridgeMatch ? Number(bridgeMatch[1]) : undefined;

    if (realOAuth) {
      expect(managedConfig).not.toContain('access_token');
      expect(managedConfig).not.toContain('refresh_token');
      expect(managedConfig).not.toContain('id_token');
      await access(join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home', 'auth.json'));
      await access(managedLauncherPath, fsConstants.X_OK);
      const managedLauncher = await readFile(managedLauncherPath, 'utf8');
      const managedCodexHome = join(userDataDir, 'credentials', 'oauth', 'openai-oauth', 'codex-home');
      if (process.platform === 'win32') {
        expect(managedLauncher).toContain(`set "CODEX_HOME=${managedCodexHome}"`);
        expect(managedLauncher).toContain(`"${codexPath}" %*`);
      } else {
        expect(managedLauncher).toContain(`export CODEX_HOME='${managedCodexHome}'`);
        expect(managedLauncher).toContain(`exec '${codexPath}' "$@"`);
      }
      const publicProfile = await readFile(join(runtimeDir, 'provider-profile.json'), 'utf8');
      expect(publicProfile).toContain('"authMode": "oauth_browser"');
      expect(publicProfile).toContain('"CODEX_HOME"');
      expect(publicProfile).not.toContain('access_token');
      expect(publicProfile).not.toContain('refresh_token');
      expect(publicProfile).not.toContain('id_token');
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId('chat-composer-input').fill('Reply exactly: CLAWX_PACKAGED_REAL_OAUTH_OK');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText('CLAWX_PACKAGED_REAL_OAUTH_OK')).toBeVisible({ timeout: 180_000 });
    }

    const createCron = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-cron-create',
        module: 'cron',
        action: 'create',
        payload: {
          name: 'Packaged cc-connect research cron',
          message: 'Packaged cron prompt',
          schedule: { kind: 'cron', expr: '0 12 * * *' },
          enabled: true,
          delivery: { mode: 'none' },
          agentId: 'research',
        },
      });
    });
    expect(createCron).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        name: 'Packaged cc-connect research cron',
        message: 'Packaged cron prompt',
        enabled: true,
        agentId: 'research',
      }),
    });
    const cronId = createCron.data?.id;
    expect(cronId).toBeTruthy();

    const updateCron = await page.evaluate(async (id) => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-cron-update',
        module: 'cron',
        action: 'update',
        payload: {
          id,
          input: {
            name: 'Packaged cc-connect research cron updated',
            message: 'Updated packaged cron prompt',
            schedule: { kind: 'cron', expr: '30 12 * * *' },
            enabled: true,
            delivery: { mode: 'announce' },
            agentId: 'research',
          },
        },
      });
    }, cronId);
    expect(updateCron).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        id: cronId,
        name: 'Packaged cc-connect research cron updated',
        message: 'Updated packaged cron prompt',
        delivery: { mode: 'announce' },
        agentId: 'research',
      }),
    });

    const toggleCron = await page.evaluate(async (id) => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-cron-toggle',
        module: 'cron',
        action: 'toggle',
        payload: { id, enabled: false },
      });
    }, cronId);
    expect(toggleCron).toMatchObject({
      ok: true,
      data: expect.objectContaining({
        id: cronId,
        enabled: false,
        agentId: 'research',
      }),
    });

    const listCron = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-cron-list',
        module: 'cron',
        action: 'list',
      });
    });
    expect(listCron).toMatchObject({
      ok: true,
      data: expect.arrayContaining([
        expect.objectContaining({ id: cronId, agentId: 'research' }),
      ]),
    });

    const deleteCron = await page.evaluate(async (id) => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-cron-delete',
        module: 'cron',
        action: 'delete',
        payload: { id },
      });
    }, cronId);
    expect(deleteCron).toMatchObject({ ok: true, data: { success: true } });

    const doctorResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-doctor',
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
      }),
    });
    expect(doctorResult.data?.timedOut).not.toBe(true);
    expect(doctorResult.data?.error || '').not.toContain('spawn');

    const switchResult = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-cc-connect-switch-openclaw',
        module: 'settings',
        action: 'set',
        payload: {
          key: 'runtimeKind',
          value: 'openclaw',
        },
      });
    });
    expect(switchResult).toMatchObject({ ok: true, data: { success: true } });

    const openClawStatus = await page.evaluate(async () => {
      return await window.clawx.hostInvoke({
        id: 'packaged-openclaw-status-after-rollback',
        module: 'gateway',
        action: 'status',
      });
    });
    expect(openClawStatus).toMatchObject({
      ok: true,
      data: { runtimeKind: 'openclaw' },
    });

    await waitForCleanup({
      pid,
      runtimeDir,
      ports: [managementPort, bridgePort],
    });
  } catch (error) {
    smokeError = error;
  } finally {
    if (app) await closeElectronApp(app);
    try {
      await waitForCleanup({
        pid,
        runtimeDir,
        ports: [managementPort, bridgePort],
      });
    } catch (error) {
      if (!smokeError) {
        smokeError = error;
      } else {
        console.warn(`[packaged-smoke] cleanup check failed after primary error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await rm(userDataDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  }
  if (smokeError) throw smokeError;
  const evidencePath = resolve(args.report || join(
    root,
    'artifacts',
    'cc-connect',
    `packaged-smoke-${process.platform}-${process.arch}.json`,
  ));
  const evidence = {
    schema: 'clawx-packaged-runtime-smoke',
    version: 1,
    generatedAt: new Date().toISOString(),
    target: `${process.platform}-${process.arch}`,
    application: basename(appPath),
    ccConnectVersion: ccConnectManifest.version,
    codexVersion: codexManifest.version,
    realOAuth,
    codeSignature: process.platform === 'darwin'
      ? allowUnsigned ? 'explicitly-skipped-unsigned-smoke' : 'verified'
      : 'not-applicable',
    checks: [
      'runtime-binary-version',
      ...(shouldVerifyPackagedCodeSignature(process.platform, allowUnsigned) ? ['code-signature'] : []),
      'packaged-electron-start',
      'runtime-start-status',
      'workspace-projection',
      'cron-crud',
      'doctor',
      'openclaw-rollback',
      'pid-port-process-cleanup',
    ],
    status: 'pass',
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Packaged cc-connect smoke passed for ${evidence.target}; evidence: ${evidencePath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
