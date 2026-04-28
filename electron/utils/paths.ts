/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'path';
import { homedir } from 'os';
import {
  cpSync,
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';

const require = createRequire(import.meta.url);
const OPENCLAW_RUNTIME_MANIFEST = 'clawx-runtime-deps.json';
const OPENCLAW_RUNTIME_READY_MARKER = '.clawx-runtime-ready.json';
const OPENCLAW_RUNTIME_KEEP_COUNT = 2;

let materializedOpenClawDir: string | null = null;

type ElectronAppLike = Pick<typeof import('electron').app, 'isPackaged' | 'getPath' | 'getAppPath'>;

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

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

function toFsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath || filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!windowsPath.match(/^[a-zA-Z]:\\/u) && !windowsPath.startsWith('\\\\')) return windowsPath;
  if (windowsPath.startsWith('\\\\')) return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  return `\\\\?\\${windowsPath}`;
}

function readJsonFile<T extends Record<string, unknown>>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(toFsPath(filePath), 'utf-8')) as T;
  } catch {
    return null;
  }
}

function hashOpenClawRuntime(sourceDir: string): { key: string; version: string; manifestHash: string } {
  const packageJsonPath = join(sourceDir, 'package.json');
  const manifestPath = join(sourceDir, OPENCLAW_RUNTIME_MANIFEST);
  const packageJsonRaw = existsSync(toFsPath(packageJsonPath)) ? readFileSync(toFsPath(packageJsonPath), 'utf-8') : '{}';
  const manifestRaw = existsSync(toFsPath(manifestPath)) ? readFileSync(toFsPath(manifestPath), 'utf-8') : '';
  const packageJson = JSON.parse(packageJsonRaw) as { version?: string };
  const version = packageJson.version || 'unknown';
  const manifestHash = createHash('sha256')
    .update(packageJsonRaw)
    .update('\0')
    .update(manifestRaw)
    .digest('hex')
    .slice(0, 12);
  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/gu, '_');
  return {
    key: `openclaw-${safeVersion}-${manifestHash}`,
    version,
    manifestHash,
  };
}

function isMaterializedRuntimeReady(targetDir: string, version: string, manifestHash: string): boolean {
  const marker = readJsonFile<{ version?: unknown; manifestHash?: unknown }>(
    join(targetDir, OPENCLAW_RUNTIME_READY_MARKER),
  );
  if (marker?.version !== version || marker?.manifestHash !== manifestHash) return false;
  return existsSync(toFsPath(join(targetDir, 'openclaw.mjs')))
    && existsSync(toFsPath(join(targetDir, 'package.json')))
    && existsSync(toFsPath(join(targetDir, 'dist')))
    && existsSync(toFsPath(join(targetDir, 'node_modules')));
}

function isPackagedRuntimeReady(targetDir: string): boolean {
  const marker = readJsonFile<{ version?: unknown; manifestHash?: unknown }>(
    join(targetDir, OPENCLAW_RUNTIME_READY_MARKER),
  );
  if (typeof marker?.version !== 'string' || typeof marker?.manifestHash !== 'string') return false;
  return existsSync(toFsPath(join(targetDir, 'openclaw.mjs')))
    && existsSync(toFsPath(join(targetDir, 'package.json')))
    && existsSync(toFsPath(join(targetDir, 'dist')))
    && existsSync(toFsPath(join(targetDir, 'node_modules')));
}

function isOpenClawRuntimeWritable(runtimeDir: string): boolean {
  try {
    accessSync(toFsPath(runtimeDir), constants.W_OK);
    accessSync(toFsPath(join(runtimeDir, 'dist', 'extensions')), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function cleanupOldOpenClawRuntimes(runtimeRoot: string, keepKey: string): void {
  let entries;
  try {
    entries = readdirSync(toFsPath(runtimeRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('openclaw-'))
      .map((entry) => {
        const fullPath = join(runtimeRoot, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(toFsPath(fullPath)).mtimeMs;
        } catch {
          // Keep unknown entries until a later cleanup pass.
        }
        return { name: entry.name, fullPath, mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return;
  }

  const keep = new Set(entries.slice(0, OPENCLAW_RUNTIME_KEEP_COUNT).map((entry) => entry.name));
  keep.add(keepKey);
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    try {
      rmSync(toFsPath(entry.fullPath), { recursive: true, force: true });
    } catch {
      // Cleanup is best-effort; stale runtimes are harmless.
    }
  }
}

function getPackagedOpenClawSourceDir(): string {
  return join(process.resourcesPath, 'openclaw');
}

function getPackagedOpenClawRuntimeRoot(): string {
  return join(process.resourcesPath, 'openclaw-runtime');
}

function findPackagedOpenClawRuntimeDir(): string | null {
  const runtimeRoot = getPackagedOpenClawRuntimeRoot();
  let entries;
  try {
    entries = readdirSync(toFsPath(runtimeRoot), { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('openclaw-'))
    .map((entry) => join(runtimeRoot, entry.name))
    .filter((candidate) => isPackagedRuntimeReady(candidate))
    .sort((left, right) => right.localeCompare(left));
  return candidates[0] ?? null;
}

function getPackagedOpenClawFallbackSourceDir(): string {
  return findPackagedOpenClawRuntimeDir() ?? getPackagedOpenClawSourceDir();
}

function materializePackagedOpenClawRuntime(): string {
  if (materializedOpenClawDir) return materializedOpenClawDir;

  const sourceDir = getPackagedOpenClawFallbackSourceDir();
  if (!existsSync(toFsPath(sourceDir)) || !existsSync(toFsPath(join(sourceDir, 'package.json')))) {
    return sourceDir;
  }
  const { key, version, manifestHash } = hashOpenClawRuntime(sourceDir);
  const runtimeRoot = join(getElectronApp().getPath('userData'), 'openclaw-runtime');
  const targetDir = join(runtimeRoot, key);

  if (isMaterializedRuntimeReady(targetDir, version, manifestHash)) {
    materializedOpenClawDir = targetDir;
    cleanupOldOpenClawRuntimes(runtimeRoot, key);
    return targetDir;
  }

  mkdirSync(toFsPath(runtimeRoot), { recursive: true });
  const tempDir = join(runtimeRoot, `.tmp-${key}-${process.pid}-${Date.now()}`);
  rmSync(toFsPath(tempDir), { recursive: true, force: true });
  try {
    cpSync(toFsPath(sourceDir), toFsPath(tempDir), {
      recursive: true,
      dereference: true,
      force: true,
    });
    writeFileSync(
      toFsPath(join(tempDir, OPENCLAW_RUNTIME_READY_MARKER)),
      `${JSON.stringify({
        version,
        manifestHash,
        source: sourceDir,
        createdAt: new Date().toISOString(),
      }, null, 2)}\n`,
      'utf-8',
    );
    rmSync(toFsPath(targetDir), { recursive: true, force: true });
    renameSync(toFsPath(tempDir), toFsPath(targetDir));
  } catch (error) {
    rmSync(toFsPath(tempDir), { recursive: true, force: true });
    throw error;
  }

  materializedOpenClawDir = targetDir;
  cleanupOldOpenClawRuntimes(runtimeRoot, key);
  return targetDir;
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
 * - Production (packaged): from resources/openclaw-runtime/openclaw-* (staged by afterPack)
 * - Development: from node_modules/openclaw
 */
export function getOpenClawDir(): string {
  if (getElectronApp().isPackaged) {
    return getPackagedOpenClawFallbackSourceDir();
  }
  // Development: use node_modules/openclaw
  return join(__dirname, '../../node_modules/openclaw');
}

/**
 * Get the OpenClaw runtime directory used for spawned OpenClaw processes.
 *
 * In packaged builds, this prefers the afterPack-staged resources/openclaw-runtime
 * directory. If the app was installed somewhere non-writable, it falls back to a
 * userData copy so OpenClaw's runtime-deps checks can still create lock files.
 */
export function getOpenClawRuntimeDir(): string {
  if (getElectronApp().isPackaged) {
    const packagedRuntimeDir = findPackagedOpenClawRuntimeDir();
    if (packagedRuntimeDir && isOpenClawRuntimeWritable(packagedRuntimeDir)) {
      return packagedRuntimeDir;
    }
    return materializePackagedOpenClawRuntime();
  }
  return getOpenClawDir();
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
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Get OpenClaw entry script path for spawned OpenClaw processes.
 */
export function getOpenClawRuntimeEntryPath(): string {
  return join(getOpenClawRuntimeDir(), 'openclaw.mjs');
}

/**
 * Get the external runtime dependency staging directory for OpenClaw.
 *
 * In packaged mode this intentionally points at the parent of the materialized
 * runtime directory. OpenClaw recognizes an existing openclaw-* package root
 * under OPENCLAW_PLUGIN_STAGE_DIR and reuses its node_modules instead of
 * running npm install into ~/.openclaw/plugin-runtime-deps.
 */
export function getOpenClawPluginStageDir(openclawDir = getOpenClawRuntimeDir()): string | null {
  if (!getElectronApp().isPackaged) return null;
  return dirname(openclawDir);
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
  const dir = getOpenClawDir();
  const pkgJsonPath = join(dir, 'package.json');
  return existsSync(dir) && existsSync(pkgJsonPath);
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
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getOpenClawDir();
  let version: string | undefined;

  // Try to read version from package.json
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    }
  } catch {
    // Ignore version read errors
  }

  const status: OpenClawStatus = {
    packageExists: isOpenClawPresent(),
    isBuilt: isOpenClawBuilt(),
    entryPath: getOpenClawEntryPath(),
    dir,
    version,
  };

  try {
    const { logger } = require('./logger') as typeof import('./logger');
    logger.info('OpenClaw status:', status);
  } catch {
    // Ignore logger bootstrap issues in non-Electron contexts such as unit tests.
  }
  return status;
}
