// @vitest-environment node

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
    const sqlitePath = join(stateDir, 'state', 'openclaw.sqlite');
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
    const sqlitePath = join(stateDir, 'state', 'openclaw.sqlite');
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

  it('removes compatibility-patched plugin records from canonical and legacy databases', async () => {
    const {
      removePluginInstallRecordsFromSqlite,
      upsertPluginInstallRecordsIntoSqlite,
    } = await import('@electron/utils/plugin-install-index');
    const sqlitePath = join(stateDir, 'state', 'openclaw.sqlite');
    const record = {
      source: 'npm',
      spec: '@wecom/wecom-openclaw-plugin',
      installPath: '/home/test/.openclaw/extensions/wecom',
      version: '2026.8.17',
      resolvedName: '@wecom/wecom-openclaw-plugin',
      resolvedVersion: '2026.8.17',
      resolvedSpec: '@wecom/wecom-openclaw-plugin@2026.8.17',
    };

    expect(upsertPluginInstallRecordsIntoSqlite({ wecom: record })).toBe(true);
    expect(removePluginInstallRecordsFromSqlite(['wecom'])).toBe(true);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(sqlitePath);
    const row = db.prepare(`
      SELECT install_records_json
        FROM installed_plugin_index
       WHERE index_key = 'installed-plugin-index'
    `).get() as { install_records_json: string };
    db.close();

    expect(JSON.parse(row.install_records_json)).not.toHaveProperty('wecom');
  });

  describe('OpenClaw 2026.10 config_machine_state index', () => {
    const qqbotRecord = {
      source: 'path',
      spec: '/home/test/.openclaw/extensions/qqbot',
      sourcePath: '/home/test/.openclaw/extensions/qqbot',
      installPath: '/home/test/.openclaw/extensions/qqbot',
      version: '2.0.3',
      installedAt: '2026-10-27T00:00:00.000Z',
    };
    const legacyQQBotRecord = {
      source: 'npm',
      spec: '@openclaw/qqbot',
      installPath: '/home/test/.openclaw/extensions/qqbot',
      version: '2026.7.1',
      resolvedName: '@openclaw/qqbot',
      resolvedVersion: '2026.7.1',
      resolvedSpec: '@openclaw/qqbot@2026.7.1',
    };
    const feishuRecord = {
      source: 'path',
      spec: '/home/test/.openclaw/extensions/feishu-openclaw-plugin',
      sourcePath: '/home/test/.openclaw/extensions/feishu-openclaw-plugin',
      installPath: '/home/test/.openclaw/extensions/feishu-openclaw-plugin',
      version: '2026.10.5',
    };

    async function seedModernStateDatabase(options: {
      revision?: number;
      valueJson?: string;
      leaseExpiresAt?: number;
      legacyTable?: boolean;
    } = {}) {
      const { mkdirSync } = await import('node:fs');
      const { DatabaseSync } = await import('node:sqlite');
      mkdirSync(join(stateDir, 'state'), { recursive: true });
      const db = new DatabaseSync(join(stateDir, 'state', 'openclaw.sqlite'));
      db.exec(`
        CREATE TABLE config_machine_state (
          state_key TEXT NOT NULL PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE state_leases (
          scope TEXT NOT NULL,
          lease_key TEXT NOT NULL,
          owner TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          payload_json TEXT,
          PRIMARY KEY (scope, lease_key)
        ) STRICT;
        PRAGMA user_version = 20;
      `);
      const valueJson = options.valueJson ?? JSON.stringify({
        revision: options.revision ?? 1_000,
        index: {
          version: 1,
          hostContractVersion: '2026.10.5',
          compatRegistryVersion: 'registry-1',
          migrationVersion: 1,
          policyHash: 'policy-1',
          generatedAtMs: 1_000,
          installRecords: { qqbot: legacyQQBotRecord, 'feishu-openclaw-plugin': feishuRecord },
          plugins: [
            { pluginId: 'qqbot', installOwner: 'qqbot', rootDir: '/home/test/.openclaw/extensions/qqbot' },
            { pluginId: 'feishu', installOwner: 'feishu-openclaw-plugin' },
          ],
          diagnostics: [],
        },
      });
      db.prepare('INSERT INTO config_machine_state VALUES (?, ?, ?)').run('plugins.installedIndex', valueJson, 1_000);
      if (options.leaseExpiresAt !== undefined) {
        db.prepare('INSERT INTO state_leases VALUES (?, ?, ?, ?, ?)')
          .run('core:plugin-lifecycle', 'global', 'openclaw', options.leaseExpiresAt, null);
      }
      if (options.legacyTable) {
        db.exec(`CREATE TABLE installed_plugin_index (index_key TEXT PRIMARY KEY, install_records_json TEXT);`);
      }
      db.close();
    }

    async function readModernIndex() {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(stateDir, 'state', 'openclaw.sqlite'));
      const row = db.prepare("SELECT value_json, updated_at_ms FROM config_machine_state WHERE state_key = 'plugins.installedIndex'")
        .get() as { value_json: string; updated_at_ms: number };
      const legacyTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'installed_plugin_index'").get();
      db.close();
      return {
        value: JSON.parse(row.value_json) as {
          revision: number;
          index: {
            policyHash: string;
            installRecords: Record<string, Record<string, unknown>>;
            plugins: Array<Record<string, unknown>>;
          };
        },
        updatedAtMs: row.updated_at_ms,
        hasLegacyTable: Boolean(legacyTable),
      };
    }

    it('writes install records into plugins.installedIndex without recreating the retired table', async () => {
      await seedModernStateDatabase();
      const {
        removePluginInstallRecordsFromSqlite,
        upsertPluginInstallRecordsIntoSqlite,
      } = await import('@electron/utils/plugin-install-index');

      expect(removePluginInstallRecordsFromSqlite(['qqbot'])).toBe(true);
      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(true);

      const { value, updatedAtMs, hasLegacyTable } = await readModernIndex();
      expect(hasLegacyTable).toBe(false);
      expect(value.revision).toBeGreaterThan(1_000);
      expect(updatedAtMs).toBe(value.revision);
      expect(value.index.policyHash).toBe('policy-1');
      expect(value.index.installRecords).toEqual({
        'feishu-openclaw-plugin': feishuRecord,
        'openclaw-qqbot': qqbotRecord,
      });
      // The stale qqbot projection is dropped so OpenClaw rebuilds it.
      expect(value.index.plugins).toEqual([{ pluginId: 'feishu', installOwner: 'feishu-openclaw-plugin' }]);
    });

    it('keeps the revision when the record is unchanged apart from installedAt', async () => {
      await seedModernStateDatabase();
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(true);
      const first = await readModernIndex();
      expect(upsertPluginInstallRecordsIntoSqlite({
        'openclaw-qqbot': { ...qqbotRecord, installedAt: '2026-10-28T00:00:00.000Z' },
      })).toBe(false);
      const second = await readModernIndex();
      expect(second.value.revision).toBe(first.value.revision);
    });

    it('preserves capability consent when ClawX refreshes a record', async () => {
      await seedModernStateDatabase();
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
      const acceptance = {
        acceptedSurface: { channels: ['qqbot'] },
        acceptedSurfaceHash: 'hash-1',
        acceptedSurfaceAt: '2026-10-27T01:00:00.000Z',
      };

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': { ...qqbotRecord, ...acceptance } })).toBe(true);
      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': { ...qqbotRecord, version: '2.0.4' } })).toBe(true);

      expect((await readModernIndex()).value.index.installRecords['openclaw-qqbot']).toEqual({
        ...qqbotRecord,
        version: '2.0.4',
        ...acceptance,
      });
    });

    it('drops a retired installed_plugin_index table recreated by earlier ClawX builds', async () => {
      await seedModernStateDatabase({ legacyTable: true });
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(true);
      expect((await readModernIndex()).hasLegacyTable).toBe(false);
    });

    it('does not write while OpenClaw holds the plugin lifecycle lease', async () => {
      await seedModernStateDatabase({ leaseExpiresAt: Date.now() + 60_000 });
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(false);
      const { value } = await readModernIndex();
      expect(value.revision).toBe(1_000);
      expect(value.index.installRecords).not.toHaveProperty('openclaw-qqbot');
      expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('holds the state lease'));
    });

    it('ignores an expired plugin lifecycle lease', async () => {
      await seedModernStateDatabase({ leaseExpiresAt: Date.now() - 1 });
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(true);
      expect((await readModernIndex()).value.index.installRecords).toHaveProperty('openclaw-qqbot');
    });

    it('leaves an invalid index row for OpenClaw Doctor', async () => {
      await seedModernStateDatabase({ valueJson: '{"revision":"broken"}' });
      const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');

      expect(upsertPluginInstallRecordsIntoSqlite({ 'openclaw-qqbot': qqbotRecord })).toBe(false);
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(stateDir, 'state', 'openclaw.sqlite'));
      const row = db.prepare("SELECT value_json FROM config_machine_state WHERE state_key = 'plugins.installedIndex'")
        .get() as { value_json: string };
      db.close();
      expect(row.value_json).toBe('{"revision":"broken"}');
      expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('run OpenClaw Doctor'));
    });
  });
});
