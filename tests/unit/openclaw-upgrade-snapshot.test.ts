// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureOpenClawUpgradeSnapshot, quarantineLegacyUpdateCheckState, removeOpenClawUpgradeSnapshot } from '@electron/utils/openclaw-upgrade-snapshot';
import { restoreUpgradeSnapshot } from '../../resources/cli/restore-openclaw-upgrade.mjs';
const roots: string[] = [];
async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), 'clawx 升级 '));
  roots.push(stateDir);
  const configPath = join(stateDir, 'openclaw.json');
  await writeFile(configPath, '{"version":"old"}\n');
  return { stateDir, configPath };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('OpenClaw 2026.10.10 upgrade snapshot', () => {
  it('backs up legacy sessions, credentials and media once, with private permissions', async () => {
    const options = await fixture();
    for (const file of ['agents/main/sessions/sessions.json', 'agents/main/sessions/history.jsonl', 'agents/main/agent/auth-profiles.json', 'credentials/channel/token.json', 'media/inbound/image.png']) {
      await mkdir(join(options.stateDir, file, '..'), { recursive: true });
      await writeFile(join(options.stateDir, file), 'synthetic');
    }
    const first = await ensureOpenClawUpgradeSnapshot(options);
    expect(first.status).toBe('created');
    expect(first.snapshotDir).toContain('2026.10.10');
    expect(first.files.map(file => file.replace(/\\/g, '/'))).toEqual(expect.arrayContaining(['config/openclaw.json', 'agents/main/sessions/sessions.json', 'agents/main/sessions/history.jsonl', 'agents/main/agent/auth-profiles.json', 'state-files/credentials/channel/token.json', 'state-files/media/inbound/image.png']));
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
  it('refuses an existing baseline whose completion marker was removed', async () => {
    const options = await fixture();
    const first = await ensureOpenClawUpgradeSnapshot(options);
    await rm(join(first.snapshotDir, 'snapshot.json'));
    await writeFile(options.configPath, '{"version":"new"}');
    await expect(ensureOpenClawUpgradeSnapshot(options)).rejects.toThrow('Incomplete upgrade snapshot');
    expect(await readFile(join(first.snapshotDir, 'config/openclaw.json'), 'utf8')).toContain('old');
  });
  it('coalesces concurrent startup calls', async () => {
    const options = await fixture();
    const [a, b] = await Promise.all([ensureOpenClawUpgradeSnapshot(options), ensureOpenClawUpgradeSnapshot(options)]);
    expect(a).toEqual(b);
  });
  it('restores linked auth targets without traversing host runtime caches or existing backups', async () => {
    const options = await fixture();
    const external = await fixture();
    const externalAuthPath = join(external.stateDir, 'auth-profiles.json');
    await writeFile(externalAuthPath, 'external credentials');
    if (process.platform === 'win32') {
      // Directory junctions exercise the same no-follow guard without requiring
      // Windows Developer Mode or the file-symlink privilege.
      await mkdir(join(options.stateDir, 'agents/main'), { recursive: true });
      await symlink(external.stateDir, join(options.stateDir, 'agents/main/agent'), 'junction');
    } else {
      await mkdir(join(options.stateDir, 'agents/main/agent'), { recursive: true });
      await symlink(externalAuthPath, join(options.stateDir, 'agents/main/agent/auth-profiles.json'));
    }
    await mkdir(join(options.stateDir, 'extensions'));
    await writeFile(join(options.stateDir, 'extensions/plugin.js'), 'runtime');
    await mkdir(join(options.stateDir, 'backups/previous'), { recursive: true });
    await writeFile(join(options.stateDir, 'backups/previous/snapshot.json'), 'previous backup');
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    expect(snapshot.files.some(f => /^agents.*auth-profiles|backups/.test(f))).toBe(false);
    expect(snapshot.files).toContain(join('state-files', 'extensions', 'plugin.js'));
    expect(await readFile(externalAuthPath, 'utf8')).toBe('external credentials');
    await writeFile(externalAuthPath, 'migrated credentials');
    const { recoveryDir } = await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    const journal = JSON.parse(await readFile(join(recoveryDir, 'journal.json'), 'utf8'));
    for (const operation of journal.operations) {
      if (!operation.previous.startsWith(snapshot.snapshotDir)) roots.push(join(operation.previous, '..'));
    }
    expect(await readFile(join(options.stateDir, 'agents/main/agent/auth-profiles.json'), 'utf8')).toBe('external credentials');
  });
  it('retains the snapshot until explicit maintenance removes it', async () => {
    const options = await fixture();
    await ensureOpenClawUpgradeSnapshot(options);
    expect((await removeOpenClawUpgradeSnapshot(options)).status).toBe('removed');
    expect((await removeOpenClawUpgradeSnapshot(options)).status).toBe('missing');
  });
  it('removes recovery artifacts without following plugin junctions into the host runtime', async () => {
    const options = await fixture();
    const host = await fixture();
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    const retained = join(snapshot.snapshotDir, 'recovery/retained/node_modules');
    await mkdir(retained, { recursive: true });
    await symlink(host.stateDir, join(retained, 'openclaw'), 'junction');
    await removeOpenClawUpgradeSnapshot(options);
    expect(await readFile(host.configPath, 'utf8')).toContain('old');
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
  it.each(['official-0.6.1', 'main-10.5'])('restores %s credentials, plugin payloads and database together', async (baseline) => {
    const options = await fixture();
    const retained = {
      'credentials/weixin/account.json': `${baseline}-login`,
      'extensions/wecom/package.json': JSON.stringify({ version: baseline }),
      'agents/main/sessions/history.jsonl': `${baseline}-history`,
      'workspace/USER.md': 'user workspace',
    };
    for (const [file, data] of Object.entries(retained)) {
      await mkdir(join(options.stateDir, file, '..'), { recursive: true });
      await writeFile(join(options.stateDir, file), data);
    }
    await mkdir(join(options.stateDir, 'state'));
    const dbPath = join(options.stateDir, 'state/openclaw.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE evidence(value TEXT)');
    db.prepare('INSERT INTO evidence VALUES (?)').run(baseline);
    db.close();
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    for (const file of Object.keys(retained).filter(file => !file.startsWith('workspace/'))) {
      await writeFile(join(options.stateDir, file), 'new incompatible state');
    }
    await writeFile(dbPath, 'failed upgrade');
    await writeFile(options.configPath, '{"version":"2026.10.10"}');
    await writeFile(join(options.stateDir, 'agents/main/new.sqlite-wal'), 'new sidecar');
    const { recoveryDir } = await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    expect(await readFile(options.configPath, 'utf8')).toContain('old');
    for (const [file, data] of Object.entries(retained)) expect(await readFile(join(options.stateDir, file), 'utf8')).toBe(data);
    await expect(stat(join(options.stateDir, 'agents/main/new.sqlite-wal'))).rejects.toThrow();
    const restored = new DatabaseSync(dbPath, { readOnly: true });
    try { expect(restored.prepare('SELECT value FROM evidence').get()?.value).toBe(baseline); }
    finally { restored.close(); }
    expect(JSON.parse(await readFile(join(recoveryDir, 'journal.json'), 'utf8')).status).toBe('complete');
    expect((await ensureOpenClawUpgradeSnapshot(options)).status).toBe('exists');
  });
  it('rolls back a failed restore and permits an offline retry', async () => {
    const options = await fixture();
    await mkdir(join(options.stateDir, 'credentials'));
    const credentials = join(options.stateDir, 'credentials/token');
    await writeFile(credentials, 'old login');
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    await writeFile(options.configPath, 'new config');
    await writeFile(credentials, 'new login');
    await expect(restoreUpgradeSnapshot(snapshot.snapshotDir, {
      ...options, assertOffline: async () => {},
      beforePublish: (index: number) => { if (index === 2) throw new Error('injected disk failure'); },
    })).rejects.toThrow('injected disk failure');
    expect(await readFile(options.configPath, 'utf8')).toBe('new config');
    expect(await readFile(credentials, 'utf8')).toBe('new login');
    await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    expect(await readFile(credentials, 'utf8')).toBe('old login');
  });
  it.skipIf(process.platform !== 'win32')('preserves current data when Windows denies a directory rename and retries after unlock', async () => {
    const options = await fixture();
    await mkdir(join(options.stateDir, 'credentials'));
    const token = join(options.stateDir, 'credentials/token');
    await writeFile(token, 'old login');
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    await writeFile(options.configPath, 'new config');
    await writeFile(token, 'new login');
    const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$f = [IO.File]::Open($env:CLAWX_LOCK_FIXTURE, 'Open', 'Read', 'None'); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $f.Dispose()"],
    { env: { ...process.env, CLAWX_LOCK_FIXTURE: token }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const closed = once(holder, 'exit');
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Windows lock fixture did not become ready')), 10000);
        holder.stdout.once('data', data => {
          clearTimeout(timer);
          if (data.toString().includes('locked')) resolve();
          else reject(new Error('Unexpected lock response'));
        });
        holder.once('error', error => { clearTimeout(timer); reject(error); });
        holder.once('exit', () => { clearTimeout(timer); reject(new Error('Lock holder exited before readiness')); });
      });
      await expect(restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} })).rejects.toMatchObject({ code: expect.stringMatching(/^(EPERM|EACCES|EBUSY)$/) });
      expect(await readFile(options.configPath, 'utf8')).toBe('new config');
    } finally {
      holder.stdin.end('\n');
      await closed;
    }
    expect(await readFile(token, 'utf8')).toBe('new login');
    await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    expect(await readFile(token, 'utf8')).toBe('old login');
  }, 20000);
  it('rejects a live runtime and corrupted snapshot before touching current data', async () => {
    const options = await fixture();
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    await writeFile(options.configPath, 'new config');
    await expect(restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => { throw new Error('runtime active'); } })).rejects.toThrow('runtime active');
    await writeFile(join(snapshot.snapshotDir, 'config/openclaw.json'), 'corrupted');
    await expect(restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} })).rejects.toThrow('integrity');
    expect(await readFile(options.configPath, 'utf8')).toBe('new config');
  });
  it('recovers a process interruption between publishing roots', async () => {
    const options = await fixture();
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    await writeFile(options.configPath, 'new config');
    const moduleUrl = pathToFileURL(join(process.cwd(), 'resources/cli/restore-openclaw-upgrade.mjs')).href;
    await expect(promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { restoreUpgradeSnapshot } from ${JSON.stringify(moduleUrl)};
      await restoreUpgradeSnapshot(process.argv[1], { assertOffline: async () => {}, beforePublish(index) { if (index === 1) process.exit(73); } });
    `, snapshot.snapshotDir])).rejects.toMatchObject({ code: 73 });
    await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    expect(await readFile(options.configPath, 'utf8')).toContain('old');
  });
  it('includes explicitly configured external Agent auth directories in rollback', async () => {
    const options = await fixture();
    const external = await fixture();
    await writeFile(join(external.stateDir, 'auth-profiles.json'), 'old login');
    await writeFile(options.configPath, JSON.stringify({ agents: { entries: { main: { agentDir: external.stateDir } } } }));
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    await writeFile(join(external.stateDir, 'auth-profiles.json'), 'new login');
    const { recoveryDir } = await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    const journal = JSON.parse(await readFile(join(recoveryDir, 'journal.json'), 'utf8'));
    for (const operation of journal.operations) {
      if (!operation.previous.startsWith(snapshot.snapshotDir)) roots.push(join(operation.previous, '..'));
    }
    expect(await readFile(join(external.stateDir, 'auth-profiles.json'), 'utf8')).toBe('old login');
  });
  it('captures a configured internal Agent directory only once through filesystem aliases', async () => {
    const options = await fixture();
    const agentDir = join(options.stateDir, 'agents/main/agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'auth-profiles.json'), 'old login');
    await writeFile(options.configPath, JSON.stringify({ agents: { entries: { main: { agentDir } } } }));
    const snapshot = await ensureOpenClawUpgradeSnapshot(options);
    const manifest = JSON.parse(await readFile(join(snapshot.snapshotDir, 'snapshot.json'), 'utf8'));
    expect(manifest.externalRoots).toEqual([]);
    await writeFile(join(agentDir, 'auth-profiles.json'), 'migrated login');
    await restoreUpgradeSnapshot(snapshot.snapshotDir, { ...options, assertOffline: async () => {} });
    expect(await readFile(join(agentDir, 'auth-profiles.json'), 'utf8')).toBe('old login');
  });
});
