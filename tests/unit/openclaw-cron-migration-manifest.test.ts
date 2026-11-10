// @vitest-environment node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareCronInferenceMigration } from '@electron/utils/openclaw-cron-migration';
import { ensureOpenClawUpgradeSnapshot } from '@electron/utils/openclaw-upgrade-snapshot';

type JsonRecord = Record<string, unknown>;
const roots: string[] = [];
const runtime = createRequire(import.meta.url)(resolve('node_modules/openclaw/dist/clawx-cron-inference-migration.mjs')) as { stableCredentialDigest: (credential: unknown) => string };
const credential = (provider = 'custom') => ({ type: 'api_key', provider, key: `synthetic-${provider}-secret` });
const config = (provider = 'custom') => ({ agents: { defaults: { model: { primary: `${provider}/model` } } } });
const job = (id = 'legacy', extra: JsonRecord = {}) => ({
  id, name: '喝水', agentId: 'main', enabled: false, createdAtMs: 1, updatedAtMs: 2,
  schedule: { kind: 'cron', expr: '0 * * * *', tz: 'Asia/Shanghai' },
  payload: { kind: 'agentTurn', message: '提示喝水' }, sessionTarget: 'isolated',
  wakeMode: 'next-heartbeat', delivery: { mode: 'none' }, state: { lastRunAtMs: 3, lastStatus: 'ok' }, ...extra,
});
async function fixture(cfg: unknown = config()) {
  const root = await mkdtemp(join(tmpdir(), 'clawx-cron-evidence-'));
  roots.push(root);
  const stateDir = join(root, 'state');
  async function json(name: string, value: unknown) {
    const file = join(stateDir, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return file;
  }
  const configPath = await json('openclaw.json', cfg);
  async function sqlite(name: string, seed: (db: DatabaseSync) => void) {
    const file = join(stateDir, name);
    await mkdir(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    try { seed(db); } finally { db.close(); }
  }
  return { root, stateDir, configPath, json, sqlite, snapshot: () => ensureOpenClawUpgradeSnapshot({ stateDir, configPath }) };
}
function seedAuth(db: DatabaseSync, profiles: JsonRecord) {
  db.exec('CREATE TABLE auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT NOT NULL)');
  db.prepare('INSERT INTO auth_profile_store VALUES (?, ?)').run('primary', JSON.stringify({ version: 1, profiles }));
}
function seedCron(db: DatabaseSync, jobs: unknown[]) {
  db.exec('CREATE TABLE cron_jobs (job_id TEXT PRIMARY KEY, job_json TEXT NOT NULL)');
  for (const [index, entry] of jobs.entries()) db.prepare('INSERT INTO cron_jobs VALUES (?, ?)').run(String(index), JSON.stringify(entry));
}
function seedSharedAuth(db: DatabaseSync, profiles: JsonRecord, owner = 'state-db') {
  db.exec('CREATE TABLE config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO config_machine_state VALUES (?, ?)');
  insert.run('auth.sharedStore', JSON.stringify({ location: owner }));
  insert.run('authProfiles.store', JSON.stringify({ version: 1, profiles }));
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = await f.snapshot();
  const result = await prepareCronInferenceMigration(snapshot.snapshotDir);
  const raw = result.manifestPath ? await readFile(result.manifestPath, 'utf8') : '';
  return { snapshot, result, raw, entries: raw ? JSON.parse(raw).jobs as JsonRecord[] : [] };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('legacy cron migration snapshot evidence', () => {
  it.each(['custom', 'custom-enterpri'])('preserves %s jobs and canonical runtime digests without copying secrets', async provider => {
    const f = await fixture(config(provider));
    const saved = job();
    const auth = { ...credential(provider), Z: 'upper', a: { Z: 1, a: 2 } };
    await f.json('cron/jobs.json', { jobs: [saved] });
    await f.json('agents/main/agent/auth-profiles.json', { version: 1, profiles: { [`${provider}:default`]: auth } });
    const { result, entries, raw, snapshot } = await prepare(f);
    expect(result).toMatchObject({ eligible: 1, skipped: 0 });
    expect(entries).toEqual([{ jobId: saved.id, definition: saved, agentId: 'main', model: `${provider}/model`, profileId: `${provider}:default`, credentialDigest: runtime.stableCredentialDigest(auth) }]);
    expect(raw).not.toContain(auth.key);
    expect(relative(snapshot.snapshotDir, result.manifestPath!)).toMatch(/^\.\./);
    expect(await prepareCronInferenceMigration(snapshot.snapshotDir)).toEqual(result);
    expect(await readFile(result.manifestPath!, 'utf8')).toBe(raw);
  });
  it('uses SQLite tasks and credentials over conflicting legacy JSON', async () => {
    const f = await fixture();
    const canonical = { ...credential(), key: 'canonical-key' };
    await f.json('cron/jobs.json', { jobs: [job('stale')] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:stale': credential() } });
    await f.sqlite('state/openclaw.sqlite', db => seedCron(db, [job('canonical')]));
    await f.sqlite('agents/main/agent/openclaw-agent.sqlite', db => seedAuth(db, { 'custom:canonical': canonical }));
    const { entries } = await prepare(f);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ jobId: 'canonical', profileId: 'custom:canonical', credentialDigest: runtime.stableCredentialDigest(canonical) });
  });
  it.each(['jobs', 'profiles'])('does not resurrect stale JSON when the canonical %s are empty', async empty => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job()] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    if (empty === 'jobs') await f.sqlite('state/openclaw.sqlite', db => seedCron(db, []));
    else await f.sqlite('agents/main/agent/openclaw-agent.sqlite', db => seedAuth(db, {}));
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: empty === 'jobs' ? 0 : 1 });
  });
  it('resolves secondary local profiles and inherited credentials from the historical shared owner', async () => {
    const f = await fixture({ agents: { default: 'research', defaults: { model: 'custom/model' }, entries: { research: { model: 'secondary/research' }, inherited: {} } } });
    await f.sqlite('state/openclaw.sqlite', db => {
      seedCron(db, [job('secondary', { agentId: 'research' }), job('inherited', { agentId: 'inherited' })]);
      seedSharedAuth(db, { 'custom:shared': credential() });
    });
    await f.sqlite('agents/main/agent/openclaw-agent.sqlite', db => seedAuth(db, { 'custom:stale': credential() }));
    await f.sqlite('agents/research/agent/openclaw-agent.sqlite', db => seedAuth(db, { 'secondary:local': credential('secondary') }));
    expect((await prepare(f)).entries.map(entry => [entry.jobId, entry.agentId, entry.model, entry.profileId])).toEqual([
      ['secondary', 'research', 'secondary/research', 'secondary:local'], ['inherited', 'inherited', 'custom/model', 'custom:shared'],
    ]);
  });
  it('respects legacy main ownership before the shared-store migration', async () => {
    const f = await fixture();
    await f.sqlite('state/openclaw.sqlite', db => { seedCron(db, [job()]); seedSharedAuth(db, { 'custom:stale': credential() }, 'legacy-main'); });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:legacy': credential() } });
    expect((await prepare(f)).entries[0].profileId).toBe('custom:legacy');
  });
  it.each(['json', 'sqlite'].flatMap(storage => ['agent:main:cron:legacy', 'cron:legacy'].map(key => [storage, key])))('does not infer agent-default ownership over a historical %s session %s override', async (storage, key) => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job()] });
    const entry = { modelOverride: 'other-model', providerOverride: 'custom', authProfileOverride: 'custom:other' };
    if (storage === 'sqlite') await f.sqlite('agents/main/agent/openclaw-agent.sqlite', db => {
      seedAuth(db, { 'custom:default': credential() });
      db.exec('CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)');
      db.prepare('INSERT INTO session_nodes VALUES (?,?)').run(key, JSON.stringify(entry));
    });
    else {
      await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
      await f.json('agents/main/sessions/sessions.json', { [key]: entry });
    }
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 1 });
  });
  it.each(['json', 'sqlite'].flatMap(storage => ['agent:main:cron:legacy', 'cron:legacy'].map(key => [storage, key])))('retains the water-task automatic account pin from historical %s session %s', async (storage, key) => {
    const f = await fixture(config('custom-enterpri'));
    await f.json('cron/jobs.json', { jobs: [job()] });
    const profiles = { 'custom-enterpri:default': credential('custom-enterpri') };
    const entry = { model: 'old-model', modelProvider: 'custom-enterpri', authProfileOverride: 'custom-enterpri:default', authProfileOverrideSource: 'auto', authProfileOverrideCompactionCount: 0 };
    if (storage === 'sqlite') await f.sqlite('agents/main/agent/openclaw-agent.sqlite', db => {
      seedAuth(db, profiles);
      db.exec('CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)');
      db.prepare('INSERT INTO session_nodes VALUES (?,?)').run(key, JSON.stringify(entry));
    });
    else {
      await f.json('agents/main/agent/auth-profiles.json', { profiles });
      await f.json('agents/main/sessions/sessions.json', { [key]: entry });
    }
    const { result, entries } = await prepare(f);
    expect(result).toMatchObject({ eligible: 1, skipped: 0 });
    expect(entries[0].profileId).toBe('custom-enterpri:default');
  });
  it.each([{ profile: 'custom:other', source: 'auto' }, { profile: 'custom:default', source: 'user' }])('rejects a conflicting or explicit historical profile pin (%j)', async ({ profile, source }) => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job()] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    await f.json('agents/main/sessions/sessions.json', { 'agent:main:cron:legacy': { authProfileOverride: profile, authProfileOverrideSource: source } });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 1 });
  });
  it.each(['lock', 'gmail', 'custom-store'])('skips unsupported historical %s selection authority', async kind => {
    const f = await fixture({ ...config(), ...(kind === 'gmail' ? { hooks: { gmail: { model: 'custom/mail-model' } } } : {}) });
    if (kind === 'custom-store') {
      await mkdir(join(f.root, 'custom-sessions'));
      await writeFile(f.configPath, JSON.stringify({ ...config(), session: { store: join(f.root, 'custom-sessions/sessions.json') } }));
    }
    await f.json('cron/jobs.json', { jobs: [job('legacy', kind === 'gmail' ? { payload: { kind: 'agentTurn', message: 'mail', externalContentSource: 'gmail', model: ' ' } } : {})] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    if (kind === 'lock') await f.json('agents/main/sessions/sessions.json', { 'agent:main:cron:legacy': { modelSelectionLocked: true } });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 1 });
  });
  it('keeps distinct shared and local accounts ambiguous while allowing explicit inherited selection', async () => {
    const f = await fixture({ agents: { defaults: { model: 'custom/model' }, entries: { research: {} } } });
    await f.sqlite('state/openclaw.sqlite', db => {
      seedCron(db, [job('ambiguous', { agentId: 'research' }), job('explicit', { agentId: 'research', payload: { kind: 'agentTurn', message: 'water', model: 'custom/model@custom:shared' } })]);
      seedSharedAuth(db, { 'custom:shared': credential() });
    });
    await f.sqlite('agents/research/agent/openclaw-agent.sqlite', db => seedAuth(db, { 'custom:local': { ...credential(), key: 'local-key' } }));
    const { result, entries } = await prepare(f);
    expect(result).toMatchObject({ eligible: 1, skipped: 1 });
    expect(entries[0]).toMatchObject({ jobId: 'explicit', profileId: 'custom:shared' });
  });
  it('uses historical isolated-run subagent model precedence', async () => {
    const f = await fixture({ agents: { defaults: { model: 'custom/ordinary', subagents: { model: 'custom/default-subagent' } }, entries: { research: { model: 'custom/agent', subagents: { model: 'custom/agent-subagent' } } } } });
    await f.json('cron/jobs.json', { jobs: [job('default-subagent'), job('agent-subagent', { agentId: 'research' }), job('explicit', { agentId: 'research', payload: { kind: 'agentTurn', message: 'water', model: 'custom/explicit' } })] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    expect((await prepare(f)).entries.map(entry => entry.model)).toEqual(['custom/default-subagent', 'custom/agent-subagent', 'custom/explicit']);
  });
  it('requires a unique account unless the task explicitly selected a profile', async () => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job('ambiguous'), job('explicit', { payload: { kind: 'agentTurn', message: 'water', model: 'custom/special@custom:two' } })] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:one': credential(), 'custom:two': { ...credential(), key: 'two-key' } } });
    const { result, entries } = await prepare(f);
    expect(result).toMatchObject({ eligible: 1, skipped: 1 });
    expect(entries[0]).toMatchObject({ jobId: 'explicit', model: 'custom/special', profileId: 'custom:two' });
  });
  it('does not pick the first agent for ownerless tasks in an ambiguous historical roster', async () => {
    const f = await fixture({ agents: { defaults: { model: 'custom/model' }, entries: { main: {}, research: {} } } });
    await f.json('cron/jobs.json', { jobs: [job('ownerless', { agentId: undefined })] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 1 });
  });
  it('uses literal historical inline keys only for their managed default profile', async () => {
    const f = await fixture({ ...config(), models: { providers: { custom: { apiKey: 'inline-old-key' } } } });
    await f.json('cron/jobs.json', { jobs: [job()] });
    const { entries, raw } = await prepare(f);
    expect(entries[0]).toMatchObject({ profileId: 'custom:default', credentialDigest: runtime.stableCredentialDigest({ type: 'api_key', provider: 'custom', key: 'inline-old-key' }) });
    expect(raw).not.toContain('inline-old-key');
  });
  it.each(['${CUSTOM_API_KEY}', { source: 'env', id: 'CUSTOM_API_KEY' }])('does not use unresolved secret references (%j)', async apiKey => {
    const f = await fixture({ ...config(), models: { providers: { custom: { apiKey } } } });
    await f.json('cron/jobs.json', { jobs: [job()] });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 1 });
  });
  it('skips system jobs, main sessions and already-owned jobs including malformed ownership markers', async () => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job('bound', { inferenceBinding: {} }), job('null', { inferenceBinding: null }), job('authority', { runtimeAuthority: {} }), job('system', { declarationKey: 'managed' }), job('empty-marker', { declarationKey: '' }), job('main', { sessionTarget: 'main' }), job('session', { sessionTarget: 'session:agent:main:main' }), job('event', { payload: { kind: 'systemEvent', text: 'tick' } })] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 0 });
  });
  it('rejects a corrupted snapshot file', async () => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job()] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    const snapshot = await f.snapshot();
    await writeFile(join(snapshot.snapshotDir, 'agents/main/agent/auth-profiles.json'), '{}');
    await expect(prepareCronInferenceMigration(snapshot.snapshotDir)).rejects.toThrow('integrity check failed');
  });
  it('reads custom agent directories through captured roots without consulting current credentials', async () => {
    const f = await fixture();
    const custom = join(f.stateDir, 'agents/research/private-auth');
    await writeFile(f.configPath, JSON.stringify({ agents: { defaults: { model: 'custom/model' }, entries: { research: { agentDir: custom } } } }));
    await f.json('cron/jobs.json', { jobs: [job('custom-dir', { agentId: 'research' })] });
    await f.json('agents/research/private-auth/auth-profiles.json', { profiles: { 'custom:captured': credential() } });
    const snapshot = await f.snapshot();
    await f.json('agents/research/private-auth/auth-profiles.json', { profiles: { 'custom:live': credential() } });
    const result = await prepareCronInferenceMigration(snapshot.snapshotDir);
    expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).jobs[0].profileId).toBe('custom:captured');
  });
  it('rejects directory links escaping the snapshot even when the file hash still matches', async () => {
    const f = await fixture();
    await f.json('cron/jobs.json', { jobs: [job()] });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    const snapshot = await f.snapshot();
    const outside = join(f.root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'auth-profiles.json'), await readFile(join(snapshot.snapshotDir, 'agents/main/agent/auth-profiles.json')));
    const target = join(snapshot.snapshotDir, 'agents/main/agent');
    await rm(target, { recursive: true });
    await symlink(await realpath(outside), target, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareCronInferenceMigration(snapshot.snapshotDir)).rejects.toThrow('Unsafe cron migration snapshot path');
  });
  it('rejects path traversal in restore-root metadata', async () => {
    const f = await fixture();
    const custom = join(f.root, 'external-agent');
    await writeFile(f.configPath, JSON.stringify({ agents: { defaults: { model: 'custom/model' }, entries: { research: { agentDir: custom } } } }));
    await f.json('cron/jobs.json', { jobs: [job('traversal', { agentId: 'research' })] });
    await mkdir(custom);
    const authFile = join(custom, 'auth-profiles.json');
    await writeFile(authFile, JSON.stringify({ profiles: { 'custom:default': credential() } }));
    const snapshot = await f.snapshot();
    const markerPath = join(snapshot.snapshotDir, 'snapshot.json');
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    const outsidePath = relative(snapshot.snapshotDir, authFile);
    marker.restoreRoots.find((entry: { source: string }) => entry.source === custom).backup = dirname(outsidePath);
    marker.fileInfo[outsidePath] = { sha256: createHash('sha256').update(await readFile(authFile)).digest('hex') };
    await writeFile(markerPath, JSON.stringify(marker));
    await expect(prepareCronInferenceMigration(snapshot.snapshotDir)).rejects.toThrow('Unsafe cron migration snapshot path');
  });
});
