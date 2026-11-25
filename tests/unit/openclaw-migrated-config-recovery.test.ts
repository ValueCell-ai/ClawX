// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Snapshot {
  exists: boolean;
  valid: boolean;
  raw: string;
}

interface ConfigIO {
  readConfigFileSnapshot(): Promise<Snapshot>;
  promoteConfigSnapshotToLastKnownGood(snapshot: Snapshot): Promise<boolean>;
  prepareConfigRecovery(snapshot: Snapshot): Promise<{ apply(): Promise<void> } | null>;
  recoverConfigFromLastKnownGood(params: { snapshot: Snapshot; reason: string }): Promise<boolean>;
}

type Receipt = {
  configPath: string;
  sourceBytes: number;
  sourceHash: string;
  migratedHash: string;
  previousMigratedHash?: string;
  lastGoodHash: string;
};

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (path: string) => readFileSync(path, 'utf8');
const recoveryTimeoutMs = 90_000;

function gatewayConfig(port: number, originCount = 0, withMeta = true): string {
  return JSON.stringify({
    ...(withMeta ? { meta: { lastTouchedVersion: '2026.10.10' } } : {}),
    gateway: {
      mode: 'local',
      port,
      controlUi: {
        allowedOrigins: Array.from({ length: originCount }, (_, i) => `https://ui-${i}.example.invalid`),
      },
    },
  }, null, 2) + '\n';
}

describe('OpenClaw Doctor recovery after ClawX shrinks a valid config', () => {
  let home: string;
  let configPath: string;
  let io: ConfigIO;
  let closeStateDatabase: (() => Promise<void>) | undefined;
  let receipt: Receipt;
  const lastGood = gatewayConfig(18001, 75);
  const source = gatewayConfig(18001, 60);
  const migrated = gatewayConfig(18001);
  const backup = gatewayConfig(18002, 20);

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'clawx-doctor-migrated-'));
    const state = join(home, '.openclaw');
    mkdirSync(state);
    configPath = join(state, 'openclaw.json');
    for (const [name, value] of Object.entries({
      HOME: home, USERPROFILE: home, OPENCLAW_HOME: home,
      OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
    })) vi.stubEnv(name, value);

    // Node loads the pinned native ESM and SQLite runtime outside Vitest's transforms.
    // The installer QA also runs these cases with its extracted resources/openclaw.
    const distDir = resolve(process.env.CLAWX_TEST_OPENCLAW_DIR ?? 'node_modules/openclaw', 'dist');
    const requireNative = createRequire(import.meta.url);
    const native = requireNative(join(distDir, 'io.factory-BX1asySf.mjs'));
    closeStateDatabase = requireNative(join(distDir, 'openclaw-state-db-cache-CWsOE_KK.mjs')).closeOpenClawStateDatabaseAsync;
    io = native.t({
      configPath, env: process.env, pluginValidation: 'skip', shellEnvFallback: 'defer',
      // Doctor reads an observation-free snapshot before planning its recovery.
      observe: false,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    writeFileSync(configPath, lastGood);
    const healthy = await io.readConfigFileSnapshot();
    expect(healthy.valid).toBe(true);
    expect(await io.promoteConfigSnapshotToLastKnownGood(healthy)).toBe(true);
    expect(read(configPath + '.last-good')).toBe(lastGood);
    writeFileSync(configPath + '.bak', backup);
    writeFileSync(configPath, migrated);
    receipt = {
      configPath, sourceBytes: Buffer.byteLength(source), sourceHash: hash(source),
      migratedHash: hash(migrated), lastGoodHash: hash(lastGood),
    };
  }, recoveryTimeoutMs);

  afterEach(async () => {
    // Await the SQLite worker shutdown before deleting its WAL on Windows.
    await closeStateDatabase?.();
    vi.unstubAllEnvs();
    if (home) rmSync(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });

  function record(proof: Receipt) {
    writeFileSync(configPath + '.clawx-2026.10.10-migration.json', JSON.stringify(proof));
  }

  async function checkRecovery(expectRestore: boolean) {
    const before = read(configPath);
    const snapshot = await io.readConfigFileSnapshot();
    expect(snapshot.valid).toBe(true);
    const recovery = await io.prepareConfigRecovery(snapshot);
    expect(Boolean(recovery)).toBe(expectRestore);
    if (recovery) await recovery.apply();
    expect(read(configPath)).toBe(expectRestore ? backup : before);
    const artifacts = readdirSync(join(home, '.openclaw')).filter(name => name.startsWith('openclaw.json.clobbered.'));
    expect(artifacts).toHaveLength(expectRestore ? 1 : 0);
    if (expectRestore) expect(read(join(home, '.openclaw', artifacts[0]))).toBe(before);
  }

  it('preserves the proven migration despite the stale backup', async () => {
    expect(Buffer.byteLength(migrated)).toBeLessThan(Math.floor(Buffer.byteLength(lastGood) / 2));
    record(receipt);
    await checkRecovery(false);
    expect(await io.promoteConfigSnapshotToLastKnownGood(await io.readConfigFileSnapshot())).toBe(true);
    expect(read(configPath + '.last-good')).toBe(migrated);
  }, recoveryTimeoutMs);

  it('preserves the preceding committed migration when a later receipt was published before its config', async () => {
    record({ ...receipt, previousMigratedHash: hash(migrated), migratedHash: hash(gatewayConfig(18003)) });
    await checkRecovery(false);
  }, recoveryTimeoutMs);

  it.each([
    ['absent', () => undefined],
    ['wrong source size', (proof: Receipt) => ({ ...proof, sourceBytes: 1 })],
    ['missing a valid source hash', (proof: Receipt) => ({ ...proof, sourceHash: '' })],
    ['different config path', (proof: Receipt) => ({ ...proof, configPath: proof.configPath + '.other' })],
    ['different healthy baseline', (proof: Receipt) => ({ ...proof, lastGoodHash: hash(backup) })],
  ] as const)('restores the backup when the receipt is %s', async (_name, alter) => {
    const proof = alter(receipt);
    if (proof) record(proof);
    await checkRecovery(true);
  }, recoveryTimeoutMs);

  it('restores the backup after an external writer replaces the migrated content', async () => {
    record(receipt);
    writeFileSync(configPath, gatewayConfig(18003));
    await checkRecovery(true);
  }, recoveryTimeoutMs);

  it('restores on missing metadata even when the smaller file has a matching receipt', async () => {
    const noMeta = gatewayConfig(18001, 0, false);
    writeFileSync(configPath, noMeta);
    record({ ...receipt, migratedHash: hash(noMeta) });
    await checkRecovery(true);
  }, recoveryTimeoutMs);

  it('still recovers a corrupt JSON file from the promoted last-known-good', async () => {
    const broken = '{"gateway":';
    writeFileSync(configPath, broken);
    record({ ...receipt, migratedHash: hash(broken) });
    const snapshot = await io.readConfigFileSnapshot();
    expect(snapshot.valid).toBe(false);
    expect(await io.prepareConfigRecovery(snapshot)).toBeNull();
    expect(await io.recoverConfigFromLastKnownGood({ snapshot, reason: 'invalid configuration' })).toBe(true);
    expect(read(configPath)).toBe(lastGood);
  }, recoveryTimeoutMs);
});
