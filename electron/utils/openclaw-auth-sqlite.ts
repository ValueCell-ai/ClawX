/**
 * OpenClaw 2026.6+ persists agent auth in openclaw-agent.sqlite.
 * ClawX historically wrote auth-profiles.json only; gateway runtime reads SQLite.
 */
import { chmodSync, existsSync, mkdirSync } from 'fs';
import { access, readFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DatabaseSync } from 'node:sqlite';

const AUTH_PROFILE_FILENAME = 'auth-profiles.json';
const AUTH_SQLITE_FILENAME = 'openclaw-agent.sqlite';
const PRIMARY_ROW_KEY = 'primary';
const SCHEMA_VERSION = 1;

const OPENCLAW_AGENT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (
  meta_key TEXT NOT NULL PRIMARY KEY,
  role TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  agent_id TEXT,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  blob BLOB,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_cache_expiry
  ON cache_entries(scope, expires_at, key)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_cache_updated
  ON cache_entries(scope, updated_at DESC, key);

CREATE TABLE IF NOT EXISTS auth_profile_store (
  store_key TEXT NOT NULL PRIMARY KEY,
  store_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_profile_state (
  state_key TEXT NOT NULL PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export interface PersistedAuthProfileCredential {
  type: string;
  provider: string;
  key?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  email?: string;
  projectId?: string;
  [extra: string]: unknown;
}

export interface PersistedAuthProfilesStore {
  version: number;
  profiles: Record<string, PersistedAuthProfileCredential>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
}

function getAgentAuthDir(agentId: string): string {
  return join(homedir(), '.openclaw', 'agents', agentId, 'agent');
}

export function getAuthProfilesJsonPath(agentId: string): string {
  return join(getAgentAuthDir(agentId), AUTH_PROFILE_FILENAME);
}

export function getAuthProfilesSqlitePath(agentId: string): string {
  return join(getAgentAuthDir(agentId), AUTH_SQLITE_FILENAME);
}

function ensureAgentAuthDir(agentId: string): void {
  const dir = getAgentAuthDir(agentId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function ensureDatabaseSchema(db: DatabaseSync, agentId: string): void {
  db.exec(OPENCLAW_AGENT_SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  const now = Date.now();
  db.prepare(`
    INSERT INTO schema_meta (
      meta_key, role, schema_version, agent_id, app_version, created_at, updated_at
    ) VALUES (?, 'agent', ?, ?, NULL, ?, ?)
    ON CONFLICT(meta_key) DO UPDATE SET
      role = excluded.role,
      schema_version = excluded.schema_version,
      agent_id = excluded.agent_id,
      updated_at = excluded.updated_at
  `).run(PRIMARY_ROW_KEY, SCHEMA_VERSION, agentId, now, now);
}

function tightenDatabasePermissions(sqlitePath: string): void {
  try {
    if (process.platform !== 'win32') {
      chmodSync(sqlitePath, 0o600);
      for (const suffix of ['-wal', '-shm']) {
        const sidecar = `${sqlitePath}${suffix}`;
        if (existsSync(sidecar)) {
          chmodSync(sidecar, 0o600);
        }
      }
    }
  } catch {
    // Best-effort; Windows ACLs differ from POSIX modes.
  }
}

function parseJsonCell(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function coerceAuthProfilesStore(raw: Record<string, unknown> | null): PersistedAuthProfilesStore | null {
  if (!raw || typeof raw !== 'object') return null;
  const profiles = raw.profiles;
  if (!profiles || typeof profiles !== 'object') return null;
  const version = typeof raw.version === 'number' ? raw.version : 1;
  const store: PersistedAuthProfilesStore = {
    version,
    profiles: profiles as Record<string, PersistedAuthProfileCredential>,
  };
  if (raw.order && typeof raw.order === 'object') {
    store.order = raw.order as Record<string, string[]>;
  }
  if (raw.lastGood && typeof raw.lastGood === 'object') {
    store.lastGood = raw.lastGood as Record<string, string>;
  }
  if (raw.usageStats && typeof raw.usageStats === 'object') {
    store.usageStats = raw.usageStats as Record<string, unknown>;
  }
  return store;
}

function buildSecretsPayload(store: PersistedAuthProfilesStore): Record<string, unknown> {
  return {
    version: store.version ?? 1,
    profiles: store.profiles,
  };
}

function buildStatePayload(store: PersistedAuthProfilesStore): Record<string, unknown> | null {
  if (!store.order && !store.lastGood && !store.usageStats) {
    return null;
  }
  return {
    version: 1,
    ...(store.order ? { order: store.order } : {}),
    ...(store.lastGood ? { lastGood: store.lastGood } : {}),
    ...(store.usageStats ? { usageStats: store.usageStats } : {}),
  };
}

function mergeStoreAndState(
  secrets: Record<string, unknown> | null,
  state: Record<string, unknown> | null,
): PersistedAuthProfilesStore | null {
  const base = coerceAuthProfilesStore(secrets);
  if (!base) return null;
  if (!state) return base;
  if (state.order && typeof state.order === 'object') {
    base.order = state.order as Record<string, string[]>;
  }
  if (state.lastGood && typeof state.lastGood === 'object') {
    base.lastGood = state.lastGood as Record<string, string>;
  }
  if (state.usageStats && typeof state.usageStats === 'object') {
    base.usageStats = state.usageStats as Record<string, unknown>;
  }
  return base;
}

function hasPersistedProfiles(store: PersistedAuthProfilesStore | null | undefined): boolean {
  return !!store && Object.keys(store.profiles).length > 0;
}

function openAgentDatabase(agentId: string, sqlitePath: string): DatabaseSync {
  ensureAgentAuthDir(agentId);
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  ensureDatabaseSchema(db, agentId);
  return db;
}

export function readAuthProfilesFromSqlite(agentId: string): PersistedAuthProfilesStore | null {
  const sqlitePath = getAuthProfilesSqlitePath(agentId);
  if (!existsSync(sqlitePath)) {
    return null;
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const storeRow = db.prepare(
      'SELECT store_json FROM auth_profile_store WHERE store_key = ?',
    ).get(PRIMARY_ROW_KEY) as { store_json?: string } | undefined;
    const stateRow = db.prepare(
      'SELECT state_json FROM auth_profile_state WHERE state_key = ?',
    ).get(PRIMARY_ROW_KEY) as { state_json?: string } | undefined;
    return mergeStoreAndState(
      parseJsonCell(storeRow?.store_json),
      parseJsonCell(stateRow?.state_json),
    );
  } catch (error) {
    console.warn(`Failed to read auth profiles from SQLite (${sqlitePath}):`, error);
    return null;
  } finally {
    db.close();
  }
}

export function writeAuthProfilesToSqlite(
  store: PersistedAuthProfilesStore,
  agentId: string,
): void {
  const sqlitePath = getAuthProfilesSqlitePath(agentId);
  const db = openAgentDatabase(agentId, sqlitePath);
  try {
    const now = Date.now();
    const secretsPayload = JSON.stringify(buildSecretsPayload(store));
    db.prepare(`
      INSERT INTO auth_profile_store (store_key, store_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(store_key) DO UPDATE SET
        store_json = excluded.store_json,
        updated_at = excluded.updated_at
    `).run(PRIMARY_ROW_KEY, secretsPayload, now);

    const statePayload = buildStatePayload(store);
    if (statePayload) {
      db.prepare(`
        INSERT INTO auth_profile_state (state_key, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(state_key) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `).run(PRIMARY_ROW_KEY, JSON.stringify(statePayload), now);
    } else {
      db.prepare('DELETE FROM auth_profile_state WHERE state_key = ?').run(PRIMARY_ROW_KEY);
    }
  } finally {
    db.close();
    tightenDatabasePermissions(sqlitePath);
  }
}

export async function readAuthProfilesJson(agentId: string): Promise<PersistedAuthProfilesStore | null> {
  const jsonPath = getAuthProfilesJsonPath(agentId);
  try {
    await access(jsonPath, constants.F_OK);
    const raw = JSON.parse(await readFile(jsonPath, 'utf-8')) as Record<string, unknown>;
    return coerceAuthProfilesStore(raw);
  } catch {
    return null;
  }
}

export async function migrateAuthProfilesJsonToSqliteIfNeeded(agentId: string): Promise<boolean> {
  const sqliteStore = readAuthProfilesFromSqlite(agentId);
  if (hasPersistedProfiles(sqliteStore)) {
    return false;
  }

  const jsonStore = await readAuthProfilesJson(agentId);
  if (!hasPersistedProfiles(jsonStore)) {
    return false;
  }

  writeAuthProfilesToSqlite(jsonStore!, agentId);
  console.log(
    `[auth-sync] Migrated auth-profiles.json to SQLite for agent "${agentId}"`,
  );
  return true;
}
