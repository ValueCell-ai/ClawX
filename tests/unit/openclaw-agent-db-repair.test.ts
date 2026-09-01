// @vitest-environment node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { repairOpenClawAgentDatabasesFor2026_8_1Doctor } from '@electron/utils/openclaw-agent-db-repair';

const tempDirs: string[] = [];

async function createAgentDatabase(withParticipant = false): Promise<{
  pathname: string;
  stateDir: string;
}> {
  const stateDir = await mkdtemp(join(tmpdir(), 'clawx-agent-db-repair-'));
  tempDirs.push(stateDir);
  const agentDir = join(stateDir, 'agents', 'main', 'agent');
  await mkdir(agentDir, { recursive: true });
  const pathname = join(agentDir, 'openclaw-agent.sqlite');
  const database = new DatabaseSync(pathname);
  database.exec(`
    PRAGMA user_version = 1;
    CREATE TABLE session_nodes (
      session_key TEXT NOT NULL PRIMARY KEY
    ) STRICT;
    CREATE TABLE session_participants (
      session_key TEXT NOT NULL,
      identity_namespace TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      contribution_count INTEGER NOT NULL,
      first_prompted_at INTEGER,
      last_prompted_at INTEGER,
      PRIMARY KEY (session_key, identity_namespace, actor_id),
      FOREIGN KEY (session_key) REFERENCES session_nodes(session_key) ON DELETE CASCADE
    ) STRICT;
  `);
  if (withParticipant) {
    database.exec(`
      INSERT INTO session_nodes (session_key) VALUES ('agent:main:main');
      INSERT INTO session_participants (
        session_key,
        identity_namespace,
        actor_id,
        contribution_count
      ) VALUES (
        'agent:main:main',
        '{"type":"profile"}',
        'owner',
        1
      );
    `);
  }
  database.close();
  return { pathname, stateDir };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpenClaw 8.1 agent database pre-Doctor repair', () => {
  it('removes an empty premature participant table from a legacy database', async () => {
    const { pathname, stateDir } = await createAgentDatabase();

    await expect(repairOpenClawAgentDatabasesFor2026_8_1Doctor({ stateDir }))
          .resolves.toEqual({
            inspected: [pathname],
            repaired: [pathname],
            pendingMigration: [pathname],
          });

    const database = new DatabaseSync(pathname, { readOnly: true });
    expect(database.prepare(
      'SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?',
    ).get('table', 'session_participants')).toBeUndefined();
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(1);
    database.close();
  });

  it('fails closed without changing a populated premature participant table', async () => {
    const { pathname, stateDir } = await createAgentDatabase(true);

    await expect(repairOpenClawAgentDatabasesFor2026_8_1Doctor({ stateDir }))
      .rejects.toThrow('non-empty premature session_participants');

    const database = new DatabaseSync(pathname, { readOnly: true });
    expect((database.prepare('SELECT count(*) AS count FROM session_participants').get() as {
      count: number;
    }).count).toBe(1);
    database.close();
  });
});
