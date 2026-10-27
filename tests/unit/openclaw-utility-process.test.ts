// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFork, userDataDir } = vi.hoisted(() => ({
  mockFork: vi.fn(),
  userDataDir: { current: '' },
}));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current },
  utilityProcess: { fork: mockFork },
}));

const ENTRY_SOURCE = `
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const probe = ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "unset")'];
const spawnResult = await new Promise((resolve) => {
  let out = '';
  const child = spawn(process.execPath, probe, { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.on('close', () => resolve(out));
});
const callbackResult = await new Promise((resolve) => {
  execFile(process.execPath, probe, (error, stdout) => resolve(error ? 'error' : stdout));
});
const { stdout: promisified } = await promisify(execFile)(process.execPath, probe);

process.stdout.write(JSON.stringify({
  argv1: process.argv[1],
  entryEnv: process.env.CLAWX_OPENCLAW_ENTRY ?? null,
  spawn: spawnResult,
  spawnSync: spawnSync(process.execPath, probe, { encoding: 'utf8' }).stdout,
  spawnSyncOptionsOnly: spawnSync(process.execPath, { encoding: 'utf8' }).status,
  execFileCallback: callbackResult,
  execFilePromisified: promisified,
  execFileSync: execFileSync(process.execPath, probe, { encoding: 'utf8' }),
  otherCommand: execFileSync('node', probe, { encoding: 'utf8' }),
  parentEnv: process.env.ELECTRON_RUN_AS_NODE ?? 'unset',
}));
`;

// Mirrors Electron 41's utility-process fork() rewrite, which only marks
// string module paths to run as Node.
const ELECTRON_FORK_PRELOAD_SOURCE = `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const fork = childProcess.fork;
childProcess.fork = (modulePath, args, options) => {
  if (typeof modulePath === 'string') {
    options = { ...options, env: { ...(options?.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' } };
  }
  return fork(modulePath, args, options);
};
syncBuiltinESMExports();
`;

const FORK_ENTRY_SOURCE = `
import { fork } from 'node:child_process';

const forkChild = (modulePath) => new Promise((resolve) => {
  const child = fork(modulePath, [], {
    execArgv: [],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let message = 'no-message';
  child.on('message', (value) => { message = value; });
  child.on('close', () => resolve(message));
});

const childUrl = new URL('./fork-child.mjs', import.meta.url);
process.stdout.write(JSON.stringify({
  url: await forkChild(childUrl),
  path: await forkChild(childUrl.pathname),
}));
`;

function envWithoutRunAsNode(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

describe('OpenClaw utility-process bootstrap', () => {
  let workDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockFork.mockReset();
    workDir = mkdtempSync(join(tmpdir(), 'clawx-utility-bootstrap-'));
    userDataDir.current = workDir;
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('marks only re-execs of the runtime binary as Node and then runs the entry', async () => {
    const { ensureOpenClawUtilityBootstrap } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);
    const entryPath = join(workDir, 'entry.mjs');
    writeFileSync(entryPath, ENTRY_SOURCE, 'utf8');

    const result = spawnSync(process.execPath, [bootstrapPath], {
      encoding: 'utf8',
      env: envWithoutRunAsNode({ CLAWX_OPENCLAW_ENTRY: entryPath }),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      argv1: entryPath,
      entryEnv: null,
      spawn: '1',
      spawnSync: '1',
      spawnSyncOptionsOnly: 0,
      execFileCallback: '1',
      execFilePromisified: '1',
      execFileSync: '1',
      otherCommand: 'unset',
      parentEnv: 'unset',
    });
  }, 30_000);

  it('hands Electron fork() a path when OpenClaw forks a worker from a file URL', async () => {
    const { ensureOpenClawUtilityBootstrap } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);
    const preloadPath = join(workDir, 'electron-fork-preload.mjs');
    const entryPath = join(workDir, 'fork-entry.mjs');
    writeFileSync(preloadPath, ELECTRON_FORK_PRELOAD_SOURCE, 'utf8');
    writeFileSync(entryPath, FORK_ENTRY_SOURCE, 'utf8');
    writeFileSync(
      join(workDir, 'fork-child.mjs'),
      'process.send(process.env.ELECTRON_RUN_AS_NODE ?? "unset", () => process.disconnect());',
      'utf8',
    );

    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preloadPath).href, bootstrapPath], {
      encoding: 'utf8',
      env: envWithoutRunAsNode({ CLAWX_OPENCLAW_ENTRY: entryPath }),
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ url: '1', path: '1' });
  }, 30_000);

  it('keeps broker grandchildren in Node mode with captured environments and IPC', async () => {
    const { ensureOpenClawUtilityBootstrap } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);
    const entryPath = join(workDir, 'broker-entry.mjs');
    writeFileSync(join(workDir, 'broker-child.mjs'), `
      import { spawnSync } from 'node:child_process';
      process.send({
        mode: process.env.ELECTRON_RUN_AS_NODE,
        entry: process.env.CLAWX_OPENCLAW_ENTRY ?? null,
        nested: spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "unset")'], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, encoding: 'utf8', timeout: 5000,
        }).stdout,
      }, () => process.disconnect());
    `);
    writeFileSync(join(workDir, 'broker.mjs'), `
      import { spawn, fork, execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      import { fileURLToPath } from 'node:url';
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: undefined };
      const childEntry = new URL('./broker-child.mjs', import.meta.url);
      const message = (child) => new Promise((resolve, reject) => {
        let result;
        child.on('message', value => { result = value; });
        child.on('error', reject);
        child.on('exit', code => code === 0 && result ? resolve(result) : reject(new Error('child exit=' + code)));
      });
      const args = ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "unset")'];
      console.log(JSON.stringify({
        spawn: await message(spawn(process.execPath, [fileURLToPath(childEntry)], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })),
        fork: await message(fork(childEntry, { env, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })),
        promisified: (await promisify(execFile)(process.execPath, args, { env })).stdout,
        capturedEnvUnchanged: env.ELECTRON_RUN_AS_NODE === undefined,
      }));
    `);
    writeFileSync(entryPath, `
      import { spawnSync } from 'node:child_process';
      import { fileURLToPath } from 'node:url';
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./broker.mjs', import.meta.url))], {
        env: { ...process.env }, encoding: 'utf8', timeout: 15000,
      });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exit(result.status ?? 1);
    `);
    const result = spawnSync(process.execPath, [bootstrapPath], {
      encoding: 'utf8', timeout: 20000,
      env: envWithoutRunAsNode({ CLAWX_OPENCLAW_ENTRY: entryPath }),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      spawn: { mode: '1', entry: null, nested: '1' },
      fork: { mode: '1', entry: null, nested: '1' },
      promisified: '1',
      capturedEnvUnchanged: true,
    });
  }, 30000);

  it('preloads nested Worker threads even with explicit empty execArgv', async () => {
    const { ensureOpenClawUtilityBootstrap } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);
    const entryPath = join(workDir, 'worker-entry.mjs');
    writeFileSync(join(workDir, 'nested-worker.mjs'), `
      import { parentPort } from 'node:worker_threads';
      import { spawnSync } from 'node:child_process';
      const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "unset")'], {
        encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 5000,
      });
      parentPort.postMessage({ output: result.stdout, parentMode: process.env.ELECTRON_RUN_AS_NODE ?? null });
    `);
    writeFileSync(join(workDir, 'worker.mjs'), `
      import { Worker, parentPort } from 'node:worker_threads';
      new Worker(new URL('./nested-worker.mjs', import.meta.url), { execArgv: [] })
        .on('message', value => parentPort.postMessage(value));
    `);
    writeFileSync(entryPath, `
      import { Worker, SHARE_ENV } from 'node:worker_threads';
      const results = [];
      for (const env of [{ ...process.env }, SHARE_ENV]) {
        const worker = new Worker(new URL('./worker.mjs', import.meta.url), { execArgv: [], env });
        results.push(await new Promise((resolve, reject) => {
          worker.on('message', resolve); worker.on('error', reject);
        }));
      }
      console.log(JSON.stringify({ results, parentMode: process.env.ELECTRON_RUN_AS_NODE ?? null }));
    `);
    const result = spawnSync(process.execPath, [bootstrapPath], {
      encoding: 'utf8', timeout: 20000,
      env: envWithoutRunAsNode({ CLAWX_OPENCLAW_ENTRY: entryPath }),
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      results: [{ output: '1', parentMode: null }, { output: '1', parentMode: null }],
      parentMode: null,
    });
  }, 30000);

  it('refuses to start without an entry script', async () => {
    const { ensureOpenClawUtilityBootstrap } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);

    const result = spawnSync(process.execPath, [bootstrapPath], {
      encoding: 'utf8',
      env: envWithoutRunAsNode({}),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CLAWX_OPENCLAW_ENTRY is required');
  });

  it('rewrites the bootstrap only when its content changed', async () => {
    const {
      ensureOpenClawUtilityBootstrap,
      OPENCLAW_UTILITY_BOOTSTRAP_SOURCE,
      OPENCLAW_RUNTIME_COMPAT_FILE,
      OPENCLAW_RUNTIME_COMPAT_SOURCE,
    } = await import('@electron/utils/openclaw-utility-process');
    const bootstrapPath = ensureOpenClawUtilityBootstrap(workDir);
    const firstWrite = statSync(bootstrapPath).mtimeMs;

    expect(ensureOpenClawUtilityBootstrap(workDir)).toBe(bootstrapPath);
    expect(statSync(bootstrapPath).mtimeMs).toBe(firstWrite);

    writeFileSync(bootstrapPath, 'stale', 'utf8');
    ensureOpenClawUtilityBootstrap(workDir);
    expect(readFileSync(bootstrapPath, 'utf8')).toBe(OPENCLAW_UTILITY_BOOTSTRAP_SOURCE);
    const compatPath = join(workDir, OPENCLAW_RUNTIME_COMPAT_FILE);
    expect(readFileSync(compatPath, 'utf8')).toBe(OPENCLAW_RUNTIME_COMPAT_SOURCE);
    const compatWrite = statSync(compatPath).mtimeMs;
    ensureOpenClawUtilityBootstrap(workDir);
    expect(statSync(compatPath).mtimeMs).toBe(compatWrite);
    rmSync(compatPath);
    ensureOpenClawUtilityBootstrap(workDir);
    expect(readFileSync(compatPath, 'utf8')).toBe(OPENCLAW_RUNTIME_COMPAT_SOURCE);
  });

  it('forks the bootstrap with the OpenClaw entry passed through the environment', async () => {
    const child = { pid: 42 };
    mockFork.mockReturnValue(child);
    const { forkOpenClawUtilityProcess } = await import('@electron/utils/openclaw-utility-process');

    const result = forkOpenClawUtilityProcess('/opt/openclaw/openclaw.mjs', ['gateway'], {
      cwd: '/opt/openclaw',
      stdio: 'pipe',
      env: { PATH: '/usr/bin', OPENCLAW_NO_RESPAWN: '1' },
      serviceName: 'OpenClaw Gateway',
    });

    expect(result).toBe(child);
    expect(mockFork).toHaveBeenCalledWith(
      join(workDir, 'openclaw-utility-bootstrap.mjs'),
      ['gateway'],
      {
        cwd: '/opt/openclaw',
        stdio: 'pipe',
        env: {
          PATH: '/usr/bin',
          OPENCLAW_NO_RESPAWN: '1',
          CLAWX_OPENCLAW_ENTRY: '/opt/openclaw/openclaw.mjs',
        },
        serviceName: 'OpenClaw Gateway',
      },
    );
  });
});
