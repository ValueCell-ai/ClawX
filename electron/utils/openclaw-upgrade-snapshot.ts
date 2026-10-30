import { chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';

const UPGRADE_ID = 'openclaw-2026.10.5';
const SNAPSHOT_DIR_MODE = 0o700;
const SNAPSHOT_FILE_MODE = 0o600;
// Runtime/plugin binaries, caches and user workspaces are not migration inputs.
const EXCLUDED_ROOTS = new Set(['backups', 'extensions', 'node_modules', 'skills', 'logs', 'browser']);
const pendingSnapshots = new Map<string, Promise<OpenClawUpgradeSnapshotResult>>();

export type OpenClawUpgradeSnapshotResult = {
  status: 'created' | 'exists';
  snapshotDir: string;
  files: string[];
};

export type OpenClawUpgradeSnapshotCleanupResult = {
  status: 'removed' | 'missing';
  snapshotDir: string;
};

export type LegacyUpdateCheckCleanupResult = {
  status: 'quarantined' | 'missing' | 'deferred';
  sourcePath: string;
  backupPath?: string;
};

type SnapshotOptions = {
  stateDir?: string;
  configPath?: string;
};

function resolveSnapshotDir(stateDir: string): string {
  return join(stateDir, 'backups', `clawx-${UPGRADE_ID}-pre-migration`);
}

async function isCopyableRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function snapshotMarkerExists(markerPath: string): Promise<boolean> {
  try {
    return (await stat(markerPath)).isFile();
  } catch {
    return false;
  }
}

async function copyFileIfPresent(source: string, destination: string, copied: string[]): Promise<void> {
  if (!await isCopyableRegularFile(source)) return;
  await mkdir(dirname(destination), { recursive: true, mode: SNAPSHOT_DIR_MODE });
  if (source.endsWith('.sqlite')) {
    // SQLite's online backup includes committed WAL pages in one consistent DB.
    // Never independently copy a live DB and its changing WAL/SHM sidecars.
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(db, destination);
    } finally {
      db.close();
    }
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      const rows = check.prepare('PRAGMA integrity_check').all();
      if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
        throw new Error(`Upgrade snapshot integrity check failed: ${source}`);
      }
    } finally {
      check.close();
    }
  } else {
    const before = await stat(source);
    await copyFile(source, destination);
    const after = await stat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error(`Upgrade input changed while being backed up: ${source}`);
    }
  }
  await chmod(destination, SNAPSHOT_FILE_MODE);
  copied.push(destination);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveAvailableBackupPath(basePath: string): Promise<string> {
  if (!await pathExists(basePath)) return basePath;

  const timestamp = Date.now();
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = `${basePath}.${timestamp}${suffix === 0 ? '' : `-${suffix}`}`;
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error(`Could not allocate backup path for ${basePath}`);
}

function hasCanonicalUpdateCheckState(sqlitePath: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
    const row = db.prepare(`
      SELECT 1 AS present
        FROM update_check_state
       WHERE state_key = ?
       LIMIT 1
    `).get('default') as { present?: number } | undefined;
    return row?.present === 1;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function copyTree(
  sourceRoot: string,
  destinationRoot: string,
  copied: string[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true, mode: SNAPSHOT_DIR_MODE });
      await copyTree(source, destination, copied);
    } else if (entry.isFile() && !/\.sqlite-(wal|shm)$/.test(entry.name)) {
      await copyFileIfPresent(source, destination, copied);
    }
  }
}

/** Retained until explicitly removed by the user, never on Gateway readiness. */
export async function ensureOpenClawUpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const key = `${stateDir}\0${resolve(options.configPath ?? resolveOpenClawConfigPath())}`;
  const pending = pendingSnapshots.get(key);
  if (pending) return pending;
  const operation = createUpgradeSnapshot({ ...options, stateDir });
  pendingSnapshots.set(key, operation);
  try {
    return await operation;
  } finally {
    pendingSnapshots.delete(key);
  }
}

async function createUpgradeSnapshot(options: SnapshotOptions): Promise<OpenClawUpgradeSnapshotResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const configPath = resolve(options.configPath ?? resolveOpenClawConfigPath());
  const snapshotDir = resolveSnapshotDir(stateDir);
  const markerPath = join(snapshotDir, 'snapshot.json');

  if (await snapshotMarkerExists(markerPath)) {
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { upgrade?: unknown; files?: unknown };
    if (marker.upgrade !== UPGRADE_ID || !Array.isArray(marker.files)) {
      throw new Error(`Invalid upgrade snapshot manifest; preserve and inspect ${snapshotDir}`);
    }
    const files: string[] = [];
    for (const file of marker.files) {
      if (typeof file !== 'string' || relative(snapshotDir, resolve(snapshotDir, file)).startsWith('..')
        || !await isCopyableRegularFile(join(snapshotDir, file))) {
        throw new Error(`Incomplete upgrade snapshot; preserve and inspect ${snapshotDir}`);
      }
      files.push(file);
    }
    return { status: 'exists', snapshotDir, files };
  }

  const tempDir = `${snapshotDir}.tmp-${process.pid}-${Date.now()}`;
  const copiedDestinations: string[] = [];
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });

  try {
    await copyFileIfPresent(configPath, join(tempDir, 'config', basename(configPath)), copiedDestinations);

    const entries = await readdir(stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_ROOTS.has(entry.name) || entry.name === 'workspace' || entry.name.startsWith('workspace-')) continue;
      const source = join(stateDir, entry.name);
      // Preserve the historical agents layout; other state lives under state-files.
      const destination = entry.name === 'agents'
        ? join(tempDir, 'agents') : join(tempDir, 'state-files', entry.name);
      if (entry.isDirectory()) await copyTree(source, destination, copiedDestinations);
      else if (entry.isFile() && source !== configPath && !/\.sqlite-(wal|shm)$/.test(entry.name)) {
        await copyFileIfPresent(source, destination, copiedDestinations);
      }
    }

    const files = copiedDestinations.map((path) => relative(tempDir, path)).sort();
    await writeFile(join(tempDir, 'snapshot.json'), `${JSON.stringify({
      upgrade: UPGRADE_ID,
      createdAt: new Date().toISOString(),
      configPath,
      stateDir,
      files,
    }, null, 2)}\n`, { encoding: 'utf8', mode: SNAPSHOT_FILE_MODE });

    await rm(snapshotDir, { recursive: true, force: true });
    await mkdir(dirname(snapshotDir), { recursive: true, mode: SNAPSHOT_DIR_MODE });
    await rename(tempDir, snapshotDir);
    return { status: 'created', snapshotDir, files };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * OpenClaw 2026.7.1 refuses Gateway readiness when the legacy update-check JSON
 * differs from an existing canonical SQLite row. The JSON contains updater
 * bookkeeping only, and upstream would archive it when both copies match. Once
 * SQLite has the canonical row, move the legacy file out of the active state
 * root so a harmless mismatch cannot trap startup or an ineffective doctor
 * retry loop. If SQLite has no row yet, leave the JSON for upstream to import.
 */
export async function quarantineLegacyUpdateCheckState(
  options: Pick<SnapshotOptions, 'stateDir'> = {},
): Promise<LegacyUpdateCheckCleanupResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const sourcePath = join(stateDir, 'update-check.json');
  let sourceInfo;
  try {
    sourceInfo = await lstat(sourcePath);
  } catch {
    return { status: 'missing', sourcePath };
  }
  if (!sourceInfo.isFile() && !sourceInfo.isSymbolicLink()) {
    return { status: 'deferred', sourcePath };
  }

  const sqlitePath = join(stateDir, 'state', 'openclaw.sqlite');
  if (!hasCanonicalUpdateCheckState(sqlitePath)) {
    return { status: 'deferred', sourcePath };
  }

  const backupDir = join(stateDir, 'backups');
  await mkdir(backupDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });
  const backupPath = await resolveAvailableBackupPath(
    join(backupDir, `clawx-${UPGRADE_ID}-legacy-update-check.json`),
  );
  await rename(sourcePath, backupPath);
  if (sourceInfo.isFile()) {
    await chmod(backupPath, SNAPSHOT_FILE_MODE);
  }
  return { status: 'quarantined', sourcePath, backupPath };
}

/** Explicit maintenance only. Gateway readiness must never call this. */
export async function removeOpenClawUpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotCleanupResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const snapshotDir = resolveSnapshotDir(stateDir);
  const markerPath = join(snapshotDir, 'snapshot.json');
  if (!await snapshotMarkerExists(markerPath)) {
    return { status: 'missing', snapshotDir };
  }

  await rm(snapshotDir, { recursive: true, force: true });
  return { status: 'removed', snapshotDir };
}

/** @deprecated Compatibility alias for tests/extensions from the pre-10.5 branch. */
export const ensureOpenClaw2026_7_1UpgradeSnapshot = ensureOpenClawUpgradeSnapshot;
export const removeOpenClaw2026_7_1UpgradeSnapshot = removeOpenClawUpgradeSnapshot;
