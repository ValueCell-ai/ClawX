// @vitest-environment node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() } }));

// Installed identities from ClawX v0.6.1 / OpenClaw 2026.7.1-2, after ClawX's ID fixes.
const mirrors = [
  { dir: 'wecom', name: '@wecom/wecom-openclaw-plugin', version: '2026.8.17', id: 'wecom' },
  { dir: 'openclaw-weixin', name: '@tencent-weixin/openclaw-weixin', version: '2.4.8', id: 'openclaw-weixin' },
  { dir: 'dingtalk', name: '@dingtalk-real-ai/dingtalk-connector', version: '0.8.25', id: 'dingtalk' },
  { dir: 'feishu-openclaw-plugin', name: '@larksuite/openclaw-lark', version: '2026.7.16', id: 'openclaw-lark' },
];
const channels = ['wecom', 'openclaw-weixin', 'dingtalk', 'feishu'];
const oldIds = mirrors.map(mirror => mirror.id);
const oldChannels = {
  wecom: { botId: 'fixture', secret: 'synthetic' },
  dingtalk: { clientId: 'fixture', clientSecret: 'synthetic' },
  'openclaw-weixin': {},
  feishu: { appId: 'fixture', appSecret: 'synthetic', streaming: true },
};
const legacyConfig = {
  channels: Object.fromEntries(Object.entries(oldChannels).map(([id, credentials]) => [id, {
    ...credentials, enabled: true, accounts: { work: { enabled: true }, limited: { mediaMaxMb: 5 }, large: { mediaMaxMb: 128 } },
  }])),
  plugins: { allow: oldIds, entries: Object.fromEntries(oldIds.map(id => [id, { enabled: true }])) },
};
let testHome: string;
let stateDir: string;
let migratedConfig: string;
async function runPhase(phase: string) {
  const { stdout } = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/outbound-media-upgrade.mjs'), phase], {
    env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_HOME: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json') },
  });
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}

describe('outbound attachments after upgrading directly from ClawX 0.6.1', () => {
  beforeAll(async () => {
    testHome = await mkdtemp(join(tmpdir(), 'clawx-outbound-upgrade-'));
    stateDir = join(testHome, '.openclaw');
    vi.stubEnv('HOME', testHome);
    vi.stubEnv('USERPROFILE', testHome);
    vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);
    vi.stubEnv('OPENCLAW_CONFIG_PATH', join(stateDir, 'openclaw.json'));
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const { readPluginInstallRecordsFromSqlite, upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
    const { syncFeishuPluginRegistrationWithInstalledPlugin } = await import('@electron/utils/openclaw-auth');
    await mkdir(join(stateDir, 'workspace'), { recursive: true });
    await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify(legacyConfig));

    for (const { dir, id, name, version } of mirrors) {
      const installed = join(stateDir, 'extensions', dir);
      await mkdir(installed, { recursive: true });
      await writeFile(join(installed, 'package.json'), JSON.stringify({ name, version }));
      await writeFile(join(installed, 'openclaw.plugin.json'), JSON.stringify({ id }));
      const ownership = id === 'openclaw-weixin'
        ? { source: 'npm', spec: name, resolvedName: name, resolvedVersion: version, resolvedSpec: `${name}@${version}` }
        : { source: 'path', spec: installed, sourcePath: installed };
      upsertPluginInstallRecordsIntoSqlite({ [id]: { ...ownership, installPath: installed, version } }, { throwOnError: true });
    }
    expect(Object.keys(readPluginInstallRecordsFromSqlite()).sort()).toEqual([...oldIds].sort());

    for (const { dir, id, name } of mirrors) {
      const installed = join(stateDir, 'extensions', dir);
      // Mirror publication needs the real package metadata. Executable upload code
      // is exercised separately from node_modules at each plugin's transport boundary.
      const nextName = id === 'openclaw-lark' ? '@openclaw/feishu' : name;
      const source = resolve('node_modules', nextName);
      const bundled = join(testHome, 'bundled', dir);
      await mkdir(bundled, { recursive: true });
      for (const file of ['package.json', 'openclaw.plugin.json']) {
        await copyFile(join(source, file), join(bundled, file));
      }
      const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      const { extensions, runtimeExtensions = [], runtimeSetupEntry, setupEntry } = pkg.openclaw;
      for (const entry of new Set<string>([...extensions, ...runtimeExtensions, runtimeSetupEntry, setupEntry].filter(Boolean))) {
        await mkdir(dirname(join(bundled, entry)), { recursive: true });
        await writeFile(join(bundled, entry), "throw new Error('Static manifest lookup must not run the channel');\n");
      }
      expect(await ensurePluginInstalled(dir, [bundled], dir)).toMatchObject({ installed: true });
      expect(JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))).toMatchObject({ name: nextName, version: pkg.version });
    }
    await syncFeishuPluginRegistrationWithInstalledPlugin();
    expect(Object.keys(readPluginInstallRecordsFromSqlite()).sort()).toEqual([...channels].sort());
    migratedConfig = await readFile(join(stateDir, 'openclaw.json'), 'utf8');
    expect(JSON.parse(migratedConfig)).toEqual({
      channels: { ...legacyConfig.channels, feishu: { ...legacyConfig.channels.feishu, streaming: { mode: 'partial' } } },
      plugins: { allow: channels, entries: Object.fromEntries(channels.map(id => [id, { enabled: true }])) },
    });
  }, 30_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (testHome) await rm(testHome, { recursive: true, force: true });
  });

  it('resolves installed channel capabilities with account, channel and agent overrides in order', async () => {
    expect(await runPhase('limits')).toEqual({
      defaults: { wecom: 20, feishu: 30, 'openclaw-weixin': 100, dingtalk: 20, telegram: 100, 'unknown-channel': 5 },
      configured: Object.fromEntries(channels.map(c => [c, [7, 128, 5]])),
      migratedAccounts: Object.fromEntries(channels.map(c => [c, [5, 128]])),
    });
  }, 30_000);

  it('recovers intact workbook bytes once for each channel after the original file is gone', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
      Array.from({ length: 9960 }, (_, i) => [i, 'x'.repeat(960)]),
    ), 'Report');
    const bytes: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsm', compression: false });
    expect((bytes.length / (1024 * 1024)).toFixed(2)).toBe('9.89');
    const source = join(stateDir, 'workspace', 'report.xlsm');
    await writeFile(source, bytes);
    expect(await runPhase('plugin-uploads')).toEqual({ ok: true });
    expect(await runPhase('enqueue')).toEqual([]);
    await rm(source);
    const first = await runPhase('recover-offline');
    expect(first).toHaveLength(3);
    const retried = await runPhase('reconnect');
    expect(retried).toHaveLength(1);
    expect(retried[0].channel).toBe('wecom');
    const receipts = [...first, ...retried];
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(receipts).toHaveLength(channels.length);
    for (const channel of channels) {
      expect(receipts).toContainEqual({ channel, bytes: bytes.length, sha256 });
    }
    expect(await runPhase('recover')).toEqual([]);
    expect(await readFile(join(stateDir, 'openclaw.json'), 'utf8')).toBe(migratedConfig);
  }, 90_000);
});
