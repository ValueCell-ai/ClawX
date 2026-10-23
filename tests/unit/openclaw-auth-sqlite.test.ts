// @vitest-environment node

import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `/tmp/clawx-auth-sqlite-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

async function writeJsonStore(agentId: string, store: Record<string, unknown>): Promise<void> {
  const dir = join(testHome, '.openclaw', 'agents', agentId, 'agent');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'auth-profiles.json'), JSON.stringify(store, null, 2), 'utf8');
}

describe('openclaw-auth-sqlite', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
  });

  it('migrates auth-profiles.json into openclaw-agent.sqlite when sqlite is empty', async () => {
    await writeJsonStore('main', {
      version: 1,
      profiles: {
        'custom-customc7:default': {
          type: 'api_key',
          provider: 'custom-customc7',
          key: 'sk-test-key',
        },
      },
      order: { 'custom-customc7': ['custom-customc7:default'] },
      lastGood: { 'custom-customc7': 'custom-customc7:default' },
    });

    const {
      migrateAuthProfilesJsonToSqliteIfNeeded,
      readAuthProfilesFromSqlite,
      getAuthProfilesSqlitePath,
    } = await import('@electron/utils/openclaw-auth-sqlite');

    const migrated = await migrateAuthProfilesJsonToSqliteIfNeeded('main');
    expect(migrated).toBe(true);
    expect(existsSync(getAuthProfilesSqlitePath('main'))).toBe(true);

    const sqliteStore = readAuthProfilesFromSqlite('main');
    expect(sqliteStore?.profiles['custom-customc7:default']).toMatchObject({
      type: 'api_key',
      provider: 'custom-customc7',
      key: 'sk-test-key',
    });
    expect(sqliteStore?.order?.['custom-customc7']).toEqual(['custom-customc7:default']);
    expect(sqliteStore?.lastGood?.['custom-customc7']).toBe('custom-customc7:default');
  });

  it('saveProviderKeyToOpenClaw writes credentials readable from sqlite', async () => {
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');
    const {
      readAuthProfilesFromSqlite,
      getAuthProfilesSqlitePath,
    } = await import('@electron/utils/openclaw-auth-sqlite');

    await saveProviderKeyToOpenClaw('custom-customc7', 'sk-runtime-key', 'main');

    expect(existsSync(getAuthProfilesSqlitePath('main'))).toBe(true);
    const sqliteStore = readAuthProfilesFromSqlite('main');
    expect(sqliteStore?.profiles['custom-customc7:default']).toMatchObject({
      type: 'api_key',
      provider: 'custom-customc7',
      key: 'sk-runtime-key',
    });

    const json = JSON.parse(
      await readFile(join(testHome, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect((json.profiles as Record<string, unknown>)['custom-customc7:default']).toMatchObject({
      key: 'sk-runtime-key',
    });
  });

  it('keeps an OpenClaw-owned agent database at schema version 25 while saving auth', async () => {
    const sqlitePath = join(testHome, '.openclaw', 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
    await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });
    const seeded = new DatabaseSync(sqlitePath);
    seeded.exec(`
      CREATE TABLE schema_meta (
        meta_key TEXT NOT NULL PRIMARY KEY,
        role TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        agent_id TEXT,
        app_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO schema_meta (
        meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
      ) VALUES ('primary', 'agent', 25, 'main', '2026.10.5', 1, 1);
      PRAGMA user_version = 25;
    `);
    seeded.close();

    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite({
      version: 1,
      profiles: { 'custom:default': { type: 'api_key', provider: 'custom', key: 'sk-owned' } },
    }, 'main');

    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    const meta = db.prepare(
      'SELECT schema_version, app_version FROM schema_meta WHERE meta_key = ?',
    ).get('primary') as { schema_version: number; app_version: string };
    db.close();
    expect(version.user_version).toBe(25);
    expect(meta).toEqual({ schema_version: 25, app_version: '2026.10.5' });
  });

  it('restores schema version 25 after ClawX stamped an OpenClaw-owned database back to 1', async () => {
    const sqlitePath = join(testHome, '.openclaw', 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
    await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });
    const seeded = new DatabaseSync(sqlitePath);
    seeded.exec(`
      CREATE TABLE schema_meta (
        meta_key TEXT NOT NULL PRIMARY KEY,
        role TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        agent_id TEXT,
        app_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO schema_meta (
        meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
      ) VALUES ('primary', 'agent', 1, 'main', '2026.10.5', 1, 1);
      PRAGMA user_version = 1;
    `);
    seeded.close();

    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite({
      version: 1,
      profiles: { 'custom:default': { type: 'api_key', provider: 'custom', key: 'sk-restored' } },
    }, 'main');

    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    const meta = db.prepare(
      'SELECT schema_version, app_version FROM schema_meta WHERE meta_key = ?',
    ).get('primary') as { schema_version: number; app_version: string };
    db.close();
    expect(version.user_version).toBe(25);
    expect(meta).toEqual({ schema_version: 25, app_version: '2026.10.5' });
  });

  it('repairs a clobbered schema before startup without rewriting stored credentials', async () => {
    const sqlitePath = join(testHome, '.openclaw', 'agents', 'main', 'agent', 'openclaw-agent.sqlite');
    await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });
    const seeded = new DatabaseSync(sqlitePath);
    seeded.exec(`
      CREATE TABLE schema_meta (
        meta_key TEXT NOT NULL PRIMARY KEY,
        role TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        agent_id TEXT,
        app_version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE auth_profile_store (
        store_key TEXT NOT NULL PRIMARY KEY,
        store_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO schema_meta (
        meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
      ) VALUES ('primary', 'agent', 1, 'main', '2026.10.5', 1, 1);
      INSERT INTO auth_profile_store (store_key, store_json, updated_at)
      VALUES ('primary', '{"version":1,"profiles":{"custom:default":{"type":"api_key","provider":"custom","key":"sk-keep"}}}', 1);
      PRAGMA user_version = 1;
    `);
    seeded.close();

    const { repairOpenClawOwnedAgentSchema, readAuthProfilesFromSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    repairOpenClawOwnedAgentSchema('main');

    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    db.close();
    expect(version.user_version).toBe(25);
    expect(readAuthProfilesFromSqlite('main')?.profiles['custom:default']).toMatchObject({ key: 'sk-keep' });
  });
});
