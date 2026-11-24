import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;
const originalExecPath = process.execPath;
const originalComSpec = process.env.ComSpec;
const originalPath = process.env.PATH;
const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
const mockedEntryPath = 'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs';

const {
  mockExistsSync,
  mockIsPackagedGetter,
  mockSpawn,
  mockUtilityFork,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
  mockSpawn: vi.fn(),
  mockUtilityFork: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mockSpawn, default: { ...actual, spawn: mockSpawn } };
});

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getName: () => 'ClawX',
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => mockedEntryPath,
}));

vi.mock('@electron/utils/openclaw-utility-process', () => ({
  ensureOpenClawRuntimeCompat: () => '/tmp/clawx-user-data/openclaw-runtime-compat.mjs',
  forkOpenClawUtilityProcess: mockUtilityFork,
}));

vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

function setResourcesPath(resourcesPath: string | undefined) {
  Object.defineProperty(process, 'resourcesPath', {
    value: resourcesPath,
    configurable: true,
    writable: true,
  });
}

function setExecPath(execPath: string) {
  Object.defineProperty(process, 'execPath', {
    value: execPath,
    configurable: true,
    writable: true,
  });
}

function resetOpenClawCliMocks() {
  vi.resetModules();
  mockExistsSync.mockReset();
  mockIsPackagedGetter.value = false;
  setPlatform(originalPlatform);
  setResourcesPath(originalResourcesPath);
  setExecPath(originalExecPath);
  if (originalComSpec === undefined) {
    delete process.env.ComSpec;
  } else {
    process.env.ComSpec = originalComSpec;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalElectronRunAsNode === undefined) {
    delete process.env.ELECTRON_RUN_AS_NODE;
  } else {
    process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
  }
}

describe('getOpenClawCliCommand (Windows packaged)', () => {
  beforeEach(() => {
    resetOpenClawCliMocks();
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:\\Program Files\\ClawX\\resources');
  });

  afterEach(() => {
    resetOpenClawCliMocks();
  });

  it('prefers bundled node.exe when present', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]cli[\\/]openclaw\.cmd$/i.test(p) || /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    expect(getOpenClawCliCommand()).toBe(
      `& '${join(process.resourcesPath, 'cli', 'openclaw.cmd')}'`,
    );
  });

  it('falls back to bundled node.exe when openclaw.cmd is missing', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    expect(getOpenClawCliCommand()).toBe(
      `& '${join(process.resourcesPath, 'bin', 'node.exe')}' '${mockedEntryPath}'`,
    );
  });

  it('falls back to ELECTRON_RUN_AS_NODE command when wrappers are missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = getOpenClawCliCommand();
    expect(command.startsWith('$env:ELECTRON_RUN_AS_NODE=1; & ')).toBe(true);
    expect(command.endsWith("'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs'")).toBe(true);
  });
});

describe('getOpenClawCliSpawnSpec', () => {
  beforeEach(() => {
    resetOpenClawCliMocks();
  });

  afterEach(() => {
    resetOpenClawCliMocks();
  });

  it('returns the dev wrapper path as an unquoted spawn command', async () => {
    setPlatform('darwin');
    const wrapper = join('/tmp', '.bin', 'openclaw');
    mockExistsSync.mockImplementation((p: string) => p === wrapper);

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec).toEqual({ command: wrapper, args: [], shell: false });
    expect(spec.command).not.toMatch(/^& |^['"]/);
  });

  it('uses cmd.exe for a Windows dev cmd wrapper', async () => {
    const comSpecPath = 'C:\\Windows\\System32\\cmd.exe';
    setPlatform('win32');
    process.env.ComSpec = comSpecPath;
    const wrapper = join('/tmp', '.bin', 'openclaw.cmd');
    mockExistsSync.mockImplementation((p: string) => p === wrapper);

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(comSpecPath);
    expect(spec.args).toEqual(['/d', '/s', '/c', `"${wrapper}"`]);
    expect(spec.shell).not.toBe(true);
  });

  it('returns the packaged POSIX wrapper path as the spawn command', async () => {
    setPlatform('linux');
    mockIsPackagedGetter.value = true;
    setResourcesPath('/opt/ClawX/resources');
    const wrapper = join(process.resourcesPath, 'cli', 'openclaw');
    mockExistsSync.mockImplementation((p: string) => p === wrapper);

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec).toEqual({ command: wrapper, args: [], shell: false });
  });

  it('uses cmd.exe for a packaged Windows cmd wrapper', async () => {
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:\\Program Files\\ClawX\\resources');
    mockExistsSync.mockImplementation((p: string) => /[\\/]cli[\\/]openclaw\.cmd$/i.test(p));

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(process.env.ComSpec || 'cmd.exe');
    expect(spec.args).toEqual(['/d', '/s', '/c', `"${join(process.resourcesPath, 'cli', 'openclaw.cmd')}"`]);
    expect(spec.shell).not.toBe(true);
  });

  it('uses ELECTRON_RUN_AS_NODE with process.execPath when packaged wrappers are missing', async () => {
    const execPath = '/Applications/ClawX.app/Contents/MacOS/ClawX';
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    setResourcesPath('/Applications/ClawX.app/Contents/Resources');
    setExecPath(execPath);
    mockExistsSync.mockReturnValue(false);

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(execPath);
    expect(spec.args).toEqual([mockedEntryPath]);
    expect(spec.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('uses bundled node.exe on packaged Windows when the cmd wrapper is missing', async () => {
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:\\Program Files\\ClawX\\resources');
    mockExistsSync.mockImplementation((p: string) => /[\\/]bin[\\/]node\.exe$/i.test(p));

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(join(process.resourcesPath, 'bin', 'node.exe'));
    expect(spec.args).toEqual([mockedEntryPath]);
    expect(spec.shell).toBeUndefined();
    expect(spec.env).toBeUndefined();
  });
});

describe('OpenClaw command process', () => {
  const consentArgs = ['plugins', 'enable', 'dingtalk', 'wecom', '--accept-capabilities'];
  const options = {
    cwd: '/test/openclaw',
    env: { OPENCLAW_STATE_DIR: 'fixture', HTTPS_PROXY: '', ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe' as const,
  };
  beforeEach(() => {
    resetOpenClawCliMocks();
    mockSpawn.mockClear();
    mockUtilityFork.mockClear();
  });
  afterEach(resetOpenClawCliMocks);

  it('uses bundled Node for Windows repair with the same isolated state and runtime preload', async () => {
    setPlatform('win32');
    setResourcesPath('C:/ClawX/resources');
    mockIsPackagedGetter.value = true;
    const node = join(process.resourcesPath, 'bin', 'node.exe');
    mockExistsSync.mockImplementation(file => file === node);
    const { launchOpenClawCommandProcess } = await import('@electron/utils/openclaw-cli');
    const args = ['doctor', '--fix', '--yes', '--non-interactive'];
    launchOpenClawCommandProcess(mockedEntryPath, args, options);
    expect(mockSpawn).toHaveBeenCalledWith(node, [
      '--import', pathToFileURL('/tmp/clawx-user-data/openclaw-runtime-compat.mjs').href, mockedEntryPath, ...args,
    ], {
      cwd: options.cwd,
      env: expect.objectContaining({ OPENCLAW_STATE_DIR: 'fixture', HTTPS_PROXY: '', OPENCLAW_NO_RESPAWN: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    expect(mockSpawn.mock.calls[0][2].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(mockUtilityFork).not.toHaveBeenCalled();
  });

  it.each([
    ['linux', ['doctor', '--fix']],
    ['darwin', ['doctor', '--fix']],
    ['win32', ['doctor', '--json']],
    ['win32', ['config', 'validate']],
  ] as const)('keeps the utility process for %s %j', async (platform, command) => {
    setPlatform(platform);
    const { launchOpenClawCommandProcess } = await import('@electron/utils/openclaw-cli');
    launchOpenClawCommandProcess(mockedEntryPath, [...command], options);
    expect(mockUtilityFork).toHaveBeenCalledWith(mockedEntryPath, command, options);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('uses bundled Node for opted-in Windows consent and forwards a failed command without replaying it', async () => {
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:/ClawX/resources');
    const node = join(process.resourcesPath, 'bin', 'node.exe');
    mockExistsSync.mockImplementation(file => file === node);
    const native = Object.assign(new EventEmitter(), { pid: 123 });
    mockSpawn.mockReturnValueOnce(native);
    const { launchOpenClawCommandProcess } = await import('@electron/utils/openclaw-cli');
    const child = launchOpenClawCommandProcess(mockedEntryPath, consentArgs, { ...options, preferPackagedWindowsNode: true });
    expect(mockSpawn).toHaveBeenCalledWith(node, [
      '--import', pathToFileURL('/tmp/clawx-user-data/openclaw-runtime-compat.mjs').href, mockedEntryPath, ...consentArgs,
    ], {
      cwd: options.cwd,
      env: expect.objectContaining({ OPENCLAW_STATE_DIR: 'fixture', HTTPS_PROXY: '', OPENCLAW_NO_RESPAWN: '1', OPENCLAW_DEBUG: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    expect(mockSpawn.mock.calls[0][2].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    const onExit = vi.fn();
    child.on('exit', onExit);
    native.emit('exit', 1);
    expect(onExit).toHaveBeenCalledWith(1);
    expect(mockUtilityFork).not.toHaveBeenCalled();
  });

  it.each([
    ['win32', true, true, false],
    ['win32', true, false, true],
    ['win32', false, true, true],
    ['darwin', true, true, true],
    ['linux', true, true, true],
  ] as const)('uses the utility for %s packaged=%s bundled=%s optedIn=%s', async (platform, packaged, bundled, optedIn) => {
    setPlatform(platform);
    mockIsPackagedGetter.value = packaged;
    setResourcesPath('C:/ClawX/resources');
    mockExistsSync.mockReturnValue(bundled);
    const { launchOpenClawCommandProcess } = await import('@electron/utils/openclaw-cli');
    launchOpenClawCommandProcess(mockedEntryPath, consentArgs, { ...options, preferPackagedWindowsNode: optedIn });
    expect(mockUtilityFork).toHaveBeenCalledWith(mockedEntryPath, consentArgs, options);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.each(['throws', 'emits error'] as const)('falls back once when bundled Node %s before launching', async (failure) => {
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:/ClawX/resources');
    mockExistsSync.mockReturnValue(true);
    const unavailable = new Error('cannot spawn');
    const unstarted = new EventEmitter();
    mockSpawn.mockImplementationOnce(() => {
      if (failure === 'throws') throw unavailable;
      return unstarted;
    });
    const utility = new EventEmitter();
    mockUtilityFork.mockReturnValueOnce(utility);
    const { launchOpenClawCommandProcess } = await import('@electron/utils/openclaw-cli');
    const child = launchOpenClawCommandProcess(mockedEntryPath, consentArgs, { ...options, preferPackagedWindowsNode: true });
    if (failure === 'emits error') unstarted.emit('error', unavailable);
    expect(child).toBe(utility);
    expect(mockUtilityFork).toHaveBeenCalledTimes(1);
    expect(mockUtilityFork).toHaveBeenCalledWith(mockedEntryPath, consentArgs, options);
  });
});

describe('getOpenClawEmbeddedForkSpec', () => {
  beforeEach(() => {
    resetOpenClawCliMocks();
  });

  afterEach(() => {
    resetOpenClawCliMocks();
  });

  it('uses the packaged macOS Helper executable instead of the visible app executable', async () => {
    const execPath = '/Applications/ClawX.app/Contents/MacOS/ClawX';
    const helperPath = join('/Applications/ClawX.app/Contents/Frameworks/ClawX Helper.app/Contents/MacOS/ClawX Helper');
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    setResourcesPath('/Applications/ClawX.app/Contents/Resources');
    setExecPath(execPath);
    mockExistsSync.mockImplementation((p: string) => p === helperPath);

    const { getOpenClawEmbeddedForkSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawEmbeddedForkSpec(['acp']);

    expect(spec).toMatchObject({
      modulePath: mockedEntryPath,
      args: ['acp'],
      options: {
        cwd: '/tmp/openclaw',
        execPath: helperPath,
        execArgv: ['--import', pathToFileURL('/tmp/clawx-user-data/openclaw-runtime-compat.mjs').href],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
        env: expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          OPENCLAW_NO_RESPAWN: '1',
          OPENCLAW_EMBEDDED_IN: 'ClawX',
          OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
        }),
      },
    });
  });

  it('does not launch Electron when no supported development Node is available', async () => {
    const execPath = '/Users/zhuoxu/workspace/ClawX/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
    setPlatform('darwin');
    setExecPath(execPath);
    process.env.PATH = '/opt/node/bin:/usr/bin';
    mockExistsSync.mockImplementation((p: string) => p === '/opt/node/bin/node');

    const { getOpenClawEmbeddedForkSpec } = await import('@electron/utils/openclaw-cli');
    expect(() => getOpenClawEmbeddedForkSpec(['acp'])).toThrow('Supported Node executable not found');
  });

  it('fails packaged macOS embedded launch when the Helper executable is missing', async () => {
    const execPath = '/Applications/ClawX.app/Contents/MacOS/ClawX';
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    setResourcesPath('/Applications/ClawX.app/Contents/Resources');
    setExecPath(execPath);
    mockExistsSync.mockReturnValue(false);

    const { getOpenClawEmbeddedForkSpec } = await import('@electron/utils/openclaw-cli');

    expect(() => getOpenClawEmbeddedForkSpec(['acp'])).toThrow('ClawX Helper executable not found');
  });
});
