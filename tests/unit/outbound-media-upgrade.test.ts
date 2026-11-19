// @vitest-environment node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixupPluginManifest } from '@electron/utils/plugin-install';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => tmpdir() } }));

const packages = {
  wecom: '@wecom/wecom-openclaw-plugin',
  'openclaw-weixin': '@tencent-weixin/openclaw-weixin',
  dingtalk: '@dingtalk-real-ai/dingtalk-connector',
  'feishu-openclaw-plugin': '@openclaw/feishu',
};
const channels = ['wecom', 'openclaw-weixin', 'dingtalk', 'feishu'];
const legacyConfig = JSON.stringify({ channels: Object.fromEntries(channels.map(c => [c, { enabled: true }])) });
let stateDir: string;
async function runPhase(phase: string) {
  const { stdout } = await promisify(execFile)(process.execPath, [resolve('tests/fixtures/outbound-media-upgrade.mjs'), phase], {
    env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_HOME: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, 'openclaw.json') },
  });
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}

describe('outbound attachments after upgrading an existing profile', () => {
  beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'clawx-outbound-upgrade-'));
    await mkdir(join(stateDir, 'workspace'));
    await writeFile(join(stateDir, 'openclaw.json'), legacyConfig);
    // The runtime scans the same manifests the installer writes; no test cap is injected.
    for (const [mirror, name] of Object.entries(packages)) {
      const source = resolve('node_modules', name);
      const target = join(stateDir, 'extensions', mirror);
      await mkdir(target, { recursive: true });
      for (const file of ['package.json', 'openclaw.plugin.json']) {
        await copyFile(join(source, file), join(target, file));
      }
      const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      const { extensions, runtimeExtensions = [], runtimeSetupEntry, setupEntry } = pkg.openclaw;
      for (const entry of new Set<string>([...extensions, ...runtimeExtensions, runtimeSetupEntry, setupEntry].filter(Boolean))) {
        await mkdir(dirname(join(target, entry)), { recursive: true });
        await writeFile(join(target, entry), "throw new Error('Static manifest lookup must not run the channel');\n");
      }
      fixupPluginManifest(target);
    }
  });
  afterAll(async () => { if (stateDir) await rm(stateDir, { recursive: true, force: true }); });

  it('resolves installed channel capabilities with account, channel and agent overrides in order', async () => {
    expect(await runPhase('limits')).toEqual({
      defaults: { wecom: 20, feishu: 30, 'openclaw-weixin': 100, dingtalk: 20, telegram: 100, 'unknown-channel': 5 },
      configured: Object.fromEntries(channels.map(c => [c, [7, 128, 5]])),
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
    expect(await readFile(join(stateDir, 'openclaw.json'), 'utf8')).toBe(legacyConfig);
  }, 90_000);
});
