import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  testRoot,
  testExtensionsDir,
  mockLoggerInfo,
  mockLoggerWarn,
} = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = `/tmp/clawx-plugin-install-${suffix}`;
  return {
    testRoot: root,
    testExtensionsDir: `${root}/.openclaw/extensions`,
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
  };
});

const originalCwd = process.cwd();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => testRoot,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawExtensionsDir: () => testExtensionsDir,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
  },
}));

async function writePluginPackage(): Promise<void> {
  const pluginDir = join(testRoot, 'node_modules', '@larksuite', 'openclaw-lark');
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@larksuite/openclaw-lark',
      version: '2026.3.12',
      dependencies: {},
    }, null, 2),
    'utf8',
  );
  await writeFile(
    join(pluginDir, 'openclaw.plugin.json'),
    JSON.stringify({ id: 'openclaw-lark' }, null, 2),
    'utf8',
  );
  await writeFile(join(pluginDir, 'index.js'), 'export default {};\n', 'utf8');
}

describe('ensureChannelPluginInstalled', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testRoot, { recursive: true, force: true });
    await writePluginPackage();
    process.chdir(testRoot);
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  it('installs a dev plugin into the project-local .openclaw/extensions dir when no build mirror exists', async () => {
    const { ensureChannelPluginInstalled } = await import('@electron/utils/channel-plugin-install');

    const result = ensureChannelPluginInstalled({
      pluginDirName: 'feishu-openclaw-plugin',
      pluginLabel: 'Feishu',
      npmName: '@larksuite/openclaw-lark',
    });

    expect(result.installed).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(existsSync(join(testExtensionsDir, 'feishu-openclaw-plugin', 'openclaw.plugin.json'))).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(testExtensionsDir, 'feishu-openclaw-plugin', 'openclaw.plugin.json'), 'utf8'),
    ) as { id?: string };
    expect(manifest.id).toBe('openclaw-lark');
  });
});
