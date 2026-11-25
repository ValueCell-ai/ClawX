// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mutateOpenClawConfig, resetOpenClawConfigCoordinatorForTests } from '@electron/gateway/config-delivery';
import { prepareConfigMigrationReceipt } from '@electron/utils/config-migration-receipt';
import { syncProxyConfigToOpenClaw } from '@electron/utils/openclaw-proxy';
import { sanitizeOpenClawConfig } from '@electron/utils/openclaw-auth';

const { lstatMock } = vi.hoisted(() => ({ lstatMock: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: lstatMock.mockImplementation(actual.lstat) };
});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const encode = (o: unknown) => JSON.stringify(o, null, 2) + '\n';
const old = {
  gateway: { mode: 'local' }, agents: { defaults: {}, list: [{ id: 'main' }] }, models: { providers: {} },
  channels: { 'dingtalk-connector': { accounts: { default: { fixture: 'q'.repeat(600) } } } },
  plugins: { allow: ['dingtalk-connector'], entries: { 'dingtalk-connector': { enabled: true } } },
  authoredSetting: 'preserve',
};
const provider = 'custom-enterpri';
const primary = provider + '/fixture';
const good = {
  ...old, channels: { dingtalk: old.channels['dingtalk-connector'] },
  plugins: { allow: ['dingtalk'], entries: { dingtalk: { enabled: true } } },
  agents: { defaults: { model: primary, models: { [primary]: {} } }, list: [{ id: 'main', model: { primary, fallbacks: [] } }] },
  models: { providers: { [provider]: { models: [{ id: 'fixture' }] } } },
};
let state: string, config: string, receipt: string, snapshot: string;
const oldRaw = encode(old), goodRaw = encode(good);

async function installSnapshot(initial = oldRaw, healthy = goodRaw) {
  const configKey = join('config', basename(config)), goodKey = join('state-files', basename(config) + '.last-good');
  const files = [configKey, goodKey];
  await Promise.all([mkdir(join(snapshot, 'config'), { recursive: true }), mkdir(join(snapshot, 'state-files'), { recursive: true })]);
  await Promise.all([
    writeFile(config, initial), writeFile(config + '.last-good', healthy),
    writeFile(join(snapshot, configKey), initial), writeFile(join(snapshot, goodKey), healthy),
    writeFile(join(snapshot, 'snapshot.json'), encode({
      upgrade: 'openclaw-2026.10.10', formatVersion: 2, stateDir: state, configPath: config, files,
      fileInfo: { [configKey]: { sha256: sha(initial) }, [goodKey]: { sha256: sha(healthy) } },
    })),
  ]);
}
beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), 'clawx-migration-receipt-'));
  config = join(state, 'openclaw.json');
  receipt = config + '.clawx-2026.10.10-migration.json';
  snapshot = join(state, 'backups', 'clawx-openclaw-2026.10.10-pre-migration');
  vi.stubEnv('OPENCLAW_STATE_DIR', state);
  vi.stubEnv('OPENCLAW_CONFIG_PATH', config);
  vi.stubEnv('USERPROFILE', state);
  vi.stubEnv('HOME', state);
});
afterEach(async () => {
  resetOpenClawConfigCoordinatorForTests();
  vi.unstubAllEnvs();
  await rm(state, { recursive: true, force: true });
});

it('attests the exact committed bytes of marked offline transactions and refuses an ordinary write as a successor', async () => {
  await installSnapshot();
  await mutateOpenClawConfig(c => { c.plugins = good.plugins; c.channels = good.channels; }, { prelaunchMigration: true });
  const first = await readFile(config, 'utf8');
  expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual({
    configPath: config, lastGoodHash: sha(goodRaw), sourceBytes: Buffer.byteLength(oldRaw), sourceHash: sha(oldRaw), migratedHash: sha(first),
  });
  await mutateOpenClawConfig(c => { c.browser = { enabled: true }; }, { prelaunchMigration: true });
  const second = await readFile(config, 'utf8'), proven = await readFile(receipt, 'utf8');
  expect(JSON.parse(proven)).toMatchObject({ previousMigratedHash: sha(first), migratedHash: sha(second) });
  await mutateOpenClawConfig(c => { c.authoredSetting = 'user changed'; });
  await mutateOpenClawConfig(c => { c.browser = { enabled: false }; }, { prelaunchMigration: true });
  expect(await readFile(receipt, 'utf8')).toBe(proven);
});

it('can retry a prepared write after a crash before either config rename', async () => {
  await installSnapshot();
  const first = encode({ ...old, channels: good.channels }), second = encode({ ...good, browser: {} });
  await prepareConfigMigrationReceipt(config, state, oldRaw, first);
  await prepareConfigMigrationReceipt(config, state, oldRaw, first);
  await writeFile(config, first);
  await prepareConfigMigrationReceipt(config, state, first, second);
  const alternative = encode({ ...good, browser: { enabled: true } });
  await prepareConfigMigrationReceipt(config, state, first, alternative);
  expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({ previousMigratedHash: sha(first), migratedHash: sha(alternative) });
});

it.each(['preserved', 'changed', 'removed'])('protects a mixed catalog only if user model aliases are preserved: %s', async variant => {
  const foreign = { 'local/user': { alias: 'u' } };
  const sourceAliases = variant === 'preserved' ? foreign : variant === 'changed' ? { 'local/user': { alias: 'new' } } : {};
  const mixed = encode({ ...good, agents: { ...good.agents, defaults: { ...good.agents.defaults, models: { ...good.agents.defaults.models, ...foreign } } } });
  const source = encode({ ...old, agents: { ...old.agents, defaults: { models: sourceAliases } } });
  await installSnapshot(source, mixed);
  await prepareConfigMigrationReceipt(config, state, source, oldRaw);
  if (variant === 'preserved') expect(JSON.parse(await readFile(receipt, 'utf8')).sourceHash).toBe(sha(source));
  else await expect(readFile(receipt)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['prelaunch', 'settings'])('scopes a Telegram proxy write before the actual sanitizer: %s', async origin => {
  const telegram = { enabled: true };
  const source = encode({ ...old, channels: { ...old.channels, telegram } });
  const healthy = encode({ ...good, channels: { ...good.channels, telegram } });
  await installSnapshot(source, healthy);
  await syncProxyConfigToOpenClaw({
    proxyEnabled: true, proxyServer: '127.0.0.1:8123', proxyHttpServer: '', proxyHttpsServer: '', proxyAllServer: '', proxyBypassRules: '',
  }, origin === 'prelaunch' ? { preserveExistingWhenDisabled: true, prelaunchMigration: true } : { preserveExistingWhenDisabled: false });
  const beforeSanitize = await readFile(config, 'utf8');
  expect(JSON.parse(beforeSanitize).channels.telegram.proxy).toBe('http://127.0.0.1:8123');
  await sanitizeOpenClawConfig();
  const next = await readFile(config, 'utf8');
  expect(JSON.parse(next).channels.dingtalk.accounts.default).toEqual(old.channels['dingtalk-connector'].accounts.default);
  if (origin === 'prelaunch') {
    expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({
      sourceHash: sha(source), lastGoodHash: sha(healthy), previousMigratedHash: sha(beforeSanitize), migratedHash: sha(next),
    });
  } else await expect(readFile(receipt)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('can begin a fresh proven migration over a stale receipt for a custom config basename', async () => {
  config = join(state, 'personal.json');
  receipt = config + '.clawx-2026.10.10-migration.json';
  await installSnapshot();
  await writeFile(receipt, encode({ configPath: join(state, 'other-old.json'), sourceHash: sha('old') }));
  const next = encode({ ...old, channels: good.channels });
  await prepareConfigMigrationReceipt(config, state, oldRaw, next);
  expect(JSON.parse(await readFile(receipt, 'utf8'))).toMatchObject({ configPath: config, sourceHash: sha(oldRaw), migratedHash: sha(next) });
});

it('commits normal prelaunch configuration while optional evidence is inaccessible', async () => {
  await installSnapshot();
  lstatMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await mutateOpenClawConfig(c => { c.browser = { enabled: true }; }, { prelaunchMigration: true });
  expect(JSON.parse(await readFile(config, 'utf8')).browser.enabled).toBe(true);
  await expect(readFile(receipt)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['unrelated-field', 'credential', 'tiny-source', 'wrong-input', 'moved-config', 'changed-live-last-good', 'altered-snapshot', 'no-legacy'])(
  'keeps native recovery for %s', async variant => {
    let raw = oldRaw, healthy = goodRaw;
    if (variant === 'unrelated-field') raw = encode({ ...old, authoredSetting: undefined });
    if (variant === 'credential') raw = oldRaw.replace('q'.repeat(600), 'z'.repeat(600));
    if (variant === 'tiny-source') healthy = encode({ ...good, models: { providers: { [provider]: { models: [{ id: 'fixture' }], padded: 'q'.repeat(4_000) } } } });
    if (variant === 'no-legacy') raw = healthy = encode({ ...good, agents: { entries: { main: {} } } });
    await installSnapshot(raw, healthy);
    if (variant === 'changed-live-last-good') await writeFile(config + '.last-good', healthy + ' ');
    if (variant === 'altered-snapshot') await writeFile(join(snapshot, 'config', 'openclaw.json'), raw + ' ');
    await prepareConfigMigrationReceipt(variant === 'moved-config' ? join(state, 'other.json') : config, state,
      variant === 'wrong-input' ? raw + ' ' : raw, encode({ ...old, channels: good.channels }));
    await expect(readFile(receipt)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
