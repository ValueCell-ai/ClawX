import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

const {
  mockExistsSync,
  mockReadFileSync,
  mockIsPackagedGetter,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadFileSync: vi.fn((filePath: string) => {
    if (filePath.includes('/build/openclaw/') || filePath.includes('\\build\\openclaw\\')) {
      return JSON.stringify({ version: '2026.4.11' });
    }
    if (filePath.includes('/node_modules/openclaw/') || filePath.includes('\\node_modules\\openclaw\\')) {
      return JSON.stringify({ version: '2026.2.23' });
    }
    if (filePath.endsWith('/package.json') || filePath.endsWith('\\package.json')) {
      return JSON.stringify({
        dependencies: {
          openclaw: '2026.4.11',
        },
      });
    }
    return JSON.stringify({});
  }),
  mockIsPackagedGetter: { value: false },
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

async function createFsMock() {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      readFileSync: mockReadFileSync,
      existsSync: mockExistsSync,
    },
  };
}

vi.mock('node:fs', createFsMock);
vi.mock('fs', createFsMock);

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => 'C:\\Program Files\\ClawX\\resources\\openclaw\\openclaw.mjs',
}));

describe('getOpenClawCliCommand (Windows packaged)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\Program Files\\ClawX\\resources',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
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

describe('resolveOpenClawInstallation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('linux');
    mockIsPackagedGetter.value = false;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('prefers a build/openclaw candidate that matches the declared version over stale node_modules', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('/build/openclaw')) return true;
      if (p.includes('/node_modules/openclaw')) return true;
      return false;
    });

    vi.doUnmock('@electron/utils/paths');
    const { resolveOpenClawInstallation } = await import('@electron/utils/paths');
    const resolution = resolveOpenClawInstallation({
      appPath: '/workspace',
      cwd: '/workspace',
      declaredVersion: '2026.4.11',
    });

    expect(resolution.selected.dir).toContain('/build/openclaw');
    expect(resolution.versionMismatch).toBe(false);
  });

  it('reports a mismatch warning when only stale node_modules is available', async () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('/node_modules/openclaw'));

    vi.doUnmock('@electron/utils/paths');
    const { resolveOpenClawInstallation } = await import('@electron/utils/paths');
    const resolution = resolveOpenClawInstallation({
      appPath: '/workspace',
      cwd: '/workspace',
      declaredVersion: '2026.4.11',
    });

    expect(resolution.selected.dir).toContain('/node_modules/openclaw');
    expect(resolution.versionMismatch).toBe(true);
    expect(resolution.warning).toContain('declared 2026.4.11');
    expect(resolution.warning).toContain('resolved 2026.2.23');
  });
});
