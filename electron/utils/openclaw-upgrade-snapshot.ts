import { chmod, copyFile, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import JSON5 from 'json5';
import { backup, DatabaseSync } from 'node:sqlite';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';
import { safeRmSync } from './safe-fs';

const UPGRADE_ID = 'openclaw-2026.10.10';
const SNAPSHOT_DIR_MODE = 0o700;
const SNAPSHOT_FILE_MODE = 0o600;
// Plugin payloads are rollback inputs: a restored index must match its files.
// Workspaces and rebuildable host caches remain outside the migration snapshot.
const EXCLUDED_ROOTS = new Set(['backups', 'node_modules', 'skills', 'logs', 'browser', '.clawx-plugin-staging']);
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

type SnapshotInventory = {
  files: Record<string, { mode: number; sha256: string }>;
  directories: string[];
  links: Array<{ path: string; target: string; directory: boolean }>;
};

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

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
  snapshotRoot: string,
  inventory: SnapshotInventory,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) {
      // Record links without traversing host peers, junctions or user data.
      inventory.links.push({ path: relative(snapshotRoot, destination), target: await readlink(source),
        directory: await stat(source).then(info => info.isDirectory(), () => false) });
    } else if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true, mode: SNAPSHOT_DIR_MODE });
      inventory.directories.push(relative(snapshotRoot, destination));
      await copyTree(source, destination, copied, snapshotRoot, inventory);
    } else if (entry.isFile() && !/\.sqlite-(wal|shm)$/.test(entry.name)) {
      const mode = (await stat(source)).mode & 0o777;
      await copyFileIfPresent(source, destination, copied);
      inventory.files[relative(snapshotRoot, destination)] = { mode, sha256: await sha256File(destination) };
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
  if (await pathExists(snapshotDir)) {
    throw new Error(`Incomplete upgrade snapshot; preserve and inspect ${snapshotDir}`);
  }

  const tempDir = `${snapshotDir}.tmp-${process.pid}-${Date.now()}`;
  const copiedDestinations: string[] = [];
  const inventory: SnapshotInventory = { files: {}, directories: [], links: [] };
  const restoreRoots: Array<{ source: string; backup: string; existed: boolean; directory: boolean }> = [];
  const externalRoots: string[] = [];
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });

  try {
    await copyFileIfPresent(configPath, join(tempDir, 'config', basename(configPath)), copiedDestinations);
    const configBackup = join('config', basename(configPath));
    const configInfo = await lstat(configPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    const configExists = Boolean(configInfo);
    restoreRoots.push({ source: configPath, backup: configBackup, existed: configExists, directory: false });
    if (configInfo?.isSymbolicLink()) {
      inventory.links.push({ path: configBackup, target: await readlink(configPath), directory: false });
    } else if (configExists) inventory.files[configBackup] = {
      mode: (await stat(configPath)).mode & 0o777,
      sha256: await sha256File(join(tempDir, configBackup)),
    };

    const entries = await readdir(stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (EXCLUDED_ROOTS.has(entry.name) || entry.name === 'workspace' || entry.name.startsWith('workspace-')) continue;
      const source = join(stateDir, entry.name);
      if (source === configPath) continue;
      // Preserve the historical agents layout; other state lives under state-files.
      const destination = entry.name === 'agents'
        ? join(tempDir, 'agents') : join(tempDir, 'state-files', entry.name);
      if (entry.isSymbolicLink()) {
        const directory = await stat(source).then(info => info.isDirectory(), () => false);
        restoreRoots.push({ source, backup: relative(tempDir, destination), existed: true, directory });
        inventory.links.push({ path: relative(tempDir, destination), target: await readlink(source), directory });
        continue;
      }
      if (/\.sqlite-(wal|shm)$/.test(entry.name)) continue;
      restoreRoots.push({ source, backup: relative(tempDir, destination), existed: true, directory: entry.isDirectory() });
      if (entry.isDirectory()) {
        await mkdir(destination, { recursive: true, mode: SNAPSHOT_DIR_MODE });
        await copyTree(source, destination, copiedDestinations, tempDir, inventory);
      }
      else if (entry.isFile() && source !== configPath && !/\.sqlite-(wal|shm)$/.test(entry.name)) {
        await copyFileIfPresent(source, destination, copiedDestinations);
        inventory.files[relative(tempDir, destination)] = {
          mode: (await stat(source)).mode & 0o777, sha256: await sha256File(destination),
        };
      }
    }

    // A first migration may create these roots. Rollback must remove their new
    // contents as a unit, rather than overlaying old rows onto a newer database.
    for (const name of ['agents', 'state', 'credentials', 'extensions']) {
      if (!restoreRoots.some(root => root.source === join(stateDir, name))) {
        restoreRoots.push({ source: join(stateDir, name), backup: name === 'agents' ? name : join('state-files', name),
          existed: false, directory: true });
      }
    }
    for (const root of [...restoreRoots]) {
      if (!root.directory && root.source.endsWith('.sqlite')) {
        for (const suffix of ['-wal', '-shm']) restoreRoots.push({
          source: `${root.source}${suffix}`, backup: `${root.backup}${suffix}`, existed: false, directory: false,
        });
      }
    }

    // Auth/session paths can be explicitly placed outside the standard state
    // tree. Capture those migration inputs too; never traverse plugin peers.
    const contains = (parent: string, child: string) => {
      const rel = relative(parent, child);
      return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
    };
    const config = JSON5.parse(await readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    }));
    const agents = [...(Array.isArray(config.agents?.list) ? config.agents.list : []),
      ...Object.entries(config.agents?.entries ?? {}).map(([id, entry]) => ({ ...(entry as object), id }))];
    const expand = (value: string) => resolve(value.startsWith('~/') ? join(homedir(), value.slice(2)) : value);
    const candidates = new Set<string>();
    const physicalStateDir = await realpath(stateDir);
    const physicalHome = await realpath(homedir());
    for (const agent of agents) if (typeof agent.agentDir === 'string') candidates.add(expand(agent.agentDir));
    if (typeof config.session?.store === 'string') {
      for (const id of new Set(['main', ...agents.map(agent => agent.id)])) {
        if (typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)) {
          candidates.add(dirname(expand(config.session.store.replaceAll('{agentId}', id))));
        }
      }
    }
    if (configInfo?.isSymbolicLink()) candidates.add(await realpath(configPath));
    for (const link of inventory.links) {
      if (!/^(agents|state-files[\\/](agents|state|credentials))([\\/]|$)/.test(link.path)) continue;
      const root = restoreRoots.find(root => contains(resolve(tempDir, root.backup), resolve(tempDir, link.path)));
      if (!root) continue;
      const original = resolve(root.source, relative(resolve(tempDir, root.backup), resolve(tempDir, link.path)));
      const target = await realpath(original).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (target) candidates.add(target);
    }
    for (const candidate of [...candidates].sort((a, b) => a.length - b.length)) {
      const source = await realpath(candidate).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return candidate;
        throw error;
      });
      // Compare physical paths too: Windows junction aliases and macOS /tmp
      // aliases must not turn an already captured Agent into a second root.
      const capturedRoots = await Promise.all(restoreRoots.filter(root => root.existed
        && !inventory.links.some(link => link.path === root.backup)).map(root => realpath(root.source)));
      if (capturedRoots.some(root => contains(root, source))) continue;
      if (contains(source, physicalStateDir) || source === physicalHome || source === dirname(source)) {
        throw new Error(`Unsafe external migration root: ${source}`);
      }
      const info = await lstat(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      const backupPath = join('external', String(externalRoots.length));
      const destination = join(tempDir, backupPath);
      externalRoots.push(source);
      restoreRoots.push({ source, backup: backupPath, existed: Boolean(info), directory: info?.isDirectory() ?? true });
      if (info?.isDirectory()) {
        await mkdir(destination, { recursive: true, mode: SNAPSHOT_DIR_MODE });
        await copyTree(source, destination, copiedDestinations, tempDir, inventory);
      } else if (info?.isFile()) {
        await copyFileIfPresent(source, destination, copiedDestinations);
        inventory.files[backupPath] = { mode: info.mode & 0o777, sha256: await sha256File(destination) };
      }
    }

    const files = copiedDestinations.map((path) => relative(tempDir, path)).sort();
    await writeFile(join(tempDir, 'snapshot.json'), `${JSON.stringify({
      upgrade: UPGRADE_ID,
      formatVersion: 2,
      createdAt: new Date().toISOString(),
      configPath,
      stateDir,
      files,
      fileInfo: inventory.files,
      directories: inventory.directories,
      links: inventory.links,
      restoreRoots,
      externalRoots,
      gatewayPort: config.gateway?.port ?? 18789,
    }, null, 2)}\n`, { encoding: 'utf8', mode: SNAPSHOT_FILE_MODE });

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

  // Restores retain newer plugin trees here; those trees can contain Windows
  // junctions to the installed runtime. Never recurse through their targets.
  safeRmSync(snapshotDir);
  return { status: 'removed', snapshotDir };
}

/** @deprecated Compatibility alias for tests/extensions from the pre-10.5 branch. */
export const ensureOpenClaw2026_7_1UpgradeSnapshot = ensureOpenClawUpgradeSnapshot;
export const removeOpenClaw2026_7_1UpgradeSnapshot = removeOpenClawUpgradeSnapshot;
