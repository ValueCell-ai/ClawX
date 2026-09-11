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

vi.mock('@electron/utils/dingtalk-dws', () => ({
  ensureDingTalkDwsInstalled: vi.fn(() => ({ installed: true })),
  removeLegacyOfficialDingTalkExtension: vi.fn(),
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

  it('remaps official DingTalk connector onto the dingtalk channel identity', async () => {
    const targetDir = '/home/test/.openclaw/extensions/dingtalk';
    const entryPath = `${targetDir}/dist/index.mjs`;
    mockExistsSync.mockImplementation((input: string) => [
      `${targetDir}/openclaw.plugin.json`,
      `${targetDir}/package.json`,
      `${targetDir}/dist`,
      entryPath,
    ].includes(String(input)));
    mockReaddirSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/dist`) {
        return [{ name: 'index.mjs', isDirectory: () => false, isFile: () => true }];
      }
      return [];
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({
          id: 'dingtalk-connector',
          channels: ['dingtalk-connector'],
          skills: ['./skills'],
          channelConfigs: {
            'dingtalk-connector': {
              schema: { type: 'object', additionalProperties: false },
            },
          },
        });
      }
      if (value.endsWith('package.json')) {
        return JSON.stringify({
          name: '@dingtalk-real-ai/dingtalk-connector',
          version: '0.8.25',
          main: 'dist/index.mjs',
          openclaw: {
            channels: ['dingtalk-connector'],
            channel: { id: 'dingtalk-connector' },
          },
        });
      }
      if (value.endsWith('dist/index.mjs')) {
        return [
          'export const CHANNEL_ID = "dingtalk-connector";',
          'api.registerGatewayMethod("dingtalk-connector.docs.create", handler);',
          'export default { id: "dingtalk-connector" };',
        ].join('\n');
      }
      return '{}';
    });

    const { fixupPluginManifest } = await import('@electron/utils/plugin-install');
    fixupPluginManifest(targetDir);

    const manifestWrite = mockWriteFileSync.mock.calls.find((call) => String(call[0]).endsWith('openclaw.plugin.json'));
    expect(manifestWrite?.[1]).toContain('"id": "dingtalk"');
    expect(manifestWrite?.[1]).toContain('"channelConfigs"');
    expect(manifestWrite?.[1]).toContain('"dingtalk"');
    expect(manifestWrite?.[1]).toContain('"./skills"');
    expect(manifestWrite?.[1]).not.toContain('"dingtalk-connector"');

    const pkgWrite = mockWriteFileSync.mock.calls.find((call) => String(call[0]).endsWith('package.json'));
    expect(pkgWrite?.[1]).toContain('"name": "@dingtalk-real-ai/dingtalk-connector"');
    expect(pkgWrite?.[1]).toContain('"id": "dingtalk"');

    const jsWrite = mockWriteFileSync.mock.calls
      .filter((call) => String(call[0]).endsWith('dist/index.mjs'))
      .at(-1);
    expect(jsWrite?.[1]).toContain('CHANNEL_ID = "dingtalk"');
    expect(jsWrite?.[1]).toContain('dingtalk-connector.docs.create');
    expect(jsWrite?.[1]).toContain('id: "dingtalk"');
  });

  it('replaces a community DingTalk mirror even when versions look equal', async () => {
    const targetDir = '/home/test/.openclaw/extensions/dingtalk';
    const sourceDir = '/bundle/dingtalk';
    mockExistsSync.mockImplementation((input: string) => [
      `${sourceDir}/openclaw.plugin.json`,
      `${sourceDir}/package.json`,
      `${targetDir}/openclaw.plugin.json`,
      `${targetDir}/package.json`,
    ].includes(String(input)));
    mockReadFileSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value === `${targetDir}/package.json`) {
        return JSON.stringify({ name: '@soimy/dingtalk', version: '0.8.25' });
      }
      if (value === `${sourceDir}/package.json` || value === `${targetDir}/package.json`) {
        return JSON.stringify({ name: '@dingtalk-real-ai/dingtalk-connector', version: '0.8.25' });
      }
      if (value.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({ id: 'dingtalk', channels: ['dingtalk'] });
      }
      if (value.endsWith('package.json')) {
        return JSON.stringify({
          name: '@dingtalk-real-ai/dingtalk-connector',
          version: '0.8.25',
        });
      }
      return '{}';
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('dingtalk', [sourceDir], 'DingTalk');
    expect(result.installed).toBe(true);
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('writes a path-owned DingTalk install record and removes the official legacy id', async () => {
    const targetDir = '/home/test/.openclaw/extensions/dingtalk';
    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value === `${targetDir}/openclaw.plugin.json`
        || value === `${targetDir}/package.json`;
    });
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input) === `${targetDir}/package.json`) {
        return JSON.stringify({ version: '0.8.25' });
      }
      return '{}';
    });
    mockRealpathSync.mockImplementation((input: string) => input);

    const { syncTrustedOfficialPluginInstallRecord } = await import('@electron/utils/plugin-install');
    await expect(syncTrustedOfficialPluginInstallRecord('dingtalk', targetDir)).resolves.toBe(true);
    expect(mockRemovePluginInstallRecordsFromSqlite).toHaveBeenCalledWith(['dingtalk-connector']);
    expect(mockUpsertPluginInstallRecordsIntoSqlite).toHaveBeenCalledWith({
      dingtalk: expect.objectContaining({
        source: 'path',
        sourcePath: targetDir,
        installPath: targetDir,
        version: '0.8.25',
      }),
    });
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
          version: '2026.8.17',
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

  it('patches WeCom 2026.8.17 to allow account-less desktop chat with one account', async () => {
    const targetDir = '/home/test/.openclaw/extensions/wecom';
    const toolPath = `${targetDir}/dist/src/cli/tool.js`;
    const upstreamTool = [
      'import { hasMultiAccounts, resolveWeComAccountMulti } from "../accounts.js";',
      'function resolveBot(accountId) {',
      '    const multi = hasMultiAccounts(cfg);',
      '    const id = accountId?.trim();',
      '    if (!id && multi) {',
      '        throw new Error("ambiguous");',
      '    }',
      '}',
    ].join('\n');

    mockExistsSync.mockImplementation((input: string) => String(input) === toolPath);
    mockReadFileSync.mockImplementation((input: string) => (
      String(input) === toolPath ? upstreamTool : '{}'
    ));

    const { fixupPluginManifest } = await import('@electron/utils/plugin-install');
    fixupPluginManifest(targetDir);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      toolPath,
      expect.stringContaining('const configuredAccountIds = listWeComAccountIds(cfg);'),
      'utf-8',
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      toolPath,
      expect.stringContaining('if (!id && configuredAccountIds.length > 1)'),
      'utf-8',
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[plugin] Patched WeCom desktop single-account tool fallback',
    );
  });

  it('repairs an already-installed same-version WeCom mirror', async () => {
    const targetDir = '/home/test/.openclaw/extensions/wecom';
    const sourceDir = '/bundle/wecom';
    const toolPath = `${targetDir}/dist/src/cli/tool.js`;
    const upstreamTool = [
      'import { hasMultiAccounts, resolveWeComAccountMulti } from "../accounts.js";',
      '    const multi = hasMultiAccounts(cfg);',
      '    const id = accountId?.trim();',
      '    if (!id && multi) {',
    ].join('\n');

    mockExistsSync.mockImplementation((input: string) => [
      `${sourceDir}/openclaw.plugin.json`,
      `${sourceDir}/package.json`,
      `${targetDir}/openclaw.plugin.json`,
      `${targetDir}/package.json`,
      toolPath,
    ].includes(String(input)));
    mockReadFileSync.mockImplementation((input: string) => {
      const value = String(input);
      if (value === toolPath) return upstreamTool;
      if (value.endsWith('openclaw.plugin.json')) {
        return JSON.stringify({ id: 'wecom', channels: ['wecom'] });
      }
      if (value.endsWith('package.json')) {
        return JSON.stringify({
          name: '@wecom/wecom-openclaw-plugin',
          version: '2026.8.17',
          main: 'dist/index.js',
        });
      }
      return '{}';
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = await ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result.installed).toBe(true);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      toolPath,
      expect.stringContaining('if (!id && configuredAccountIds.length > 1)'),
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

  it('does not ship or expose an installer for the retired CUA adapter', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    for (const file of ['package.json', 'openclaw.plugin.json', 'index.mjs', 'computer-tool.mjs', 'mcp-client.mjs']) {
      expect(actualFs.existsSync(path.resolve('resources/openclaw-plugins/clawx-cua-computer', file))).toBe(false);
    }
    const installer = await import('@electron/utils/plugin-install');
    expect(Object.keys(installer)).not.toContain('ensureClawXCuaPluginInstalled');
  });

  it('skips CUA install and trust repair at startup while retaining the OpenAI image mirror', async () => {
    const extensions = '/home/test/.openclaw/extensions';
    const retiredDir = `${extensions}/clawx-cua-computer`;
    const imageDir = `${extensions}/clawx-openai-image`;
    configState.authoritative = { plugins: {
      allow: ['clawx-cua-computer'],
      entries: { 'clawx-cua-computer': { enabled: false } },
      installs: { 'clawx-cua-computer': { source: 'path', installPath: retiredDir } },
    } };
    const original = structuredClone(configState.authoritative);
    mockExistsSync.mockImplementation((input: string) => {
      const value = String(input);
      return value.startsWith(retiredDir) || value.startsWith(imageDir);
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '0.1.0' }));

    const { ensureAllBundledPluginsInstalled, syncTrustedOfficialPluginInstallRecord } = await import('@electron/utils/plugin-install');
    await ensureAllBundledPluginsInstalled();
    await expect(syncTrustedOfficialPluginInstallRecord('clawx-cua-computer', retiredDir)).resolves.toBe(false);
    expect(configState.authoritative).toEqual(original);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockUpsertPluginInstallRecordsIntoSqlite).toHaveBeenCalledWith({
      'clawx-openai-image': expect.objectContaining({
        source: 'path',
        installPath: imageDir,
      }),
    });
    expect(mockUpsertPluginInstallRecordsIntoSqlite).not.toHaveBeenCalledWith(expect.objectContaining({
      'clawx-cua-computer': expect.anything(),
    }));
    expect(mockReadFileSync.mock.calls.some(([file]) => String(file).startsWith(retiredDir))).toBe(false);
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
        return JSON.stringify({ version: '2026.8.17' });
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
        version: '2026.8.17',
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
        return JSON.stringify({ version: '2026.7.16' });
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
        version: '2026.7.16',
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
