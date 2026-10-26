/**
 * OpenClaw 2026.6+ persists agent auth in openclaw-agent.sqlite.
 * ClawX historically wrote auth-profiles.json only; gateway runtime reads SQLite.
 */
import { chmodSync, existsSync, linkSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import * as persistenceRuntime from './openclaw-persistence-runtime';

const AUTH_PROFILE_FILENAME = 'auth-profiles.json';
const AUTH_SQLITE_FILENAME = 'openclaw-agent.sqlite';
const PRIMARY_ROW_KEY = 'primary';
// Admission ceiling, never a substitute for migrating a database's structure.
const OPENCLAW_OWNED_AGENT_SCHEMA_VERSION = 25;

export class OpenClawAgentSchemaMigrationPendingError extends Error {
  constructor(version: number) {
    super(`OpenClaw agent schema migration is pending (current schema ${version}); refusing auth write`);
    this.name = 'OpenClawAgentSchemaMigrationPendingError';
  }
}

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

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return typeof row?.user_version === 'number' ? row.user_version : 0;
}

function readSchemaMetadata(db: DatabaseSync): { app_version?: string; schema_version?: number; agent_id?: string } | undefined {
  return db.prepare('SELECT app_version, schema_version, agent_id FROM schema_meta WHERE meta_key = ?')
    .get(PRIMARY_ROW_KEY) as { app_version?: string; schema_version?: number; agent_id?: string } | undefined;
}

function assertAuthWriteVersion(db: DatabaseSync, agentId: string, sqlitePath: string): void {
  const version = readUserVersion(db);
  const meta = readSchemaMetadata(db);
  if (version > OPENCLAW_OWNED_AGENT_SCHEMA_VERSION || (meta?.schema_version ?? 0) > OPENCLAW_OWNED_AGENT_SCHEMA_VERSION) {
    throw new Error(`Refusing auth write to newer OpenClaw agent schema (${version})`);
  }
  if (meta?.agent_id && meta.agent_id !== agentId) throw new Error('OpenClaw agent schema owner mismatch');
  if (version !== OPENCLAW_OWNED_AGENT_SCHEMA_VERSION || meta?.schema_version !== OPENCLAW_OWNED_AGENT_SCHEMA_VERSION) {
    throw new OpenClawAgentSchemaMigrationPendingError(version);
  }
  persistenceRuntime.assertBundledAgentStructure(db, sqlitePath, OPENCLAW_OWNED_AGENT_SCHEMA_VERSION);
}

function repairKnownClobberedSchema(db: DatabaseSync, agentId: string, sqlitePath: string): void {
  // Only ClawX's known 25 -> 1 bug is repairable here. Genuine v1/v16 and
  // future schemas remain entirely owned by the upstream offline migration.
  if (readUserVersion(db) !== 1) return;
  const meta = readSchemaMetadata(db);
  if (meta?.app_version !== '2026.10.5' || meta.schema_version !== 1 || meta.agent_id !== agentId) return;
  try {
    persistenceRuntime.assertBundledAgentStructure(db, sqlitePath, OPENCLAW_OWNED_AGENT_SCHEMA_VERSION);
  } catch {
    return; // Not a fully migrated v25 structure: never pretend otherwise.
  }
  const backupPath = `${sqlitePath}.clawx-before-schema-repair`;
  if (!existsSync(backupPath)) {
    // VACUUM INTO makes a standalone, WAL-inclusive copy before changing markers.
    db.prepare('VACUUM INTO ?').run(backupPath);
    tightenDatabasePermissions(backupPath);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = readSchemaMetadata(db);
    if (readUserVersion(db) !== 1 || current?.schema_version !== 1 || current.app_version !== '2026.10.5') {
      throw new Error('Agent schema changed during repair');
    }
    persistenceRuntime.assertBundledAgentStructure(db, sqlitePath, OPENCLAW_OWNED_AGENT_SCHEMA_VERSION);
    db.exec(`PRAGMA user_version = ${OPENCLAW_OWNED_AGENT_SCHEMA_VERSION}`);
    db.prepare('UPDATE schema_meta SET schema_version = ? WHERE meta_key = ?')
      .run(OPENCLAW_OWNED_AGENT_SCHEMA_VERSION, PRIMARY_ROW_KEY);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Publish a complete runtime-owned schema atomically, never a skeletal v1 DB. */
export function initializeAgentAuthDatabase(agentId: string): void {
  const sqlitePath = getAuthProfilesSqlitePath(agentId);
  if (existsSync(sqlitePath)) return;
  ensureAgentAuthDir(agentId);
  const staged = `${sqlitePath}.init-${randomUUID()}.sqlite`;
  try {
    const db = new DatabaseSync(staged);
    try {
      persistenceRuntime.initializeBundledAgentDatabase(db, staged, agentId);
    } finally {
      db.close(); // checkpoint WAL before publishing the standalone file
    }
    tightenDatabasePermissions(staged);
    try {
      linkSync(staged, sqlitePath); // exclusive publication; do not replace a runtime-created DB
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${staged}${suffix}`, { force: true });
  }
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
  initializeAgentAuthDatabase(agentId);
  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    repairKnownClobberedSchema(db, agentId, sqlitePath);
    assertAuthWriteVersion(db, agentId, sqlitePath);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
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
    db.exec('BEGIN IMMEDIATE');
    assertAuthWriteVersion(db, agentId, sqlitePath);
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
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
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

/** Repair only the structurally verified, known ClawX marker corruption. */
export function repairOpenClawOwnedAgentSchema(agentId: string): void {
  const sqlitePath = getAuthProfilesSqlitePath(agentId);
  if (!existsSync(sqlitePath)) return;
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    repairKnownClobberedSchema(db, agentId, sqlitePath);
  } finally {
    db.close();
  }
}

export async function migrateAuthProfilesJsonToSqliteIfNeeded(agentId: string): Promise<boolean> {
  const sqlitePath = getAuthProfilesSqlitePath(agentId);
  if (existsSync(sqlitePath)) {
    try {
      repairOpenClawOwnedAgentSchema(agentId);
      const db = new DatabaseSync(sqlitePath, { readOnly: true });
      try {
        assertAuthWriteVersion(db, agentId, sqlitePath);
      } finally {
        db.close();
      }
    } catch (error) {
      if (error instanceof OpenClawAgentSchemaMigrationPendingError) return false;
      throw error;
    }
  }

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
