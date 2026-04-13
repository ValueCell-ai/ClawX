import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

const {
  mockExistsSync,
  mockReadFileSync,
  mockIsPackagedGetter,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadFileSync: vi.fn<(path: string) => string>(),
  mockIsPackagedGetter: { value: false },
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getPath: () => '/tmp/clawx-user-data',
    getAppPath: () => '/workspace',
  },
}));

describe('resolveOpenClawInstallation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('linux');
    mockIsPackagedGetter.value = false;
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath === '/workspace/package.json') {
        return JSON.stringify({
          dependencies: {
            openclaw: '2026.4.11',
          },
        });
      }
      if (filePath.includes('/build/openclaw/package.json')) {
        return JSON.stringify({ version: '2026.4.11' });
      }
      if (filePath.includes('/node_modules/openclaw/package.json')) {
        return JSON.stringify({ version: '2026.2.23' });
      }
      return JSON.stringify({});
    });
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

    const { resolveOpenClawInstallation } = await import('@electron/utils/paths');
    const resolution = resolveOpenClawInstallation({
      appPath: '/workspace',
      cwd: '/workspace',
      declaredVersion: '2026.4.11',
    });

    expect(resolution.selected.dir).toContain('/build/openclaw');
    expect(resolution.selected.version).toBe('2026.4.11');
    expect(resolution.versionMismatch).toBe(false);
  });

  it('reports a mismatch warning when only stale node_modules is available', async () => {
    mockExistsSync.mockImplementation((p: string) => p.includes('/node_modules/openclaw'));

    const { resolveOpenClawInstallation } = await import('@electron/utils/paths');
    const resolution = resolveOpenClawInstallation({
      appPath: '/workspace',
      cwd: '/workspace',
      declaredVersion: '2026.4.11',
    });

    expect(resolution.selected.dir).toContain('/node_modules/openclaw');
    expect(resolution.selected.version).toBe('2026.2.23');
    expect(resolution.versionMismatch).toBe(true);
    expect(resolution.warning).toContain('declared 2026.4.11');
    expect(resolution.warning).toContain('resolved 2026.2.23');
  });
});
