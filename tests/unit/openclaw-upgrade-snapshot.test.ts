// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureOpenClawUpgradeSnapshot, quarantineLegacyUpdateCheckState, removeOpenClawUpgradeSnapshot } from '@electron/utils/openclaw-upgrade-snapshot';
const roots: string[] = [];
async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), 'clawx-upgrade-'));
  roots.push(stateDir);
  const configPath = join(stateDir, 'openclaw.json');
  await writeFile(configPath, '{"version":"old"}\n');
  return { stateDir, configPath };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('OpenClaw 2026.10.5 upgrade snapshot', () => {
  it('backs up legacy sessions, credentials and media once, with private permissions', async () => {
    const options = await fixture();
    for (const file of ['agents/main/sessions/sessions.json', 'agents/main/sessions/history.jsonl', 'agents/main/agent/auth-profiles.json', 'credentials/channel/token.json', 'media/inbound/image.png']) {
      await mkdir(join(options.stateDir, file, '..'), { recursive: true });
      await writeFile(join(options.stateDir, file), 'synthetic');
    }
    const first = await ensureOpenClawUpgradeSnapshot(options);
    expect(first.status).toBe('created');
    expect(first.snapshotDir).toContain('2026.10.5');
    expect(first.files).toEqual(expect.arrayContaining(['config/openclaw.json', 'agents/main/sessions/sessions.json', 'agents/main/sessions/history.jsonl', 'agents/main/agent/auth-profiles.json', 'state-files/credentials/channel/token.json', 'state-files/media/inbound/image.png']));
    if (process.platform !== 'win32') {
      expect((await stat(join(first.snapshotDir, 'snapshot.json'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(first.snapshotDir, 'agents/main/sessions/history.jsonl'))).mode & 0o777).toBe(0o600);
    }
    await writeFile(options.configPath, '{"version":"new"}');
    const second = await ensureOpenClawUpgradeSnapshot(options);
    expect(second.status).toBe('exists');
    expect(await readFile(join(second.snapshotDir, 'config/openclaw.json'), 'utf8')).toContain('old');
  });
  it('backs up committed WAL pages into a standalone integrity-checked database', async () => {
    const options = await fixture();
    await mkdir(join(options.stateDir, 'state'));
    const db = new DatabaseSync(join(options.stateDir, 'state/openclaw.sqlite'));
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES (\'committed in WAL\');');
      const snapshot = await ensureOpenClawUpgradeSnapshot(options);
      expect(snapshot.files.some(f => /sqlite-(wal|shm)$/.test(f))).toBe(false);
      const restored = new DatabaseSync(join(snapshot.snapshotDir, 'state-files/state/openclaw.sqlite'), { readOnly: true });
      try {
        expect(restored.prepare('SELECT value FROM evidence').get()?.value).toBe('committed in WAL');
        expect(restored.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      } finally { restored.close(); }
    } finally { db.close(); }
  });
  it('fails closed on an invalid database and permits retry without a completion marker', async () => {
    const options = await fixture();
    const file = join(options.stateDir, 'openclaw.sqlite');
    await writeFile(file, 'not a SQLite database');
    await expect(ensureOpenClawUpgradeSnapshot(options)).rejects.toThrow();
    await rm(file);
    expect((await ensureOpenClawUpgradeSnapshot(options)).status).toBe('created');
  });
  it('does not overwrite an incomplete original backup with post-migration state', async () => {
    const options = await fixture();
    const first = await ensureOpenClawUpgradeSnapshot(options);
    await rm(join(first.snapshotDir, 'config/openclaw.json'));
    await writeFile(options.configPath, 'new state');
    await expect(ensureOpenClawUpgradeSnapshot(options)).rejects.toThrow('Incomplete upgrade snapshot');
  });
  it('coalesces concurrent startup calls', async () => {
    const options = await fixture();
    const [a, b] = await Promise.all([ensureOpenClawUpgradeSnapshot(options), ensureOpenClawUpgradeSnapshot(options)]);
    expect(a).toEqual(b);
  });
  it('never follows external symlinks or copies runtime binaries and existing backups', async () => {
    const options = await fixture();
    await mkdir(join(options.stateDir, 'agents/main/agent'), { recursive: true });
    await symlink(options.configPath, join(options.stateDir, 'agents/main/agent/auth-profiles.json'));
    await mkdir(join(options.stateDir, 'extensions'));
    await writeFile(join(options.stateDir, 'extensions/plugin.js'), 'runtime');
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    expect(snapshot.files.some(f => /auth-profiles|extensions|backups/.test(f))).toBe(false);
  });
  it('retains the snapshot until explicit maintenance removes it', async () => {
    const options = await fixture();
    await ensureOpenClawUpgradeSnapshot(options);
    expect((await removeOpenClawUpgradeSnapshot(options)).status).toBe('removed');
    expect((await removeOpenClawUpgradeSnapshot(options)).status).toBe('missing');
  });
  it('quarantines legacy update state only when a canonical row exists', async () => {
    const options = await fixture();
    const sourcePath = join(options.stateDir, 'update-check.json');
    await writeFile(sourcePath, 'legacy');
    expect((await quarantineLegacyUpdateCheckState(options)).status).toBe('deferred');
    await mkdir(join(options.stateDir, 'state'));
    const db = new DatabaseSync(join(options.stateDir, 'state/openclaw.sqlite'));
    db.exec("CREATE TABLE update_check_state(state_key TEXT PRIMARY KEY); INSERT INTO update_check_state VALUES ('default')");
    db.close();
    const result = await quarantineLegacyUpdateCheckState(options);
    expect(result.status).toBe('quarantined');
    expect(await readFile(result.backupPath!, 'utf8')).toBe('legacy');
  });
  it('takes the startup snapshot before auth, extensions and bootstrap writers', async () => {
    const source = await readFile(join(process.cwd(), 'electron/main/index.ts'), 'utf8');
    const snapshot = source.indexOf('await ensureOpenClawUpgradeSnapshot()');
    expect(snapshot).toBeGreaterThan(0);
    for (const writer of ['await extensionRegistry.initialize(', 'void ensureClawXDefaultIdentity()', 'await syncAllProviderAuthToRuntime()']) {
      expect(snapshot).toBeLessThan(source.indexOf(writer));
    }
  });
});
