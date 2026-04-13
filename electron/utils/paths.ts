/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { createRequire } from 'node:module';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';

const require = createRequire(import.meta.url);

type ElectronAppLike = Pick<typeof import('electron').app, 'isPackaged' | 'getPath' | 'getAppPath'>;

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

export type OpenClawInstallationSource =
  | 'packaged-openclaw'
  | 'build-openclaw'
  | 'node_modules-openclaw';

export interface OpenClawInstallationCandidate {
  dir: string;
  entryPath: string;
  packageExists: boolean;
  version?: string;
  source: OpenClawInstallationSource;
}

export interface OpenClawResolution {
  declaredVersion?: string;
  selected: OpenClawInstallationCandidate;
  candidates: OpenClawInstallationCandidate[];
  versionMismatch: boolean;
  warning?: string;
}

function getElectronApp() {
  if (process.versions?.electron) {
    return (require('electron') as typeof import('electron')).app;
  }

  const fallbackUserData = process.env.CLAWX_USER_DATA_DIR?.trim() || join(homedir(), '.clawx');
  const fallbackAppPath = process.cwd();
  const fallbackApp: ElectronAppLike = {
    isPackaged: false,
    getPath: (name) => {
      if (name === 'userData') return fallbackUserData;
      return fallbackUserData;
    },
    getAppPath: () => fallbackAppPath,
  };
  return fallbackApp;
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

type RootPackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function normalizeDeclaredVersion(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const match = trimmed.match(/\d{4}\.\d+\.\d+/);
  return match?.[0] ?? trimmed;
}

function readOpenClawVersion(dir: string): string | undefined {
  const pkg = readJsonFile<{ version?: string }>(join(dir, 'package.json'));
  return typeof pkg?.version === 'string' && pkg.version.trim()
    ? pkg.version.trim()
    : undefined;
}

export function getDeclaredOpenClawVersion(appPath = getElectronApp().getAppPath()): string | undefined {
  const rootPkg = readJsonFile<RootPackageJson>(join(appPath, 'package.json'));
  return normalizeDeclaredVersion(
    rootPkg?.dependencies?.openclaw
    ?? rootPkg?.devDependencies?.openclaw,
  );
}

function dedupeCandidatePaths(
  entries: Array<{ dir: string; source: OpenClawInstallationSource }>,
): Array<{ dir: string; source: OpenClawInstallationSource }> {
  const seen = new Set<string>();
  const next: Array<{ dir: string; source: OpenClawInstallationSource }> = [];

  for (const entry of entries) {
    if (seen.has(entry.dir)) continue;
    seen.add(entry.dir);
    next.push(entry);
  }

  return next;
}

export function collectOpenClawCandidates(params?: {
  isPackaged?: boolean;
  appPath?: string;
  resourcesPath?: string;
  cwd?: string;
}): OpenClawInstallationCandidate[] {
  const electronApp = getElectronApp();
  const isPackaged = params?.isPackaged ?? electronApp.isPackaged;
  const appPath = params?.appPath ?? electronApp.getAppPath();
  const cwd = params?.cwd ?? process.cwd();

  const rawCandidates = isPackaged
    ? [
      {
        dir: join(params?.resourcesPath ?? process.resourcesPath, 'openclaw'),
        source: 'packaged-openclaw' as const,
      },
    ]
    : dedupeCandidatePaths([
      { dir: join(appPath, 'build', 'openclaw'), source: 'build-openclaw' },
      { dir: join(cwd, 'build', 'openclaw'), source: 'build-openclaw' },
      { dir: join(__dirname, '../../build/openclaw'), source: 'build-openclaw' },
      { dir: join(appPath, 'node_modules', 'openclaw'), source: 'node_modules-openclaw' },
      { dir: join(cwd, 'node_modules', 'openclaw'), source: 'node_modules-openclaw' },
      { dir: join(__dirname, '../../node_modules/openclaw'), source: 'node_modules-openclaw' },
    ]);

  return rawCandidates.map(({ dir, source }) => {
    const packageExists = existsSync(dir) && existsSync(join(dir, 'package.json'));
    return {
      dir,
      entryPath: join(dir, 'openclaw.mjs'),
      packageExists,
      version: packageExists ? readOpenClawVersion(dir) : undefined,
      source,
    };
  });
}

export function selectOpenClawCandidate(
  candidates: OpenClawInstallationCandidate[],
  declaredVersion?: string,
): OpenClawInstallationCandidate | undefined {
  const available = candidates.filter((candidate) => candidate.packageExists);
  if (available.length === 0) {
    return candidates[0];
  }

  const normalizedDeclaredVersion = normalizeDeclaredVersion(declaredVersion);
  if (normalizedDeclaredVersion) {
    const exactMatch = available.find((candidate) => candidate.version === normalizedDeclaredVersion);
    if (exactMatch) {
      return exactMatch;
    }
  }

  return available[0];
}

export function formatOpenClawVersionWarning(params: {
  declaredVersion?: string;
  resolvedVersion?: string;
  dir: string;
  source: OpenClawInstallationSource;
}): string | undefined {
  const declaredVersion = normalizeDeclaredVersion(params.declaredVersion);
  const resolvedVersion = params.resolvedVersion?.trim();

  if (!declaredVersion || !resolvedVersion || declaredVersion === resolvedVersion) {
    return undefined;
  }

  return [
    `OpenClaw version mismatch: declared ${declaredVersion}`,
    `but resolved ${resolvedVersion} from ${params.dir}`,
    `(source=${params.source}).`,
  ].join(' ');
}

export function resolveOpenClawInstallation(params?: {
  isPackaged?: boolean;
  appPath?: string;
  resourcesPath?: string;
  cwd?: string;
  declaredVersion?: string;
}): OpenClawResolution {
  const candidates = collectOpenClawCandidates(params);
  const fallbackCandidate = candidates[0] ?? {
    dir: join(__dirname, '../../node_modules/openclaw'),
    entryPath: join(__dirname, '../../node_modules/openclaw', 'openclaw.mjs'),
    packageExists: false,
    source: (params?.isPackaged ?? getElectronApp().isPackaged)
      ? 'packaged-openclaw'
      : 'node_modules-openclaw',
  };
  const declaredVersion = params?.declaredVersion ?? getDeclaredOpenClawVersion(params?.appPath);
  const selected = selectOpenClawCandidate(candidates, declaredVersion) ?? fallbackCandidate;
  const warning = formatOpenClawVersionWarning({
    declaredVersion,
    resolvedVersion: selected.version,
    dir: selected.dir,
    source: selected.source,
  });

  return {
    declaredVersion,
    selected,
    candidates,
    versionMismatch: Boolean(warning),
    warning,
  };
}

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Get OpenClaw config directory
 */
export function getOpenClawConfigDir(): string {
  return join(homedir(), '.openclaw');
}

/**
 * Get OpenClaw skills directory
 */
export function getOpenClawSkillsDir(): string {
  return join(getOpenClawConfigDir(), 'skills');
}

/**
 * Get ClawX config directory
 */
export function getClawXConfigDir(): string {
  return join(homedir(), '.clawx');
}

/**
 * Get ClawX logs directory
 */
export function getLogsDir(): string {
  return join(getElectronApp().getPath('userData'), 'logs');
}

/**
 * Get ClawX data directory
 */
export function getDataDir(): string {
  return getElectronApp().getPath('userData');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get resources directory (for bundled assets)
 */
export function getResourcesDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'resources');
  }
  return join(__dirname, '../../resources');
}

/**
 * Get preload script path
 */
export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/**
 * Get OpenClaw package directory
 * - Production (packaged): from resources/openclaw (copied by electron-builder extraResources)
 * - Development: from node_modules/openclaw
 */
export function getOpenClawDir(): string {
  return resolveOpenClawInstallation().selected.dir;
}

/**
 * Get OpenClaw package directory resolved to a real path.
 * Useful when consumers need deterministic module resolution under pnpm symlinks.
 */
export function getOpenClawResolvedDir(): string {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return resolveOpenClawInstallation().selected.entryPath;
}

/**
 * Get ClawHub CLI entry script path (clawdhub.js)
 */
export function getClawHubCliEntryPath(): string {
  return join(getElectronApp().getAppPath(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
}

/**
 * Get ClawHub CLI binary path (node_modules/.bin)
 */
export function getClawHubCliBinPath(): string {
  const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
  return join(getElectronApp().getAppPath(), 'node_modules', '.bin', binName);
}

/**
 * Check if OpenClaw package exists
 */
export function isOpenClawPresent(): boolean {
  return resolveOpenClawInstallation().selected.packageExists;
}

/**
 * Check if OpenClaw is built (has dist folder)
 * For the npm package, this should always be true since npm publishes the built dist.
 */
export function isOpenClawBuilt(): boolean {
  const dir = getOpenClawDir();
  const distDir = join(dir, 'dist');
  const hasDist = existsSync(distDir);
  return hasDist;
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
  declaredVersion?: string;
  versionMismatch?: boolean;
  warning?: string;
  source?: OpenClawInstallationSource;
  candidateVersions?: Array<{
    dir: string;
    source: OpenClawInstallationSource;
    version?: string;
    packageExists: boolean;
  }>;
}

export function getOpenClawStatus(): OpenClawStatus {
  const resolution = resolveOpenClawInstallation();
  const dir = resolution.selected.dir;
  const version = resolution.selected.version;

  const status: OpenClawStatus = {
    packageExists: resolution.selected.packageExists,
    isBuilt: isOpenClawBuilt(),
    entryPath: resolution.selected.entryPath,
    dir,
    version,
    declaredVersion: resolution.declaredVersion,
    versionMismatch: resolution.versionMismatch,
    warning: resolution.warning,
    source: resolution.selected.source,
    candidateVersions: resolution.candidates.map((candidate) => ({
      dir: candidate.dir,
      source: candidate.source,
      version: candidate.version,
      packageExists: candidate.packageExists,
    })),
  };

  try {
    const { logger } = require('./logger') as typeof import('./logger');
    logger.info('OpenClaw status:', status);
  } catch {
    // Ignore logger bootstrap issues in non-Electron contexts such as unit tests.
  }
  return status;
}
