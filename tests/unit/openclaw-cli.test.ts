import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
}));

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
      "& 'C:\\Program Files\\ClawX\\resources/cli/openclaw.cmd'",
    );
  });

  it('falls back to bundled node.exe when openclaw.cmd is missing', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    expect(getOpenClawCliCommand()).toBe(
      "& 'C:\\Program Files\\ClawX\\resources/bin/node.exe' 'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs'",
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
    mockExistsSync.mockImplementation((p: string) => p === '/tmp/.bin/openclaw');

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec).toEqual({ command: '/tmp/.bin/openclaw', args: [], shell: false });
    expect(spec.command).not.toMatch(/^& |^['"]/);
  });

  it('uses cmd.exe for a Windows dev cmd wrapper', async () => {
    const comSpecPath = 'C:\\Windows\\System32\\cmd.exe';
    setPlatform('win32');
    process.env.ComSpec = comSpecPath;
    mockExistsSync.mockImplementation((p: string) => p === '/tmp/.bin/openclaw.cmd');

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(comSpecPath);
    expect(spec.args).toEqual(['/d', '/s', '/c', '"/tmp/.bin/openclaw.cmd"']);
    expect(spec.shell).not.toBe(true);
  });

  it('returns the packaged POSIX wrapper path as the spawn command', async () => {
    setPlatform('linux');
    mockIsPackagedGetter.value = true;
    setResourcesPath('/opt/ClawX/resources');
    mockExistsSync.mockImplementation((p: string) => p === '/opt/ClawX/resources/cli/openclaw');

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec).toEqual({ command: '/opt/ClawX/resources/cli/openclaw', args: [], shell: false });
  });

  it('uses cmd.exe for a packaged Windows cmd wrapper', async () => {
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    setResourcesPath('C:\\Program Files\\ClawX\\resources');
    mockExistsSync.mockImplementation((p: string) => /[\\/]cli[\\/]openclaw\.cmd$/i.test(p));

    const { getOpenClawCliSpawnSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBe(process.env.ComSpec || 'cmd.exe');
    expect(spec.args).toEqual(['/d', '/s', '/c', '"C:\\Program Files\\ClawX\\resources/cli/openclaw.cmd"']);
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

    expect(spec.command).toBe('C:\\Program Files\\ClawX\\resources/bin/node.exe');
    expect(spec.args).toEqual([mockedEntryPath]);
    expect(spec.shell).toBeUndefined();
    expect(spec.env).toBeUndefined();
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
    const helperPath = '/Applications/ClawX.app/Contents/Frameworks/ClawX Helper.app/Contents/MacOS/ClawX Helper';
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
        execArgv: [],
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

  it('uses a real Node executable from PATH for dev embedded launches instead of Electron', async () => {
    const execPath = '/Users/zhuoxu/workspace/ClawX/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
    setPlatform('darwin');
    setExecPath(execPath);
    process.env.PATH = '/opt/node/bin:/usr/bin';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    mockExistsSync.mockImplementation((p: string) => p === '/opt/node/bin/node');

    const { getOpenClawEmbeddedForkSpec } = await import('@electron/utils/openclaw-cli');
    const spec = getOpenClawEmbeddedForkSpec(['acp']);

    expect(spec.options.execPath).toBe('/opt/node/bin/node');
    expect(spec.options.execPath).not.toBe(execPath);
    expect(spec.options.env).not.toMatchObject({ ELECTRON_RUN_AS_NODE: '1' });
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
