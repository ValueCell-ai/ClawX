import { chmod, copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';

const UPGRADE_ID = 'openclaw-2026.7.1';
const SNAPSHOT_DIR_MODE = 0o700;
const SNAPSHOT_FILE_MODE = 0o600;
const AGENT_AUTH_BASENAMES = new Set([
  'auth-profiles.json',
  'openclaw-agent.sqlite',
  'openclaw-agent.sqlite-wal',
  'openclaw-agent.sqlite-shm',
]);

export type OpenClawUpgradeSnapshotResult = {
  status: 'created' | 'exists';
  snapshotDir: string;
  files: string[];
};

export type OpenClawUpgradeSnapshotCleanupResult = {
  status: 'removed' | 'missing';
  snapshotDir: string;
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

/**
 * Creates a one-time pre-migration snapshot before ClawX first starts the
 * OpenClaw 2026.7.1 Gateway. SQLite databases are copied together with their
 * WAL/SHM sidecars; channel credentials under `credentials/` are intentionally
 * excluded because this migration does not rewrite them.
 */
export async function ensureOpenClaw2026_7_1UpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const configPath = resolve(options.configPath ?? resolveOpenClawConfigPath());
  const snapshotDir = resolveSnapshotDir(stateDir);
  const markerPath = join(snapshotDir, 'snapshot.json');

  if (await snapshotMarkerExists(markerPath)) {
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { files?: unknown };
      return {
        status: 'exists',
        snapshotDir,
        files: Array.isArray(marker.files)
          ? marker.files.filter((value): value is string => typeof value === 'string')
          : [],
      };
    } catch {
      // Replace malformed/incomplete snapshots below.
    }
  }

  const tempDir = `${snapshotDir}.tmp-${process.pid}-${Date.now()}`;
  const copiedDestinations: string[] = [];
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true, mode: SNAPSHOT_DIR_MODE });

  try {
    await copyFileIfPresent(configPath, join(tempDir, 'config', basename(configPath)), copiedDestinations);

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
      (name) => AGENT_AUTH_BASENAMES.has(name),
    );

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
 * Removes the one-time OpenClaw 2026.7.1 pre-migration snapshot after Gateway
 * startup succeeds so duplicated config/auth/SQLite secrets do not linger.
 */
export async function removeOpenClaw2026_7_1UpgradeSnapshot(
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
