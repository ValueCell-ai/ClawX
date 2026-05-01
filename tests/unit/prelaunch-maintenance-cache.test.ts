import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPrelaunchMaintenanceCacheKey,
  runCachedPrelaunchMaintenanceTask,
} from '@electron/gateway/prelaunch-maintenance-cache';

describe('prelaunch maintenance cache', () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-prelaunch-cache-'));
    cachePath = join(tempDir, 'cache.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs a task on cache miss and skips it when the cache key is unchanged', () => {
    const task = vi.fn();
    const cacheKey = buildPrelaunchMaintenanceCacheKey({
      task: 'skills-symlink-cleanup',
      appVersion: '1.0.0',
      rootSignature: 'mtime-a',
    });

    expect(runCachedPrelaunchMaintenanceTask(
      'skills-symlink-cleanup',
      cacheKey,
      task,
      { cachePath },
    )).toEqual({ executed: true, reason: 'cache-miss' });
    expect(task).toHaveBeenCalledTimes(1);

    expect(runCachedPrelaunchMaintenanceTask(
      'skills-symlink-cleanup',
      cacheKey,
      task,
      { cachePath },
    )).toEqual({ executed: false, reason: 'cache-hit' });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('reruns a task when the cache key changes', () => {
    const task = vi.fn();
    const firstKey = buildPrelaunchMaintenanceCacheKey({
      task: 'runtime-deps-cleanup',
      openclawDir: '/old/openclaw',
    });
    const secondKey = buildPrelaunchMaintenanceCacheKey({
      task: 'runtime-deps-cleanup',
      openclawDir: '/new/openclaw',
    });

    runCachedPrelaunchMaintenanceTask('runtime-deps-cleanup', firstKey, task, { cachePath });
    const result = runCachedPrelaunchMaintenanceTask('runtime-deps-cleanup', secondKey, task, { cachePath });

    expect(result).toEqual({ executed: true, reason: 'cache-miss' });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('treats cache schema changes as misses', () => {
    const task = vi.fn();
    const cacheKey = buildPrelaunchMaintenanceCacheKey({
      task: 'plugin-maintenance',
      configuredChannels: ['feishu'],
    });
    writeFileSync(cachePath, JSON.stringify({
      schemaVersion: 0,
      tasks: {
        'plugin-maintenance': {
          key: cacheKey,
          updatedAt: new Date().toISOString(),
        },
      },
    }), 'utf-8');

    const result = runCachedPrelaunchMaintenanceTask('plugin-maintenance', cacheKey, task, { cachePath });

    expect(result).toEqual({ executed: true, reason: 'cache-miss' });
    expect(task).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(cachePath, 'utf-8')).schemaVersion).toBe(1);
  });

  it('runs conservatively when the cache file cannot be read', () => {
    const task = vi.fn();
    const blockedCachePath = join(tempDir, 'blocked-cache');
    mkdirSync(blockedCachePath);
    const cacheKey = buildPrelaunchMaintenanceCacheKey({
      task: 'plugin-maintenance',
      configuredChannels: [],
    });

    const result = runCachedPrelaunchMaintenanceTask(
      'plugin-maintenance',
      cacheKey,
      task,
      { cachePath: blockedCachePath },
    );

    expect(result).toEqual({ executed: true, reason: 'cache-unavailable' });
    expect(task).toHaveBeenCalledTimes(1);
  });
});
