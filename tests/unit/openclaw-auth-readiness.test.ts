// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBundledAgentSchema, getBundledStateSchema } from '@electron/utils/openclaw-persistence-runtime';

const { testHome } = vi.hoisted(() => ({ testHome: `${process.cwd()}/test-results/auth-readiness-${Math.random().toString(36).slice(2)}` }));
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});
const statePath = () => join(testHome, '.openclaw/state/openclaw.sqlite');
const agentPath = (id = 'main') => join(testHome, '.openclaw/agents', id, 'agent/openclaw-agent.sqlite');
async function seedState(contentVersion = 22, headerVersion = 1) {
  await mkdir(join(statePath(), '..'), { recursive: true });
  const db = new DatabaseSync(statePath());
  try {
    // The full runtime schema has hundreds of DDL statements. Seed atomically
    // so fixture fsyncs do not consume the admission test's timeout in CI.
    db.exec('BEGIN');
    db.exec(getBundledStateSchema());
    db.prepare("INSERT INTO schema_meta VALUES ('primary','global',?,NULL,'2026.10.10',1,1)").run(headerVersion);
    db.exec(`PRAGMA user_version = ${headerVersion}`);
    db.prepare("INSERT INTO config_machine_state VALUES ('state.schema.contentVersion',?,1)").run(JSON.stringify(contentVersion));
    db.exec('COMMIT');
  } finally { db.close(); }
}
async function seedAgent(version: number, marker = version, id = 'main') {
  await mkdir(join(agentPath(id), '..'), { recursive: true });
  const db = new DatabaseSync(agentPath(id));
  try {
    db.exec('BEGIN');
    db.exec(getBundledAgentSchema(version));
    db.prepare("INSERT INTO schema_meta VALUES ('primary','agent',?,?,'2026.10.5',1,1)").run(marker, id);
    db.exec(`PRAGMA user_version = ${marker}`);
    db.exec('COMMIT');
  } finally { db.close(); }
}
function editState(sql: string) {
  const db = new DatabaseSync(statePath());
  try { db.exec(sql); } finally { db.close(); }
}
async function inspect(ids: string[] = ['main']) {
  const { inspectAuthProfilesWriteReadiness } = await import('@electron/utils/openclaw-auth-sqlite');
  return inspectAuthProfilesWriteReadiness(ids);
}

describe('read-only auth projection admission', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('OPENCLAW_STATE_DIR', join(testHome, '.openclaw'));
    await rm(testHome, { recursive: true, force: true });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await rm(testHome, { recursive: true, force: true }); });

  it('defers a fresh profile before creating any agent or shared database', async () => {
    expect(await inspect()).toEqual({ ready: false, reason: 'shared-state:missing' });
    expect(existsSync(testHome)).toBe(false);
  });

  it('recognizes a truly empty interrupted bootstrap but refuses arbitrary schema-zero objects', async () => {
    await mkdir(join(statePath(), '..'), { recursive: true });
    new DatabaseSync(statePath()).close();
    const before = await readFile(statePath());
    expect(await inspect()).toEqual({ ready: false, reason: 'shared-state:empty' });
    expect((await readFile(statePath())).equals(before)).toBe(true);
    editState('CREATE TABLE unknown (value TEXT)');
    await expect(inspect()).rejects.toThrow();
  });

  it('accepts content version 22 with an older reader floor, then safely initializes a missing agent', async () => {
    await seedState(22, 1);
    const sharedBefore = await readFile(statePath());
    expect(await inspect()).toEqual({ ready: true });
    expect(existsSync(agentPath())).toBe(false);
    const { writeAuthProfilesToSqlite } = await import('@electron/utils/openclaw-auth-sqlite');
    writeAuthProfilesToSqlite({ version: 1, profiles: {} }, 'main');
    expect(await inspect()).toEqual({ ready: true });
    // Native byte comparison avoids Vitest traversing every Buffer property in
    // the full runtime schema while still detecting any changed database byte.
    expect((await readFile(statePath())).equals(sharedBefore)).toBe(true);
  }, 20_000);

  it('recognizes the real prelaunch plugin-index producer as pending native bootstrap', async () => {
    const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
    expect(upsertPluginInstallRecordsIntoSqlite({ example: { source: 'npm', spec: '@example/plugin', version: '1.0.0' } })).toBe(true);
    const before = await readFile(statePath());
    expect(await inspect()).toEqual({ ready: false, reason: 'shared-state:plugin-index-bootstrap' });
    expect((await readFile(statePath())).equals(before)).toBe(true);
    expect(existsSync(agentPath())).toBe(false);
    editState('CREATE TABLE unexpected (value TEXT)');
    await expect(inspect()).rejects.toThrow();
  });

  it('does not treat a changed index schema as the known bootstrap producer', async () => {
    const { upsertPluginInstallRecordsIntoSqlite } = await import('@electron/utils/plugin-install-index');
    upsertPluginInstallRecordsIntoSqlite({ example: { source: 'npm', spec: '@example/plugin' } });
    editState('ALTER TABLE installed_plugin_index ADD COLUMN unknown TEXT');
    await expect(inspect()).rejects.toThrow();
  });

  it('defers old shared state without modifying its content or markers', async () => {
    await seedState(20, 20);
    const before = await readFile(statePath());
    expect(await inspect()).toEqual({ ready: false, reason: 'shared-state:schema-20' });
    expect((await readFile(statePath())).equals(before)).toBe(true);
    expect(existsSync(agentPath())).toBe(false);
  });

  it('leaves a missing deletion journal for Doctor and does not create an agent', async () => {
    await seedState();
    editState('DROP TABLE agent_deletion_journal');
    const before = await readFile(statePath());
    expect(await inspect()).toEqual({ ready: false, reason: 'shared-state:deletion-journal' });
    expect((await readFile(statePath())).equals(before)).toBe(true);
    expect(existsSync(agentPath())).toBe(false);
  });

  it.each([1, 16, 25])('defers agent schema %i without import, repair, or relabeling', async (version) => {
    await seedState();
    await seedAgent(version === 1 ? 25 : version, version);
    const before = await readFile(agentPath());
    expect(await inspect()).toEqual({ ready: false, reason: `agent:main:schema-${version}` });
    expect((await readFile(agentPath())).equals(before)).toBe(true);
    expect(existsSync(`${agentPath()}.clawx-before-schema-repair`)).toBe(false);
  });

  it('validates non-main agents even when main auth has already moved into shared state', async () => {
    await seedState();
    editState(`INSERT INTO config_machine_state VALUES ('auth.sharedStore','{"location":"state-db"}',1)`);
    await seedAgent(25, 25, 'research');
    expect(await inspect(['research', 'main', 'research'])).toEqual({ ready: false, reason: 'agent:research:schema-25' });
  });

  it('refuses future shared content and agent versions', async () => {
    await seedState(23, 1);
    await expect(inspect()).rejects.toThrow('newer OpenClaw shared schema');
    editState(`UPDATE config_machine_state SET value_json='22' WHERE state_key='state.schema.contentVersion'`);
    await seedAgent(27, 28);
    await expect(inspect()).rejects.toThrow('newer OpenClaw agent schema');
  });

  it('refuses unknown shared credential ownership and mismatched database owners', async () => {
    await seedState();
    editState(`INSERT INTO config_machine_state VALUES ('auth.sharedStore','{"location":"unknown"}',1)`);
    await expect(inspect()).rejects.toThrow('owner');
    editState(`DELETE FROM config_machine_state WHERE state_key='auth.sharedStore'; UPDATE schema_meta SET role='agent'`);
    await expect(inspect()).rejects.toThrow('owner');
    editState(`UPDATE schema_meta SET role='global'`);
    await seedAgent(27);
    const db = new DatabaseSync(agentPath());
    try { db.exec("UPDATE schema_meta SET agent_id='different'"); } finally { db.close(); }
    await expect(inspect()).rejects.toThrow('owner');
  });

  it('refuses current schema corruption instead of treating it as ordinary migration', async () => {
    await seedState();
    await seedAgent(27);
    const db = new DatabaseSync(agentPath());
    try { db.exec('DROP TABLE auth_profile_store'); } finally { db.close(); }
    await expect(inspect()).rejects.toThrow();
  });

  it('retains legacy auth and sessions until Doctor consumes them', async () => {
    await seedState();
    await mkdir(join(agentPath(), '..'), { recursive: true });
    const auth = join(agentPath(), '../auth-profiles.json');
    const sessions = join(agentPath(), '../../sessions/sessions.json');
    await mkdir(join(sessions, '..'), { recursive: true });
    await writeFile(auth, '{"version":1,"profiles":{}}');
    await writeFile(sessions, '{}');
    expect(await inspect()).toEqual({ ready: false, reason: 'agent:main:legacy-auth;agent:main:legacy-sessions' });
    expect(existsSync(agentPath())).toBe(false);
    expect(await readFile(auth, 'utf8')).toBe('{"version":1,"profiles":{}}');
  });
});
