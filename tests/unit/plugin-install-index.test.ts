import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
  },
}));

describe('plugin install index sqlite persistence', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stateDir = mkdtempSync(join(tmpdir(), 'clawx-openclaw-state-'));
    previousStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates sqlite and upserts trusted whatsapp install records', async () => {
    const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
    const sqlitePath = join(stateDir, 'openclaw.sqlite');
    const record = {
      source: 'npm',
      spec: '@openclaw/whatsapp',
      installPath: '/home/test/.openclaw/extensions/whatsapp',
      version: '2026.6.10',
      resolvedName: '@openclaw/whatsapp',
      resolvedVersion: '2026.6.10',
      resolvedSpec: '@openclaw/whatsapp@2026.6.10',
      installedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(upsertPluginInstallRecordsIntoSqlite({ whatsapp: record })).toBe(true);
    expect(existsSync(sqlitePath)).toBe(true);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqlitePath);
    const row = db.prepare(`
      SELECT install_records_json
        FROM installed_plugin_index
       WHERE index_key = 'installed-plugin-index'
    `).get() as { install_records_json: string };
    db.close();

    const persisted = JSON.parse(row.install_records_json) as Record<string, unknown>;
    expect(persisted.whatsapp).toEqual(record);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      '[plugin] Persisted trusted install metadata to SQLite for: whatsapp',
    );
  });

  it('updates stale sqlite records when installPath changes', async () => {
    const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
    const sqlitePath = join(stateDir, 'openclaw.sqlite');
    const stale = {
      source: 'npm',
      spec: '@openclaw/whatsapp',
      installPath: '/old/path/whatsapp',
      version: '2026.6.10',
      resolvedName: '@openclaw/whatsapp',
      resolvedVersion: '2026.6.10',
      resolvedSpec: '@openclaw/whatsapp@2026.6.10',
    };
    const fresh = {
      ...stale,
      installPath: '/home/test/.openclaw/extensions/whatsapp',
      installedAt: '2026-01-02T00:00:00.000Z',
    };

    expect(upsertPluginInstallRecordsIntoSqlite({ whatsapp: stale })).toBe(true);
    expect(upsertPluginInstallRecordsIntoSqlite({ whatsapp: fresh })).toBe(true);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqlitePath);
    const row = db.prepare(`
      SELECT install_records_json
        FROM installed_plugin_index
       WHERE index_key = 'installed-plugin-index'
    `).get() as { install_records_json: string };
    db.close();

    const persisted = JSON.parse(row.install_records_json) as Record<string, Record<string, unknown>>;
    expect(persisted.whatsapp.installPath).toBe(fresh.installPath);
  });
});
