import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export const CLAWX_DATA_VERSION = 1;

export interface ClawXDataLayout {
  root: string;
  stateDir: string;
  dataVersionPath: string;
  migrationJournalPath: string;
  locksDir: string;
  writerLockPath: string;
  appDir: string;
  credentialsDir: string;
  skillsDir: string;
  workspacesDir: string;
  agentWorkspacesDir: string;
  runtimesDir: string;
  ccConnectRuntimeDir: string;
  openClawRuntimeDir: string;
  electronUserDataDir: string;
  logsDir: string;
  backupsDir: string;
  cacheDir: string;
}

export interface ClawXDataVersionFile {
  schema: 'clawx-data';
  version: number;
  createdAt: string;
  updatedAt: string;
}

function cleanOverride(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? resolve(cleaned) : undefined;
}

export function resolveClawXDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  electronUserDataFallback?: string,
): string {
  const fallback = cleanOverride(electronUserDataFallback);
  const fallbackRoot = fallback
    && basename(fallback) === 'electron'
    && basename(dirname(fallback)) === 'system'
    ? resolve(fallback, '..', '..')
    : fallback;
  return cleanOverride(env.CLAWX_DATA_HOME)
    ?? cleanOverride(env.CLAWX_USER_DATA_DIR)
    ?? fallbackRoot
    ?? join(homedir(), '.clawx');
}

export function getClawXDataLayout(
  root = resolveClawXDataRoot(),
  env: NodeJS.ProcessEnv = process.env,
): ClawXDataLayout {
  const resolvedRoot = resolve(root);
  const stateDir = join(resolvedRoot, 'state');
  const locksDir = join(resolvedRoot, 'locks');
  const runtimesDir = join(resolvedRoot, 'runtimes');
  const workspacesDir = join(resolvedRoot, 'workspaces');
  const explicitElectronUserData = cleanOverride(env.CLAWX_USER_DATA_DIR);
  const flatCompatibility = Boolean(explicitElectronUserData && !cleanOverride(env.CLAWX_DATA_HOME));

  return {
    root: resolvedRoot,
    stateDir,
    dataVersionPath: join(stateDir, 'data-version.json'),
    migrationJournalPath: join(stateDir, 'migration-journal.jsonl'),
    locksDir,
    writerLockPath: join(locksDir, 'writer.lock'),
    appDir: flatCompatibility ? resolvedRoot : join(resolvedRoot, 'app'),
    credentialsDir: join(resolvedRoot, 'credentials'),
    skillsDir: join(resolvedRoot, 'skills'),
    workspacesDir,
    agentWorkspacesDir: join(workspacesDir, 'agents'),
    runtimesDir,
    ccConnectRuntimeDir: join(runtimesDir, 'cc-connect'),
    openClawRuntimeDir: join(runtimesDir, 'openclaw'),
    electronUserDataDir: explicitElectronUserData ?? join(resolvedRoot, 'system', 'electron'),
    logsDir: join(resolvedRoot, 'logs'),
    backupsDir: join(resolvedRoot, 'backups'),
    cacheDir: join(resolvedRoot, 'cache'),
  };
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function initializeClawXDataLayout(layout = getClawXDataLayout()): ClawXDataVersionFile {
  for (const dir of [
    layout.stateDir,
    layout.locksDir,
    layout.appDir,
    layout.credentialsDir,
    layout.skillsDir,
    layout.agentWorkspacesDir,
    layout.ccConnectRuntimeDir,
    layout.openClawRuntimeDir,
    layout.electronUserDataDir,
    layout.logsDir,
    layout.backupsDir,
    layout.cacheDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(layout.dataVersionPath)) {
    const current = JSON.parse(readFileSync(layout.dataVersionPath, 'utf8')) as Partial<ClawXDataVersionFile>;
    if (current.schema !== 'clawx-data' || !Number.isInteger(current.version)) {
      throw new Error(`Invalid ClawX data version file: ${layout.dataVersionPath}`);
    }
    if ((current.version ?? 0) > CLAWX_DATA_VERSION) {
      throw new Error(
        `ClawX data version ${current.version} is newer than supported version ${CLAWX_DATA_VERSION}; refusing to write`,
      );
    }
    return current as ClawXDataVersionFile;
  }

  const now = new Date().toISOString();
  const versionFile: ClawXDataVersionFile = {
    schema: 'clawx-data',
    version: CLAWX_DATA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  writeJsonAtomic(layout.dataVersionPath, versionFile);
  return versionFile;
}
