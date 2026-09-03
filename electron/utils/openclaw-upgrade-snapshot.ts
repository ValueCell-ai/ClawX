import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';

const UPGRADE_ID = 'openclaw-2026.8.1';
const SNAPSHOT_DIR_MODE = 0o700;
const SNAPSHOT_FILE_MODE = 0o600;
const AGENT_AUTH_BASENAMES = new Set([
  'auth-profiles.json',
  'openclaw-agent.sqlite',
  'openclaw-agent.sqlite-wal',
  'openclaw-agent.sqlite-shm',
]);
const MIGRATION_FILE_PATTERN = /(?:^sessions\.json$|\.jsonl(?:\.reset\..+)?|\.trajectory-path\.json|\.sqlite(?:-(?:wal|shm))?)$/;

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
  backupRoot?: string;
};

function resolveSnapshotDir(stateDir: string, backupRoot?: string): string {
  const root = resolve(backupRoot ?? join(dirname(stateDir), '.clawx-openclaw-migrations'));
  const resolvedStateDir = resolve(stateDir);
  const backupRelativeToState = relative(resolvedStateDir, root);
  if (
    backupRelativeToState === ''
    || (!backupRelativeToState.startsWith('..') && !isAbsolute(backupRelativeToState))
  ) {
    throw new Error('OpenClaw migration backup root must be outside the active state directory');
  }
  const stateIdentity = createHash('sha256').update(resolvedStateDir).digest('hex').slice(0, 12);
  return join(root, `clawx-${UPGRADE_ID}-${stateIdentity}-pre-migration`);
}

async function isCopyableRegularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile();
  } catch {
    return false;
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
  await copyFile(source, destination);
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
  includeFile: (name: string) => boolean,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true, mode: SNAPSHOT_DIR_MODE });
      await copyTree(source, destination, copied, includeFile);
    } else if (entry.isFile() && includeFile(entry.name)) {
      await copyFileIfPresent(source, destination, copied);
    }
  }
}

async function sha256(path: string): Promise<string> {
  return await new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

async function readVerifiedSnapshot(
  markerPath: string,
  snapshotDir: string,
): Promise<string[] | null> {
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as {
      files?: unknown;
      checksums?: unknown;
    };
    if (!Array.isArray(marker.files) || !marker.checksums || typeof marker.checksums !== 'object') {
      return null;
    }
    const files = marker.files.filter((value): value is string => typeof value === 'string');
    if (files.length !== marker.files.length) return null;
    if (files.some((file) => !file || isAbsolute(file) || relative('.', file).startsWith('..'))) {
      return null;
    }
    const checksums = marker.checksums as Record<string, unknown>;
    for (const file of files) {
      const expected = checksums[file];
      if (typeof expected !== 'string' || await sha256(join(snapshotDir, file)) !== expected) {
        return null;
      }
    }
    return files;
  } catch {
    return null;
  }
}

/**
 * Creates a one-time, verified pre-migration checkpoint before ClawX first
 * starts OpenClaw 2026.8.1. The checkpoint lives outside the active state tree
 * so an interrupted runtime migration cannot mutate its recovery inputs.
 */
export async function ensureOpenClaw2026_8_1UpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const configPath = resolve(options.configPath ?? resolveOpenClawConfigPath());
  const snapshotDir = resolveSnapshotDir(stateDir, options.backupRoot);
  const markerPath = join(snapshotDir, 'snapshot.json');

  if (await snapshotMarkerExists(markerPath)) {
    const files = await readVerifiedSnapshot(markerPath, snapshotDir);
    if (files) {
      return {
        status: 'exists',
        snapshotDir,
        files,
      };
    }
    // Replace malformed, incomplete, or corrupted snapshots below.
  }

  const tempDir = `${snapshotDir}.tmp-${process.pid}-${Date.now()}`;
  const copiedDestinations: string[] = [];
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });

  try {
    await copyFileIfPresent(configPath, join(tempDir, 'config', basename(configPath)), copiedDestinations);
    for (const basename of ['exec-approvals.json', 'update-check.json']) {
      await copyFileIfPresent(
        join(stateDir, basename),
        join(tempDir, 'state-files', basename),
        copiedDestinations,
      );
    }

    for (const databasePath of [
      join(stateDir, 'openclaw.sqlite'),
      join(stateDir, 'state', 'openclaw.sqlite'),
    ]) {
      const relativeDatabase = relative(stateDir, databasePath);
      for (const suffix of ['', '-wal', '-shm']) {
        await copyFileIfPresent(
          `${databasePath}${suffix}`,
          join(tempDir, 'state-files', `${relativeDatabase}${suffix}`),
          copiedDestinations,
        );
      }
    }

    await copyTree(
      join(stateDir, 'agents'),
      join(tempDir, 'agents'),
      copiedDestinations,
      (name) => AGENT_AUTH_BASENAMES.has(name) || MIGRATION_FILE_PATTERN.test(name),
    );

    for (const directory of ['credentials', 'cron']) {
      await copyTree(
        join(stateDir, directory),
        join(tempDir, directory),
        copiedDestinations,
        (name) => /\.(?:json|jsonl|sqlite)(?:-(?:wal|shm))?$/.test(name),
      );
    }

    const files = copiedDestinations.map((path) => relative(tempDir, path)).sort();
    const checksums: Record<string, string> = {};
    for (const file of files) {
      const destination = join(tempDir, file);
      checksums[file] = await sha256(destination);
    }
    await writeFile(join(tempDir, 'snapshot.json'), `${JSON.stringify({
      upgrade: UPGRADE_ID,
      createdAt: new Date().toISOString(),
      configPath,
      stateDir,
      files,
      checksums,
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

/**
 * Removes the OpenClaw 2026.8.1 recovery checkpoint. Callers must only invoke
 * this from an explicit retention/cleanup flow, never merely because Gateway
 * reached readiness once.
 */
export async function removeOpenClaw2026_8_1UpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotCleanupResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const snapshotDir = resolveSnapshotDir(stateDir, options.backupRoot);
  const markerPath = join(snapshotDir, 'snapshot.json');
  if (!await snapshotMarkerExists(markerPath)) {
    return { status: 'missing', snapshotDir };
  }

  await rm(snapshotDir, { recursive: true, force: true });
  return { status: 'removed', snapshotDir };
}
