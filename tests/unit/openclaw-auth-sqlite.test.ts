// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  });
  it('saves credentials readable by SQLite and JSON consumers', async () => {
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    const { readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    await saveProviderKeyToOpenClaw('custom', 'synthetic-key', 'main');
    expect(readAuthProfilesFromSqlite('main')?.profiles['custom:default'].key).toBe('synthetic-key');
    expect(JSON.parse(await readFile(join(dbPath(), '../auth-profiles.json'), 'utf8')).profiles['custom:default'].key).toBe('synthetic-key');
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
  });
  it('does not modify schema metadata while writing to a current database', async () => {
    await seed(25);
    const before = inspect();
    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite(store, 'main');
    expect(inspect()).toEqual(before);
  });
  it('preserves a genuine interrupted v16 structure and both version markers', async () => {
    await seed(16);
    const before = inspect();
    const { repairOpenClawOwnedAgentSchema, writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');
    writeAuthProfilesToSqlite(store, 'main');
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
