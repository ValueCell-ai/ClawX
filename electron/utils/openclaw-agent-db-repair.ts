import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveOpenClawStateDir } from './paths';

const CURRENT_AGENT_SCHEMA_VERSION = 19;
const PARTICIPANTS_TABLE = 'session_participants';

type RepairOptions = {
  stateDir?: string;
};

export type OpenClawAgentDbRepairResult = {
  inspected: string[];
  repaired: string[];
  pendingMigration: string[];
};

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

function readUserVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version?: unknown };
  return typeof row.user_version === 'number' ? row.user_version : 0;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(
    'SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?',
  ).get('table', table));
}

function repairPrematureParticipantsTable(database: DatabaseSync, pathname: string): boolean {
  const version = readUserVersion(database);
  if (version <= 0 || version >= CURRENT_AGENT_SCHEMA_VERSION) return false;
  if (!tableExists(database, PARTICIPANTS_TABLE)) return false;

  const columns = database.prepare(`PRAGMA table_info(${PARTICIPANTS_TABLE})`).all()
    .map((row) => (row as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string');
  const isPrematureCurrentShape = columns.includes('identity_namespace') && !columns.includes('actor_type');
  if (!isPrematureCurrentShape) return false;

  const integrity = database.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown };
  if (integrity.integrity_check !== 'ok') {
    throw new Error(`Refusing agent database repair because integrity_check failed: ${pathname}`);
  }

  const countRow = database.prepare(`SELECT count(*) AS count FROM ${PARTICIPANTS_TABLE}`).get() as {
    count?: unknown;
  };
  if (countRow.count !== 0) {
    throw new Error(
      `Refusing to rebuild non-empty premature ${PARTICIPANTS_TABLE} table in ${pathname}`,
    );
  }

  const dependentSchema = database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE (
      type IN ('trigger', 'index')
      AND tbl_name = ?
      AND sql IS NOT NULL
    ) OR (
      type IN ('view', 'trigger')
      AND sql LIKE ?
    )
  `).all(PARTICIPANTS_TABLE, `%${PARTICIPANTS_TABLE}%`);
  if (dependentSchema.length > 0) {
    throw new Error(
      `Refusing to rebuild ${PARTICIPANTS_TABLE} with dependent schema in ${pathname}`,
    );
  }

  database.exec(`BEGIN IMMEDIATE; DROP TABLE ${PARTICIPANTS_TABLE}; COMMIT;`);
  return true;
}

/**
 * Repairs a known pre-8.1 additive-schema drift before Doctor owns the full
 * agent database migration. Recovery is intentionally limited to an empty
 * premature table; any populated or structurally unexpected database fails
 * closed and remains available in the verified upgrade snapshot.
 */
export async function repairOpenClawAgentDatabasesFor2026_8_1Doctor(
  options: RepairOptions = {},
): Promise<OpenClawAgentDbRepairResult> {
  const agentsDir = join(options.stateDir ?? resolveOpenClawStateDir(), 'agents');
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return { inspected: [], repaired: [], pendingMigration: [] };
  }

  const inspected: string[] = [];
  const repaired: string[] = [];
  const pendingMigration: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pathname = join(agentsDir, entry.name, 'agent', 'openclaw-agent.sqlite');
    if (!await isRegularFile(pathname)) continue;
    inspected.push(pathname);

    const database = new DatabaseSync(pathname);
    try {
      const version = readUserVersion(database);
      if (version > 0 && version < CURRENT_AGENT_SCHEMA_VERSION) {
        pendingMigration.push(pathname);
      }
      if (repairPrematureParticipantsTable(database, pathname)) repaired.push(pathname);
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // No active transaction, or SQLite already rolled it back.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  return { inspected, repaired, pendingMigration };
}
