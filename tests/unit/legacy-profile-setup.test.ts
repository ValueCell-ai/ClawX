import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { legacyEnvironment, prepareLegacyProfile } from '../../scripts/lib/legacy-profile.mjs';

let base: string;
let sourceState: string;
let snapshot: string;
let root: string;
async function json(path: string, data: unknown) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(data)); }
function options() { return { root, sourceState, snapshot, backupRoot: join(base, 'backups') }; }
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'clawx-profile-test-')));
  sourceState = join(base, 'shared'); snapshot = join(sourceState, 'backups/pre'); root = join(base, 'legacy');
  await json(join(sourceState, 'openclaw.json'), { meta: { lastTouchedVersion: '2026.10.5' } });
  await json(join(snapshot, 'snapshot.json'), { upgrade: 'openclaw-2026.10.5', files: ['config/openclaw.json'] });
  await json(join(snapshot, 'config/openclaw.json'), {
    meta: { lastTouchedVersion: '2026.7.1-2' }, agents: { defaults: { workspace: join(sourceState, 'workspace') }, list: [{ id: 'main', workspace: join(sourceState, 'workspace') }] },
    cron: { enabled: true }, channels: { telegram: { enabled: true } }, plugins: { load: { paths: [join(sourceState, 'extensions')] } },
  });
  await json(join(snapshot, 'agents/main/agent/auth-profiles.json'), { version: 1, profiles: { key: { type: 'api_key', key: 'test-key' }, login: { type: 'oauth', refresh: 'must-not-copy' } } });
  await mkdir(join(sourceState, 'workspace'), { recursive: true });
  await writeFile(join(sourceState, 'workspace/notes.txt'), 'original user file');
  await mkdir(join(sourceState, 'state'), { recursive: true });
  const db = new DatabaseSync(join(sourceState, 'state/openclaw.sqlite'));
  db.exec('CREATE TABLE history (value TEXT); INSERT INTO history VALUES (\'migrated\')'); db.close();
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('legacy profile preparation', () => {
  it('backs up migrated state, isolates compatible config and starts fresh runtime work', async () => {
    const original = await readFile(join(sourceState, 'openclaw.json'), 'utf8');
    const result = await prepareLegacyProfile(options());
    expect(result.reused).toBe(false);
    expect(await readFile(join(sourceState, 'openclaw.json'), 'utf8')).toBe(original);
    expect(await readFile(join(result.backup, 'openclaw.json'), 'utf8')).toBe(original);
    const db = new DatabaseSync(join(result.backup, 'state/openclaw.sqlite'), { readOnly: true });
    expect(db.prepare('SELECT value FROM history').get()?.value).toBe('migrated'); db.close();
    const cfg = JSON.parse(await readFile(join(root, 'openclaw/openclaw.json'), 'utf8'));
    expect(cfg.agents.list[0].workspace).toBe(join(root, 'openclaw/workspace'));
    expect(cfg.agents.list[0].agentDir).toBe(join(root, 'openclaw/agents/main/agent'));
    expect(cfg.gateway.port).toBe(19789); expect(cfg.cron.enabled).toBe(false); expect(cfg.channels).toEqual({});
    expect(cfg.tools.web.search.enabled).toBe(false);
    const auth = JSON.parse(await readFile(join(root, 'openclaw/agents/main/agent/auth-profiles.json'), 'utf8'));
    expect(Object.keys(auth.profiles)).toEqual(['key']);
    await writeFile(join(root, 'openclaw/workspace/notes.txt'), 'legacy edit');
    expect(await readFile(join(sourceState, 'workspace/notes.txt'), 'utf8')).toBe('original user file');
  });
  it('reuses an existing profile without overwriting edits or creating another backup', async () => {
    const first = await prepareLegacyProfile(options());
    await writeFile(join(root, 'openclaw/workspace/notes.txt'), 'keep this');
    const second = await prepareLegacyProfile(options());
    expect(second).toMatchObject({ reused: true, backup: first.backup });
    expect(await readFile(join(root, 'openclaw/workspace/notes.txt'), 'utf8')).toBe('keep this');
  });
  it('refuses incompatible snapshots and unsafe destinations before copying data', async () => {
    await expect(prepareLegacyProfile({ ...options(), root: join(sourceState, 'legacy') })).rejects.toThrow();
    await json(join(snapshot, 'config/openclaw.json'), { meta: { lastTouchedVersion: '2026.10.5' } });
    await expect(prepareLegacyProfile(options())).rejects.toThrow('version');
    await expect(prepareLegacyProfile({ ...options(), runtimeVersion: '2026.10.5' })).rejects.toThrow();
  });
  it('refuses symlink roots and never copies workspace symlinks back to shared data', async () => {
    await symlink(sourceState, join(base, 'linked'));
    await expect(prepareLegacyProfile({ ...options(), root: join(base, 'linked/legacy') })).rejects.toThrow('symlink');
    await symlink(join(sourceState, 'openclaw.json'), join(sourceState, 'workspace/shared-config'));
    await prepareLegacyProfile(options());
    await expect(readFile(join(root, 'openclaw/workspace/shared-config'))).rejects.toThrow();
  });
  it('propagates dedicated paths, preserves the actual home and removes inherited OpenClaw overrides', () => {
    const env = legacyEnvironment(root, { HOME: '/real-home', OPENCLAW_STATE_DIR: '/shared', OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS: '1' });
    expect(env.HOME).toBe('/real-home'); expect(env.OPENCLAW_STATE_DIR).toBe(join(root, 'openclaw'));
    expect(env.OPENCLAW_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS).toBeUndefined();
    expect(env.CLAWX_USER_DATA_DIR).toBe(join(root, 'clawx'));
  });
});
