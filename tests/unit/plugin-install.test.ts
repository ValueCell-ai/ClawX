import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockCpSync,
  mockCopyFileSync,
  mockStatSync,
  mockLstatSync,
  mockMkdirSync,
  mockRmSync,
  mockSymlinkSync,
  mockUnlinkSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockReaddirSync,
  mockRealpathSync,
  mockReadlinkSync,
  mockLoggerWarn,
  mockLoggerInfo,
  mockUpsertPluginInstallRecordsIntoSqlite,
  mockRemovePluginInstallRecordsFromSqlite,
  mockMutateOpenClawConfig,
  mockHomedir,
  mockApp,
  configState,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockStatSync: vi.fn(() => ({ isDirectory: () => false })),
  mockLstatSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockSymlinkSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockRealpathSync: vi.fn(),
  mockReadlinkSync: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockUpsertPluginInstallRecordsIntoSqlite: vi.fn(() => true),
  mockRemovePluginInstallRecordsFromSqlite: vi.fn(() => true),
  mockMutateOpenClawConfig: vi.fn(),
  mockHomedir: vi.fn(() => '/home/test'),
  mockApp: {
    isPackaged: true,
    getAppPath: vi.fn(() => '/mock/app'),
  },
  configState: {
    authoritative: {} as Record<string, unknown>,
  },
}));

const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform');

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mocked = {
    ...actual,
    existsSync: mockExistsSync,
    cpSync: mockCpSync,
    copyFileSync: mockCopyFileSync,
    statSync: mockStatSync,
    lstatSync: mockLstatSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    symlinkSync: mockSymlinkSync,
    unlinkSync: mockUnlinkSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    readdirSync: mockReaddirSync,
    realpathSync: mockRealpathSync,
    readlinkSync: mockReadlinkSync,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readdir: vi.fn(),
    stat: vi.fn(),
    copyFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock('node:os', () => ({
  homedir: () => mockHomedir(),
  default: {
    homedir: () => mockHomedir(),
  },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
  },
}));

vi.mock('@electron/utils/plugin-install-index', () => ({
  upsertPluginInstallRecordsIntoSqlite: mockUpsertPluginInstallRecordsIntoSqlite,
  removePluginInstallRecordsFromSqlite: mockRemovePluginInstallRecordsFromSqlite,
  ensureOpenClawStateDirExists: vi.fn(),
}));

vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: mockMutateOpenClawConfig,
}));

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('plugin installer diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.isPackaged = true;
    mockHomedir.mockReturnValue('/home/test');
    setPlatform('linux');

    mockExistsSync.mockReturnValue(false);
    mockCpSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
    mockRmSync.mockImplementation(() => undefined);
    mockSymlinkSync.mockImplementation(() => undefined);
    mockUnlinkSync.mockImplementation(() => undefined);
    mockLstatSync.mockImplementation(() => {
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    });
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockReaddirSync.mockReturnValue([]);
    mockRealpathSync.mockImplementation((input: string) => input);
    configState.authoritative = {};
    mockMutateOpenClawConfig.mockImplementation(async (
      mutator: (config: Record<string, unknown>) => void | Promise<void>,
    ) => {
      const before = structuredClone(configState.authoritative);
      await mutator(configState.authoritative);
      return JSON.stringify(before) !== JSON.stringify(configState.authoritative);
    });
  });

  afterEach(() => {
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR);
    }
  });

  it('adds the WeCom channel descriptor while preserving valid upstream npm metadata', async () => {
    const targetDir = '/home/test/.openclaw/extensions/wecom';
    mockExistsSync.mockImplementation((input: string) => [
      `${targetDir}/openclaw.plugin.json`,
      `${targetDir}/package.json`,
      `${targetDir}/dist/index.js`,
    ].includes(String(input)));
    mockReadFileSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({ id: 'wecom-openclaw-plugin', channels: ['wecom'] });
      }
      if (value.endsWith('package.json')) {
        return JSON.stringify({
          name: '@wecom/wecom',
          version: '2026.7.2',
          main: 'dist/index.js',
          openclaw: { install: { npmSpec: '@wecom/wecom', localPath: 'extensions/wecom' } },
        });
      }
      if (value.endsWith('dist/index.js')) {
        return 'export default { id: "wecom-openclaw-plugin" };';
      }
      return '{}';
    });

    const { fixupPluginManifest } = await import('@electron/utils/plugin-install');
    fixupPluginManifest(targetDir);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${targetDir}/openclaw.plugin.json`,
      expect.stringContaining('"channelConfigs"'),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${targetDir}/openclaw.plugin.json`,
      expect.stringContaining('"id": "wecom"'),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `${targetDir}/package.json`,
      expect.stringContaining('"name": "@wecom/wecom-openclaw-plugin"'),
      'utf-8',
    );
  });

  it('returns source-missing warning when bundled mirror cannot be found', async () => {
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('wecom', ['/bundle/wecom'], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toContain('Bundled WeCom plugin mirror not found');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('retries once on Windows and logs diagnostic details when bundled copy fails', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\ClawX\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'Program Files\\ClawX\\resources\\openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    // On win32, cpSyncSafe uses _copyDirSyncRecursive (readdirSync) instead of cpSync.
    // Simulate copy failure by making readdirSync throw during directory traversal.
    mockReaddirSync.mockImplementation((_path: string, opts?: unknown) => {
      if (opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>)) {
        const error = new Error('path too long') as NodeJS.ErrnoException;
        error.code = 'ENAMETOOLONG';
        throw error;
      }
      return [];
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result).toEqual({
      installed: false,
      warning: 'Failed to install bundled WeCom plugin mirror',
    });

    // On win32, cpSyncSafe walks the directory via readdirSync (with withFileTypes)
    const copyAttempts = mockReaddirSync.mock.calls.filter(
      (call: unknown[]) => {
        const opts = call[1];
        return opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>);
      },
    );
    expect(copyAttempts).toHaveLength(2); // initial + 1 retry
    const firstSrcPath = String(copyAttempts[0][0]);
    expect(firstSrcPath.startsWith('\\\\?\\')).toBe(true);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        pluginDirName: 'wecom',
        pluginLabel: 'WeCom',
        sourceDir,
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'ENAMETOOLONG' }),
          expect.objectContaining({ attempt: 2, code: 'ENAMETOOLONG' }),
        ],
      }),
    );
  });

  it('logs EPERM diagnostics with source and target paths', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\ClawX\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'Program Files\\ClawX\\resources\\openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    // On win32, cpSyncSafe uses _copyDirSyncRecursive (readdirSync) instead of cpSync.
    mockReaddirSync.mockImplementation((_path: string, opts?: unknown) => {
      if (opts && typeof opts === 'object' && 'withFileTypes' in (opts as Record<string, unknown>)) {
        const error = new Error('access denied') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return [];
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toBe('Failed to install bundled WeCom plugin mirror');

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        sourceDir,
        targetDir: expect.stringContaining('.openclaw/extensions/wecom'),
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'EPERM' }),
          expect.objectContaining({ attempt: 2, code: 'EPERM' }),
        ],
      }),
    );
  });

  it('writes trusted SQLite metadata for mirrored official whatsapp plugin', async () => {
    const targetDir = '/home/test/.openclaw/extensions/whatsapp';
    const sourceDir = '/bundle/whatsapp';

    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value.includes('openclaw.plugin.json')
        || value.includes('/bundle/whatsapp/package.json')
        || value.includes(`${targetDir}/package.json`);
    });
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input).endsWith('package.json')) {
        return JSON.stringify({ version: '2026.6.10' });
      }
      return '{}';
    });
    mockRealpathSync.mockImplementation((input: string) => input);

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('whatsapp', [sourceDir], 'WhatsApp');

    expect(result).toEqual({ installed: true, peerLinkOk: true });
    expect(mockUpsertPluginInstallRecordsIntoSqlite).toHaveBeenCalledWith({
      whatsapp: expect.objectContaining({
        installPath: targetDir,
        resolvedName: '@openclaw/whatsapp',
      }),
    });
  });

  it('reports a failed OpenClaw peer link repair for an installed mirror', async () => {
    const targetDir = '/home/test/.openclaw/extensions/qqbot';

    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value === `${targetDir}/openclaw.plugin.json`
        || value === `${targetDir}/package.json`;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/package.json`) {
        return JSON.stringify({
          name: '@openclaw/qqbot',
          version: '2026.7.1',
          peerDependencies: { openclaw: '>=2026.7.1' },
        });
      }
      return '{}';
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('qqbot', ['/bundle/qqbot'], 'QQBot');

    expect(result).toEqual({ installed: true, peerLinkOk: false });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('runtime package missing'),
    );
  });

  it('removes WeCom updater metadata for the patched legacy-compatible plugin id', async () => {
    const targetDir = '/home/test/.openclaw/extensions/wecom';
    configState.authoritative = {
      gatewayOnly: true,
      plugins: {
        installs: {
          wecom: {
            source: 'npm',
            spec: '@wecom/wecom-openclaw-plugin',
            version: '2026.6.23',
          },
        },
      },
    };

    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value === `${targetDir}/openclaw.plugin.json`
        || value === `${targetDir}/package.json`;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/package.json`) {
        return JSON.stringify({ version: '2026.7.2' });
      }
      return '{}';
    });
    mockRealpathSync.mockImplementation((input: string) => input);

    const { syncTrustedOfficialPluginInstallRecord } = await import('@electron/utils/plugin-install');
    await expect(syncTrustedOfficialPluginInstallRecord('wecom', targetDir)).resolves.toBe(true);
    expect(configState.authoritative).toEqual({ gatewayOnly: true, plugins: {} });
    expect(mockMutateOpenClawConfig).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRemovePluginInstallRecordsFromSqlite).toHaveBeenCalledWith(['wecom-openclaw-plugin']);
    expect(mockUpsertPluginInstallRecordsIntoSqlite).toHaveBeenCalledWith({
      wecom: expect.objectContaining({
        source: 'path',
        sourcePath: targetDir,
        installPath: targetDir,
        version: '2026.7.2',
      }),
    });
  });

  it('replaces legacy Feishu npm ownership with the ClawX path mirror', async () => {
    const targetDir = '/home/test/.openclaw/extensions/feishu-openclaw-plugin';
    configState.authoritative = {
      gatewayOnly: true,
      plugins: {
        installs: {
          'openclaw-lark': { source: 'npm', version: '2026.6.10' },
          'feishu-openclaw-plugin': { source: 'npm', version: '2026.6.10' },
        },
      },
    };

    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value === `${targetDir}/openclaw.plugin.json`
        || value === `${targetDir}/package.json`;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/package.json`) {
        return JSON.stringify({ version: '2026.7.9' });
      }
      return '{}';
    });

    const { syncTrustedOfficialPluginInstallRecord } = await import('@electron/utils/plugin-install');
    await expect(syncTrustedOfficialPluginInstallRecord('feishu-openclaw-plugin', targetDir)).resolves.toBe(true);

    expect(configState.authoritative).toEqual({ gatewayOnly: true, plugins: {} });
    expect(mockMutateOpenClawConfig).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRemovePluginInstallRecordsFromSqlite).toHaveBeenCalledWith([
      'feishu-openclaw-plugin',
      'feishu',
    ]);
    expect(mockUpsertPluginInstallRecordsIntoSqlite).toHaveBeenCalledWith({
      'openclaw-lark': expect.objectContaining({
        source: 'path',
        sourcePath: targetDir,
        installPath: targetDir,
        version: '2026.7.9',
      }),
    });
  });

  it('removes stale metadata even when an unconfigured mirror directory is already missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const { removeTrustedOfficialPluginInstallRecord } = await import('@electron/utils/plugin-install');
    await expect(removeTrustedOfficialPluginInstallRecord('whatsapp')).resolves.toBe(true);
    expect(mockMutateOpenClawConfig).toHaveBeenCalledOnce();
    expect(mockRemovePluginInstallRecordsFromSqlite).toHaveBeenCalledWith(['whatsapp']);
  });

  it('links a mirrored plugin openclaw peer to the bundled runtime', async () => {
    const targetDir = '/home/test/.openclaw/extensions/qqbot';
    const openclawDir = '/app/resources/openclaw';
    const nodeModulesDir = `${targetDir}/node_modules`;
    const linkPath = `${nodeModulesDir}/openclaw`;
    let linked = false;

    mockExistsSync.mockImplementation((input: string) => String(input) === `${openclawDir}/package.json`);
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/package.json`) {
        return JSON.stringify({ peerDependencies: { openclaw: '>=2026.7.1' } });
      }
      return '{}';
    });
    mockLstatSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value === nodeModulesDir) {
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
        };
      }
      if (linked && value.endsWith(`${path.sep}openclaw`)) {
        return {
          isDirectory: () => false,
          isSymbolicLink: () => true,
        };
      }
      const error = new Error('missing') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    });
    mockSymlinkSync.mockImplementation(() => {
      linked = true;
    });
    mockReadlinkSync.mockImplementation((input: string) => (
      linked && String(input).endsWith(`${path.sep}openclaw`) ? openclawDir : ''
    ));
    mockRealpathSync.mockImplementation((input: string) => {
      if (linked && String(input).endsWith(`${path.sep}openclaw`)) {
        return `${openclawDir}-realpath-divergence`;
      }
      return String(input);
    });

    const { repairPluginOpenClawPeerLink } = await import('@electron/utils/plugin-install');
    expect(repairPluginOpenClawPeerLink(targetDir, openclawDir)).toBe(true);
    expect(mockSymlinkSync).toHaveBeenCalledWith(openclawDir, linkPath, 'junction');
  });
});
