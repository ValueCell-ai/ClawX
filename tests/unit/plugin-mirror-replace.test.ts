// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('swaps in a complete mirror and removes the previous one', async () => {
    writeMirror(targetDir, '1.0.0');
    writeFileSync(join(targetDir, 'dist', 'stale.js'), '');
    const { replacePluginMirror } = await import('@electron/utils/plugin-install');

    replacePluginMirror(targetDir, (stagedDir) => writeMirror(stagedDir, '2.0.0'));

    expect(JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8')).version).toBe('2.0.0');
    expect(existsSync(join(targetDir, 'dist', 'stale.js'))).toBe(false);
    expect(stagingEntries()).toEqual([]);
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
    persist.mockImplementationOnce(() => { throw new Error('disk full'); });
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    expect(await ensurePluginInstalled('wecom', [source], 'WeCom')).toMatchObject({ installed: false });
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version).toBe('2026.8.17');
    expect(await ensurePluginInstalled('wecom', [source], 'WeCom')).toMatchObject({ installed: true });
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version).toBe('2026.10.30');
  });
});
