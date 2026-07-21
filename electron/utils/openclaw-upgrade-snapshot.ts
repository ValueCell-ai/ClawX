import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from './paths';

const UPGRADE_ID = 'openclaw-2026.7.1';
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

type SnapshotOptions = {
  stateDir?: string;
  configPath?: string;
};

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function copyFileIfPresent(source: string, destination: string, copied: string[]): Promise<void> {
  if (!await isRegularFile(source)) return;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
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
    const source = join(sourceRoot, entry.name);
    const destination = join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, destination, copied, includeFile);
    } else if (entry.isFile() && includeFile(entry.name)) {
      await copyFileIfPresent(source, destination, copied);
    }
  }
}

/**
 * Creates a one-time pre-migration snapshot before ClawX first starts the
 * OpenClaw 2026.7.1 Gateway. SQLite databases are copied together with their
 * WAL/SHM sidecars; OpenClaw remains responsible for applying migrations.
 */
export async function ensureOpenClaw2026_7_1UpgradeSnapshot(
  options: SnapshotOptions = {},
): Promise<OpenClawUpgradeSnapshotResult> {
  const stateDir = resolve(options.stateDir ?? resolveOpenClawStateDir());
  const configPath = resolve(options.configPath ?? resolveOpenClawConfigPath());
  const snapshotDir = join(stateDir, 'backups', `clawx-${UPGRADE_ID}-pre-migration`);
  const markerPath = join(snapshotDir, 'snapshot.json');

  if (await isRegularFile(markerPath)) {
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
  await mkdir(tempDir, { recursive: true, mode: 0o700 });

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
    await copyTree(
      join(stateDir, 'credentials'),
      join(tempDir, 'credentials'),
      copiedDestinations,
      () => true,
    );

    const files = copiedDestinations.map((path) => relative(tempDir, path)).sort();
    await writeFile(join(tempDir, 'snapshot.json'), `${JSON.stringify({
      upgrade: UPGRADE_ID,
      createdAt: new Date().toISOString(),
      configPath,
      stateDir,
      files,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    await rm(snapshotDir, { recursive: true, force: true });
    await mkdir(dirname(snapshotDir), { recursive: true, mode: 0o700 });
    await rename(tempDir, snapshotDir);
    return { status: 'created', snapshotDir, files };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}
