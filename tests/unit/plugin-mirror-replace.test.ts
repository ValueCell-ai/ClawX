// @vitest-environment node
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { home, persist } = vi.hoisted(() => ({ home: { path: '' }, persist: vi.fn(() => true) }));
vi.mock('node:os', async () => ({ ...await vi.importActual('node:os'), homedir: () => home.path }));

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/mock/app' },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@electron/utils/plugin-install-index', () => ({
  upsertPluginInstallRecordsIntoSqlite: persist,
  removePluginInstallRecordsFromSqlite: vi.fn(() => true),
  ensureOpenClawStateDirExists: vi.fn(),
}));

vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/dingtalk-dws', () => ({
  ensureDingTalkDwsInstalled: vi.fn(() => ({ installed: true })),
  removeLegacyOfficialDingTalkExtension: vi.fn(),
}));

function writeMirror(dir: string, version: string): void {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: 'feishu' }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@openclaw/feishu', version }));
  writeFileSync(join(dir, 'dist', 'index.js'), `export const version = '${version}';\n`);
}

describe('replacePluginMirror', () => {
  let openclawDir: string;
  let targetDir: string;

  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), 'clawx-plugin-mirror-'));
    home.path = openclawDir;
    persist.mockReset().mockReturnValue(true);
    targetDir = join(openclawDir, 'extensions', 'feishu-openclaw-plugin');
  });

  afterEach(() => {
    rmSync(openclawDir, { recursive: true, force: true });
  });

  function stagingEntries(): string[] {
    const stagingRoot = join(openclawDir, '.clawx-plugin-staging');
    return existsSync(stagingRoot) ? readdirSync(stagingRoot) : [];
  }

  it.each([
    ['@wecom/wecom-openclaw-plugin', 'wecom', 'wecom', 20],
    ['@dingtalk-real-ai/dingtalk-connector', 'dingtalk', 'dingtalk', 20],
    ['@openclaw/feishu', 'feishu-openclaw-plugin', 'feishu', 30],
    ['@tencent-weixin/openclaw-weixin', 'openclaw-weixin', 'openclaw-weixin', 100],
  ] as const)('repairs the same-version %s channel descriptor in place', async (npmName, dirName, channel, cap) => {
    const upstream = join(process.cwd(), 'node_modules', npmName);
    const installed = join(home.path, '.openclaw', 'extensions', dirName);
    mkdirSync(installed, { recursive: true });
    for (const name of ['openclaw.plugin.json', 'package.json']) {
      copyFileSync(join(upstream, name), join(installed, name));
    }
    const manifestPath = join(installed, 'openclaw.plugin.json');
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    expect(await ensurePluginInstalled(dirName, [upstream], channel)).toMatchObject({ installed: true });
    const descriptor = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(descriptor.id).toBe(channel);
    expect(descriptor.channelConfigs[channel]).toMatchObject({ outboundMediaMaxMb: cap, schema: { type: 'object' } });
    expect(descriptor.channelConfigs['dingtalk-connector']).toBeUndefined();

    // A subsequent plugin release can supply its own budget.
    descriptor.channelConfigs[channel].outboundMediaMaxMb = 11;
    writeFileSync(manifestPath, JSON.stringify(descriptor));
    expect(await ensurePluginInstalled(dirName, [upstream], channel)).toMatchObject({ installed: true });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).channelConfigs[channel].outboundMediaMaxMb).toBe(11);
  });

  it('swaps in a complete mirror and removes the previous one', async () => {
    writeMirror(targetDir, '1.0.0');
    writeFileSync(join(targetDir, 'dist', 'stale.js'), '');
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');

    replacePluginMirror(targetDir, (stagedDir) => writeMirror(stagedDir, '2.0.0'));

    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('2.0.0');
    expect(existsSync(join(targetDir, 'dist', 'stale.js'))).toBe(false);
    expect(stagingEntries()).toEqual([]);
  });

  it('publishes the patched WeChat connector once when the upstream version is unchanged', async () => {
    const plugin = 'openclaw-weixin';
    const source = join(home.path, 'bundle', plugin);
    const installed = join(home.path, '.openclaw', 'extensions', plugin);
    const pkg = { name: '@tencent-weixin/openclaw-weixin', version: '2.4.10' };
    for (const dir of [source, installed]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: plugin }));
    }
    writeFileSync(join(installed, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(source, 'package.json'), JSON.stringify({ ...pkg, clawxMirrorRevision: 1 }));
    writeFileSync(join(source, 'index.js'), 'export default 1;');

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const install = () => ensurePluginInstalled(plugin, [source], 'WeChat');
    expect(await install()).toMatchObject({ installed: true });
    expect(readFileSync(join(installed, 'index.js'), 'utf8')).toBe('export default 1;');
    // An unnecessary second swap would discard this marker.
    writeFileSync(join(installed, 'marker'), '');
    expect(await install()).toMatchObject({ installed: true });
    expect(existsSync(join(installed, 'marker'))).toBe(true);
  });

  it('installs a fresh mirror when none exists', async () => {
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');

    replacePluginMirror(targetDir, (stagedDir) => writeMirror(stagedDir, '2.0.0'));

    expect(existsSync(join(targetDir, 'openclaw.plugin.json'))).toBe(true);
    expect(stagingEntries()).toEqual([]);
  });

  it('keeps the previous mirror when the copy fails partway', async () => {
    writeMirror(targetDir, '1.0.0');
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');

    expect(() => replacePluginMirror(targetDir, (stagedDir) => {
      mkdirSync(stagedDir, { recursive: true });
      writeFileSync(join(stagedDir, 'package.json'), JSON.stringify({ name: '@openclaw/feishu', version: '2.0.0' }));
      throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    })).toThrow('locked');

    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('1.0.0');
    expect(readFileSync(join(targetDir, 'dist', 'index.js'), 'utf8')).toContain('1.0.0');
    expect(stagingEntries()).toEqual([]);
  });

  it('refuses a staged mirror without a manifest', async () => {
    writeMirror(targetDir, '1.0.0');
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');

    expect(() => replacePluginMirror(targetDir, (stagedDir) => {
      mkdirSync(stagedDir, { recursive: true });
      writeFileSync(join(stagedDir, 'package.json'), '{}');
    })).toThrow('openclaw.plugin.json');

    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('1.0.0');
    expect(stagingEntries()).toEqual([]);
  });
  it('keeps the previous payload until metadata commits and can undo a publication', async () => {
    writeMirror(targetDir, '1.0.0');
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');
    const transaction = replacePluginMirror(targetDir, (dir) => writeMirror(dir, '2.0.0'), true)!;
    expect(stagingEntries()).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('2.0.0');
    transaction.rollback();
    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('1.0.0');
    expect(stagingEntries()).toEqual([]);
  });
  it('restores an installed payload when SQLite metadata publication fails', async () => {
    const target = join(openclawDir, '.openclaw/extensions/wecom');
    const source = join(openclawDir, 'bundle/wecom');
    for (const [dir, version] of [[target, '2026.8.17'], [source, '2026.10.30']]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: 'wecom' }));
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@wecom/wecom-openclaw-plugin', version }));
    }
    persist.mockImplementation(() => { throw new Error('disk full'); });
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    expect(await ensurePluginInstalled('wecom', [source], 'WeCom')).toMatchObject({ installed: false });
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version).toBe('2026.8.17');
    persist.mockReturnValue(true);
    expect(await ensurePluginInstalled('wecom', [source], 'WeCom')).toMatchObject({ installed: true });
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version).toBe('2026.10.30');
  });
});
