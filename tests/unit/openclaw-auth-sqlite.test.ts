// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertBundledAgentStructure, getBundledAgentSchema } from '@electron/utils/openclaw-persistence-runtime';
const { testHome } = vi.hoisted(() => ({ testHome: `/tmp/clawx-auth-sqlite-${Math.random().toString(36).slice(2)}` }));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});
const store = { version: 1, profiles: { 'custom:default': { type: 'api_key', provider: 'custom', key: 'synthetic-key' } } };
const dbPath = () => join(testHome, '.openclaw/agents/main/agent/openclaw-agent.sqlite');
async function seed(version: number, marker = version, appVersion = '2026.10.5') {
  await mkdir(join(dbPath(), '..'), { recursive: true });
  const db = new DatabaseSync(dbPath());
  db.exec(getBundledAgentSchema(version));
  db.prepare("INSERT INTO schema_meta VALUES ('primary', 'agent', ?, 'main', ?, 1, 1)").run(marker, appVersion);
  db.exec(`PRAGMA user_version = ${marker}`);
  db.prepare("INSERT INTO auth_profile_store VALUES ('primary', ?, 1)").run(JSON.stringify(store));
  db.close();
}
const statePath = () => join(testHome, '.openclaw/state/openclaw.sqlite');
async function seedSharedState(owner: unknown, cells: Record<string, unknown> = {}) {
  await mkdir(join(statePath(), '..'), { recursive: true });
  const db = new DatabaseSync(statePath());
  db.exec('CREATE TABLE config_machine_state (state_key TEXT NOT NULL PRIMARY KEY, value_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)');
  const insert = db.prepare('INSERT INTO config_machine_state VALUES (?, ?, 1)');
  insert.run('auth.sharedStore', JSON.stringify(owner));
  for (const [key, value] of Object.entries(cells)) insert.run(key, JSON.stringify(value));
  db.close();
}
function sharedCell(key: string) {
  const db = new DatabaseSync(statePath(), { readOnly: true });
  try {
    const row = db.prepare('SELECT value_json FROM config_machine_state WHERE state_key = ?').get(key) as { value_json?: string } | undefined;
    return row?.value_json ? JSON.parse(row.value_json) : undefined;
  } finally { db.close(); }
}
function inspect(file = dbPath()) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { version: db.prepare('PRAGMA user_version').get()?.user_version, meta: db.prepare("SELECT * FROM schema_meta WHERE meta_key='primary'").get() }; }
  finally { db.close(); }
}
describe('OpenClaw auth SQLite ownership', () => {
  beforeEach(async () => { vi.resetModules(); await rm(testHome, { recursive: true, force: true }); });
  afterAll(async () => { await rm(testHome, { recursive: true, force: true }); });
  it('imports legacy JSON credentials and preserves state references', async () => {
    const dir = join(dbPath(), '..');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'auth-profiles.json'), JSON.stringify({ ...store, order: { custom: ['custom:default'] } }));
    const api = await import('@electron/utils/openclaw-auth-sqlite');
    expect(await api.migrateAuthProfilesJsonToSqliteIfNeeded('main')).toBe(true);
    expect(api.readAuthProfilesFromSqlite('main')?.order).toEqual({ custom: ['custom:default'] });
    expect(await api.migrateAuthProfilesJsonToSqliteIfNeeded('main')).toBe(false);
  }, 20_000);
  it('saves credentials to SQLite without leaving a retired JSON source behind', async () => {
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    const { readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    await saveProviderKeyToOpenClaw('custom', 'synthetic-key', 'main');
    expect(readAuthProfilesFromSqlite('main')?.profiles['custom:default'].key).toBe('synthetic-key');
    expect(existsSync(join(dbPath(), '../auth-profiles.json'))).toBe(false);
  });
  it('keeps JSON as the Doctor import source while the agent schema migration is pending', async () => {
    await seed(16);
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await saveProviderKeyToOpenClaw('custom', 'pending-key', 'main');
    expect(JSON.parse(await readFile(join(dbPath(), '../auth-profiles.json'), 'utf8')).profiles['custom:default'].key).toBe('pending-key');
  });
  it('creates a complete current schema immediately usable by the bundled runtime', async () => {
    const { writeAuthProfilesToSqlite, initializeAgentAuthDatabase } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite(store, 'main');
    expect(inspect().version).toBe(25);
    const db = new DatabaseSync(dbPath(), { readOnly: true });
    try { expect(() => assertBundledAgentStructure(db, dbPath(), 25)).not.toThrow(); }
    finally { db.close(); }
    const before = await readFile(dbPath());
    initializeAgentAuthDatabase('main');
    expect(await readFile(dbPath())).toEqual(before);
  }, 20_000);
  it('does not modify schema metadata while writing to a current database', async () => {
    await seed(25);
    const before = inspect();
    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite(store, 'main');
    expect(inspect()).toEqual(before);
  });
  it('preserves a genuine interrupted v16 structure and refuses pre-migration auth writes', async () => {
    await seed(16);
    const before = inspect();
    const { repairOpenClawOwnedAgentSchema, writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');
    expect(() => writeAuthProfilesToSqlite(store, 'main')).toThrow('schema migration is pending');
    expect(inspect()).toEqual(before);
  });
  it('does not mistake a v16 structure clobbered to v1 for a completed migration', async () => {
    await seed(16, 1);
    const { repairOpenClawOwnedAgentSchema } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');
    expect(inspect().version).toBe(1);
    expect(existsSync(`${dbPath()}.clawx-before-schema-repair`)).toBe(false);
  });
  it('repairs only verified v25 structure clobbered to v1, with a recoverable copy', async () => {
    await seed(25, 1);
    const { repairOpenClawOwnedAgentSchema, readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');
    expect(inspect().version).toBe(25);
    expect(inspect().meta?.schema_version).toBe(25);
    expect(inspect(`${dbPath()}.clawx-before-schema-repair`).version).toBe(1);
    expect(readAuthProfilesFromSqlite('main')?.profiles).toEqual(store.profiles);
    repairOpenClawOwnedAgentSchema('main');
    expect(inspect(`${dbPath()}.clawx-before-schema-repair`).version).toBe(1);
  });
  it('preserves future schema markers during repair and rejects auth writes', async () => {
    await seed(25, 26, '2026.10.10');
    const before = await readFile(dbPath());
    const { repairOpenClawOwnedAgentSchema, writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');
    expect(() => writeAuthProfilesToSqlite(store, 'main')).toThrow('newer OpenClaw');
    expect(await readFile(dbPath())).toEqual(before);
  }, 20_000);
  it('reads main credentials relocated by OpenClaw Doctor into shared state', async () => {
    await seed(25);
    const db = new DatabaseSync(dbPath());
    db.exec('DELETE FROM auth_profile_store');
    db.close();
    await seedSharedState({ location: 'state-db' }, {
      'authProfiles.store': store,
      'authProfiles.state': { version: 1, lastGood: { custom: 'custom:default' } },
    });
    const { getProviderApiKeyFromOpenClaw } = await import('@electron/utils/openclaw-auth');
    const { readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    expect(readAuthProfilesFromSqlite('main')?.lastGood).toEqual({ custom: 'custom:default' });
    expect(await getProviderApiKeyFromOpenClaw('custom', 'main')).toBe('synthetic-key');
  });
  it('writes main credentials to shared state and retires the JSON that would block them', async () => {
    await seedSharedState({ location: 'state-db' });
    const jsonPath = join(dbPath(), '../auth-profiles.json');
    await mkdir(join(jsonPath, '..'), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(store));
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    await saveProviderKeyToOpenClaw('custom', 'rotated-key', 'main');
    expect(sharedCell('authProfiles.store').profiles['custom:default'].key).toBe('rotated-key');
    expect(existsSync(dbPath())).toBe(false);
    expect(existsSync(jsonPath)).toBe(false);
    expect((await readdir(join(jsonPath, '..'))).some((name) => name.startsWith('auth-profiles.json.clawx-retired-'))).toBe(true);
  });
  it('imports credentials missing from shared state before retiring a leftover JSON', async () => {
    const kept = { type: 'api_key', provider: 'kept', key: 'shared-key' };
    await seedSharedState({ location: 'state-db' }, {
      'authProfiles.store': { version: 1, profiles: { 'kept:default': kept, 'custom:default': { ...store.profiles['custom:default'], key: 'shared-wins' } } },
    });
    const jsonPath = join(dbPath(), '../auth-profiles.json');
    await mkdir(join(jsonPath, '..'), { recursive: true });
    const added = { type: 'api_key', provider: 'added', key: 'json-only-key' };
    await writeFile(jsonPath, JSON.stringify({ version: 1, profiles: { ...store.profiles, 'added:default': added } }));
    const { migrateAuthProfilesJsonToSqliteIfNeeded } = await import('@electron/utils/openclaw-auth-sqlite');
    expect(await migrateAuthProfilesJsonToSqliteIfNeeded('main')).toBe(true);
    const profiles = sharedCell('authProfiles.store').profiles;
    expect(profiles['custom:default'].key).toBe('shared-wins');
    expect(profiles['added:default']).toEqual(added);
    expect(profiles['kept:default']).toEqual(kept);
    expect(existsSync(jsonPath)).toBe(false);
    expect(await migrateAuthProfilesJsonToSqliteIfNeeded('main')).toBe(false);
  });
  it('keeps main credentials in the agent database until OpenClaw relocates them', async () => {
    await seed(25);
    await seedSharedState({ location: 'legacy-main' });
    const { writeAuthProfilesToSqlite, readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite(store, 'main');
    expect(sharedCell('authProfiles.store')).toBeUndefined();
    expect(readAuthProfilesFromSqlite('main')?.profiles).toEqual(store.profiles);
  });
  it('refuses auth writes when the shared owner marker is invalid', async () => {
    await seedSharedState({ location: 'elsewhere' });
    const { writeAuthProfilesToSqlite, readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    expect(() => writeAuthProfilesToSqlite(store, 'main')).toThrow('Invalid auth.sharedStore owner');
    expect(readAuthProfilesFromSqlite('main')).toBeNull();
    expect(existsSync(dbPath())).toBe(false);
  });
  it('refuses cross-agent writes', async () => {
    await seed(25);
    const db = new DatabaseSync(dbPath());
    db.exec("UPDATE schema_meta SET agent_id='other' WHERE meta_key='primary'");
    db.close();
    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    expect(() => writeAuthProfilesToSqlite(store, 'main')).toThrow('owner mismatch');
  });
});
