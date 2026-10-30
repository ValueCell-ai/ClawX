// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/mock/app' },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@electron/utils/plugin-install-index', () => ({
  upsertPluginInstallRecordsIntoSqlite: vi.fn(() => true),
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
});
