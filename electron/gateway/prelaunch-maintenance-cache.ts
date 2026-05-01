import { app } from 'electron';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILE_NAME = 'gateway-prelaunch-maintenance-cache.json';

export type PrelaunchMaintenanceTaskName =
  | 'plugin-maintenance'
  | 'runtime-deps-cleanup'
  | 'skills-symlink-cleanup';

export interface PrelaunchMaintenanceRunResult {
  executed: boolean;
  reason: 'cache-hit' | 'cache-miss' | 'cache-unavailable';
}

interface CacheEntry {
  key: string;
  updatedAt: string;
}

interface CacheFile {
  schemaVersion: number;
  tasks: Partial<Record<PrelaunchMaintenanceTaskName, CacheEntry>>;
}

function getDefaultCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE_NAME);
}

function emptyCache(): CacheFile {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    tasks: {},
  };
}

function readCache(cachePath: string): CacheFile | null {
  try {
    if (!existsSync(cachePath)) return emptyCache();
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as CacheFile;
    if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !parsed.tasks) {
      return emptyCache();
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, cache: CacheFile): boolean {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export function pathSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.isDirectory() ? 'dir' : 'file'}:${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

export function directoryChildrenSignature(path: string, maxEntries = 200): string {
  try {
    const entries = readdirSync(path, { withFileTypes: true, encoding: 'utf8' })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, maxEntries)
      .map((entry) => {
        const childPath = join(path, entry.name);
        return [
          entry.name,
          entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file',
          pathSignature(childPath),
        ].join(':');
      });
    return stableJson(entries);
  } catch {
    return 'missing';
  }
}

export function buildPrelaunchMaintenanceCacheKey(parts: Record<string, unknown>): string {
  return stableJson({
    schemaVersion: CACHE_SCHEMA_VERSION,
    ...parts,
  });
}

export function runCachedPrelaunchMaintenanceTask(
  taskName: PrelaunchMaintenanceTaskName,
  cacheKey: string,
  task: () => void,
  options: { cachePath?: string } = {},
): PrelaunchMaintenanceRunResult {
  const cachePath = options.cachePath ?? getDefaultCachePath();
  const cache = readCache(cachePath);
  if (!cache) {
    task();
    return { executed: true, reason: 'cache-unavailable' };
  }

  if (cache.tasks[taskName]?.key === cacheKey) {
    return { executed: false, reason: 'cache-hit' };
  }

  task();
  cache.tasks[taskName] = {
    key: cacheKey,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cachePath, cache);
  return { executed: true, reason: 'cache-miss' };
}
