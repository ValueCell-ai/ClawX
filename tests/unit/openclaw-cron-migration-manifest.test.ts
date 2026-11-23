// @vitest-environment node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareCronInferenceMigration, prepareCronTimeoutMigration } from '@electron/utils/openclaw-cron-migration';
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
  const root = await mkdtemp(join(await realpath(tmpdir()), 'clawx-cron-evidence-'));
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
  it.each(['default', 'config', 'machine'])('loads only the active %s SQLite partition for both migrations', async selection => {
    const f = await fixture();
    const defaultStore = join(f.stateDir, 'cron', 'jobs.json');
    const customStore = join(f.root, 'custom store', 'tasks.json');
    const active = selection === 'default' ? defaultStore : customStore;
    const inactive = selection === 'default' ? customStore : defaultStore;
    if (selection !== 'default') await writeFile(f.configPath, JSON.stringify({
      ...config(), meta: { lastTouchedVersion: '2026.10.5' }, ...(selection === 'config' && { cron: { store: customStore } }),
    }));
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    const launcher = (id: string, name: string) => job(id, { name, payload: {
      kind: 'agentTurn', timeoutSeconds: 60, message: `启动独立 worker：python C:/jobs/${name}.py --start`,
    } });
    await f.sqlite('state/openclaw.sqlite', db => {
      db.exec('CREATE TABLE cron_jobs (store_key TEXT, job_id TEXT, job_json TEXT, PRIMARY KEY (store_key, job_id))');
      if (selection === 'default') db.exec('ALTER TABLE cron_jobs ADD COLUMN payload_timeout_seconds INTEGER');
      if (selection !== 'default') {
        db.exec('CREATE TABLE config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT)');
        // Explicit cron.store wins even when the database contains an older selection.
        db.prepare('INSERT INTO config_machine_state VALUES (?,?)').run('cron.store', JSON.stringify(selection === 'machine' ? active : inactive));
      }
      const insert = db.prepare('INSERT INTO cron_jobs (store_key, job_id, job_json) VALUES (?,?,?)');
      for (const [key, id, name] of [[inactive, 'shared', 'stale'], [inactive, 'retired', 'old'],
        [active, 'shared', 'current'], [active, 'independent', 'other']]) {
        insert.run(key, id, JSON.stringify(launcher(id, name)));
      }
    });
    const { entries, snapshot } = await prepare(f);
    expect(entries.map(e => e.definition)).toEqual(expect.arrayContaining([launcher('shared', 'current'), launcher('independent', 'other')]));
    expect(entries).toHaveLength(2);
    const migration = await prepareCronTimeoutMigration(snapshot.snapshotDir);
    expect(migration.eligible).toBe(2);
    const { jobs } = JSON.parse(await readFile(migration.manifestPath!, 'utf8'));
    expect(jobs.map((e: { command: string }) => e.command).sort()).toEqual([
      'python C:/jobs/current.py --start', 'python C:/jobs/other.py --start',
    ]);
  });
  it.each(['relative/jobs.json', '~/cron/jobs.json', 'missing'])('does not resurrect a stale partition or default JSON for %s', async selected => {
    const f = await fixture();
    const configured = selected === 'missing' ? join(f.root, 'missing', 'jobs.json') : selected;
    await writeFile(f.configPath, JSON.stringify({ ...config(), cron: { store: configured } }));
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    await f.json('cron/jobs.json', { jobs: [job('stale-json')] });
    await f.sqlite('state/openclaw.sqlite', db => {
      db.exec('CREATE TABLE cron_jobs (store_key TEXT, job_id TEXT, job_json TEXT, PRIMARY KEY (store_key, job_id))');
      db.prepare('INSERT INTO cron_jobs VALUES (?,?,?)').run(join(f.stateDir, 'cron', 'jobs.json'), 'stale', JSON.stringify(job('stale')));
    });
    expect((await prepare(f)).result).toEqual({ eligible: 0, skipped: 0 });
  });
  it.each([true, false])('reads only a captured custom legacy JSON store (present=%s)', async captured => {
    const f = await fixture();
    const store = join(f.stateDir, 'my-cron', 'schedules.json');
    await writeFile(f.configPath, JSON.stringify({ ...config(), cron: { store } }));
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    await f.json('cron/jobs.json', { jobs: [job('inactive')] });
    if (captured) await f.json('my-cron/schedules.json', { jobs: [job('active')] });
    expect((await prepare(f)).entries.map(e => e.jobId)).toEqual(captured ? ['active'] : []);
  });
  it('retains default legacy JSON evidence with only the original v2 file inventory', async () => {
    const f = await fixture({});
    await f.json('cron/jobs.json', { jobs: [job('old-json', { payload: {
      kind: 'agentTurn', message: '启动独立 worker：python C:/jobs/old.py --start', timeoutSeconds: 60,
    } })] });
    const { snapshotDir } = await f.snapshot();
    const marker = join(snapshotDir, 'snapshot.json');
    const manifest = JSON.parse(await readFile(marker, 'utf8'));
    delete manifest.restoreRoots;
    delete manifest.stateDir;
    delete manifest.defaultCronStorePath;
    await writeFile(marker, JSON.stringify(manifest));
    expect((await prepareCronTimeoutMigration(snapshotDir)).eligible).toBe(1);
  });
  it.each(['sqlite', 'json'])('uses captured default ownership when config and state directories differ (%s)', async storage => {
    const f = await fixture();
    const cfg = { meta: { lastTouchedVersion: '2026.7.1-2' } };
    // Both cron paths are captured under separate roots in the same snapshot.
    const configPath = await f.json('profile/custom.json', cfg);
    const stateStore = join(f.stateDir, 'cron', 'jobs.json');
    const configStore = join(dirname(configPath), 'cron', 'jobs.json');
    const jobAt = (name: string) => job('shared', { name, payload: {
      kind: 'agentTurn', message: `启动独立 worker：python C:/jobs/${name}.py --start`, timeoutSeconds: 60,
    } });
    if (storage === 'sqlite') {
      await f.sqlite('state/openclaw.sqlite', db => {
        db.exec('CREATE TABLE cron_jobs (store_key TEXT, job_id TEXT, job_json TEXT, PRIMARY KEY (store_key, job_id))');
        const insert = db.prepare('INSERT INTO cron_jobs VALUES (?, ?, ?)');
        insert.run(stateStore, 'shared', JSON.stringify(jobAt('from-state')));
        insert.run(configStore, 'shared', JSON.stringify(jobAt('from-config')));
      });
    } else {
      await f.json('cron/jobs.json', { jobs: [jobAt('from-state')] });
      await f.json('profile/cron/jobs.json', { jobs: [jobAt('from-config')] });
    }
    const { snapshotDir } = await ensureOpenClawUpgradeSnapshot({ stateDir: f.stateDir, configPath });
    const marker = join(snapshotDir, 'snapshot.json');
    const manifest = JSON.parse(await readFile(marker, 'utf8'));
    for (const [captured, expected] of [[configStore, 'from-config'], [stateStore, 'from-state'],
      [join(f.root, 'not-captured', 'jobs.json'), undefined], [undefined, undefined]] as const) {
      await writeFile(marker, JSON.stringify({ ...manifest, defaultCronStorePath: captured }));
      const result = await prepareCronTimeoutMigration(snapshotDir);
      if (expected) {
        expect(result.eligible).toBe(1);
        expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).jobs[0].definition.name).toBe(expected);
      } else {
        expect(result).toEqual({ eligible: 0 });
      }
    }
  });
  it.each([
    ['D:/Cron/old/../active/jobs.json', 'D:\\Cron\\active\\jobs.json'],
    ['//server/share/active/jobs.json', '\\\\server\\share\\active\\jobs.json'],
  ])('matches a Windows snapshot partition exactly for %s', async (store, key) => {
    const f = await fixture({ ...config(), cron: { store } });
    await f.json('agents/main/agent/auth-profiles.json', { profiles: { 'custom:default': credential() } });
    await f.sqlite('state/openclaw.sqlite', db => {
      db.exec('CREATE TABLE cron_jobs (store_key TEXT, job_id TEXT, job_json TEXT, PRIMARY KEY (store_key, job_id))');
      const insert = db.prepare('INSERT INTO cron_jobs VALUES (?,?,?)');
      insert.run(key, 'shared', JSON.stringify(job('shared', { name: 'active' })));
      insert.run(key.toUpperCase(), 'shared', JSON.stringify(job('shared', { name: 'previous key' })));
    });
    const { snapshotDir } = await f.snapshot();
    const marker = join(snapshotDir, 'snapshot.json');
    const manifest = JSON.parse(await readFile(marker, 'utf8'));
    manifest.stateDir = 'C:\\Users\\test\\.openclaw';
    await writeFile(marker, JSON.stringify(manifest));
    const result = await prepareCronInferenceMigration(snapshotDir);
    expect(result.eligible).toBe(1);
    expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).jobs[0].definition.name).toBe('active');
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
    const custom = join(await realpath(f.root), 'external-agent');
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

describe('verified historical scheduled worker deadlines', () => {
  const command = (name: string, flags = '') => 'uv run python "C:\\My Tasks\\' + name + '.py" --start' + flags;
  const legacy = (name: string, message: string, timeoutSeconds?: number, extra = {}) =>
    job(name, { payload: { kind: 'agentTurn', message, timeoutSeconds }, ...extra });
  const brief = (cmd: string) => '启动独立 worker，不等待宏完成：' + cmd + ' 。命令退出后立即结束。';
  const read = async (f: Awaited<ReturnType<typeof fixture>>) => {
    const { snapshotDir } = await f.snapshot();
    const { manifestPath } = await prepareCronTimeoutMigration(snapshotDir);
    return manifestPath ? JSON.parse(await readFile(manifestPath, 'utf8')).jobs as {
      jobId: string; command: string; timeoutSeconds: number;
    }[] : [];
  };

  it.each(['json', 'sqlite'])('keeps verified worker launchers and their custom budgets from the %s store', async storage => {
    const f = await fixture({});
    const morning = command('morning', ' --refresh-timeout-seconds 1260 --send-timeout-seconds 900');
    const afternoon = command('afternoon', ' --refresh-timeout-seconds 1260 --send-timeout-seconds 900');
    const night = command('night', ' --timeout-seconds 900');
    const jobs = [
      legacy('morning', brief(morning), 60), legacy('afternoon', brief(afternoon), 60),
      legacy('night', '固定命令一次：\n' + night + '\n命令返回后立即结束，不检查 worker 状态。', 60, { description: '独立 worker 启动器' }),
      ...[[], ['read']].map((toolsAllow, i) => legacy('no-exec-' + i, brief(night), 60, {
        payload: { kind: 'agentTurn', message: brief(night), timeoutSeconds: 60, toolsAllow },
      })),
      legacy('foreground', command('quick').replace(' --start', ''), 60), legacy('interactive', command('other'), 60),
      legacy('unbounded', brief(night), 0), legacy('custom-limit', brief(night), 4200),
      legacy('not-a-script', brief('python -c "print(1)" --start'), 60),
      legacy('wrong-mode', brief(night), 60, { sessionTarget: 'main' }),
      legacy('multiple', brief(morning) + '\n' + brief(afternoon), 60),
      legacy('shell', brief(night + ' && whoami'), 60), legacy('relative', brief('uv run python helper.py --start'), 60),
    ];
    if (storage === 'json') await f.json('cron/jobs.json', { jobs });
    else {
      await f.json('cron/jobs.json', { jobs: [legacy('stale-json', brief(night), 60)] });
      await f.sqlite('state/openclaw.sqlite', db => {
        seedCron(db, jobs);
        db.exec('ALTER TABLE cron_jobs ADD COLUMN payload_timeout_seconds INTEGER');
      });
    }
    expect((await read(f)).map(e => [e.jobId, e.command, e.timeoutSeconds])).toEqual([
      ['morning', morning, 3600], ['afternoon', afternoon, 3600], ['night', night, 3600], ['custom-limit', night, 4200],
    ]);
  });

  it('uses explicit overall signals and keeps stage flags out of the calculation', async () => {
    const f = await fixture({ meta: { lastTouchedVersion: '2026.7.1-2' } });
    await f.json('cron/jobs.json', { jobs: [
      legacy('known-short', brief(command('short', ' --total-timeout-seconds 900')), 60),
      legacy('known-long', brief(command('long', ' --overall-timeout-seconds=7200'))),
      legacy('exec-budget', brief(command('budget')) + ' exec.timeoutSeconds=4800', 60),
      legacy('stage', brief(command('stage', ' --refresh-timeout-seconds 1260'))),
      legacy('large-budget', brief(command('long', ' --total-timeout-seconds ' + '9'.repeat(100)))),
    ] });
    expect((await read(f)).map(e => e.timeoutSeconds)).toEqual([900, 7200, 4800, 3600, 2_147_000]);
  });

  it('ignores current-version snapshots before touching the cron store', async () => {
    const f = await fixture({ meta: { lastTouchedVersion: '2026.10.10' } });
    await f.json('cron/jobs.json', { jobs: [legacy('new', brief(command('new')), 60)] });
    const { snapshotDir } = await f.snapshot();
    await writeFile(join(snapshotDir, 'state-files/cron/jobs.json'), 'changed');
    expect(await prepareCronTimeoutMigration(snapshotDir)).toEqual({ eligible: 0 });
  });
});
