/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { app } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

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
 * Get ClawX config directory
 */
export function getClawXConfigDir(): string {
  return join(homedir(), '.clawx');
}

/**
 * Get ClawX logs directory
 */
export function getLogsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

/**
 * Get ClawX data directory
 */
export function getDataDir(): string {
  return app.getPath('userData');
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
  if (app.isPackaged) {
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
 * Get OpenClaw submodule directory
 */
export function getOpenClawDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'openclaw');
  }
  return join(__dirname, '../../openclaw');
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Check if OpenClaw submodule exists
 */
export function isOpenClawSubmodulePresent(): boolean {
  return existsSync(getOpenClawDir()) && existsSync(join(getOpenClawDir(), 'package.json'));
}

/**
 * Check if OpenClaw is built (has dist folder with entry.js)
 */
export function isOpenClawBuilt(): boolean {
  return existsSync(join(getOpenClawDir(), 'dist', 'entry.js'));
}

/**
 * Check if OpenClaw has node_modules installed
 */
export function isOpenClawInstalled(): boolean {
  if (app.isPackaged) {
    return true;
  }
  return existsSync(join(getOpenClawDir(), 'node_modules'));
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  submoduleExists: boolean;
  isInstalled: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getOpenClawDir();
  return {
    submoduleExists: isOpenClawSubmodulePresent(),
    isInstalled: isOpenClawInstalled(),
    isBuilt: isOpenClawBuilt(),
    entryPath: getOpenClawEntryPath(),
    dir,
  };
}
