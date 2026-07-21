// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureOpenClaw2026_7_1UpgradeSnapshot } from '@electron/utils/openclaw-upgrade-snapshot';

const tempDirs: string[] = [];

async function createTempStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawx-openclaw-upgrade-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpenClaw 2026.7.1 upgrade snapshot', () => {
  it('copies config, SQLite sidecars, agent auth, and channel credentials once', async () => {
    const stateDir = await createTempStateDir();
    const configPath = join(stateDir, 'openclaw.json');
    await mkdir(join(stateDir, 'state'), { recursive: true });
    await mkdir(join(stateDir, 'agents', 'main', 'agent'), { recursive: true });
    await mkdir(join(stateDir, 'agents', 'main', 'sessions'), { recursive: true });
    await mkdir(join(stateDir, 'credentials', 'channel'), { recursive: true });
    await writeFile(configPath, '{"version":"old"}\n');
    await writeFile(join(stateDir, 'state', 'openclaw.sqlite'), 'db');
    await writeFile(join(stateDir, 'state', 'openclaw.sqlite-wal'), 'wal');
    await writeFile(join(stateDir, 'state', 'openclaw.sqlite-shm'), 'shm');
    await writeFile(join(stateDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite'), 'agent-db');
    await writeFile(join(stateDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite-wal'), 'agent-wal');
    await writeFile(join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json'), '{"profiles":{}}');
    await writeFile(join(stateDir, 'agents', 'main', 'sessions', 'history.jsonl'), 'large transcript');
    await writeFile(join(stateDir, 'credentials', 'channel', 'token.json'), '{"token":"secret"}');

    const first = await ensureOpenClaw2026_7_1UpgradeSnapshot({ stateDir, configPath });
    expect(first.status).toBe('created');
    expect(first.files).toEqual(expect.arrayContaining([
      'config/openclaw.json',
      'state-files/state/openclaw.sqlite',
      'state-files/state/openclaw.sqlite-wal',
      'state-files/state/openclaw.sqlite-shm',
      'agents/main/agent/openclaw-agent.sqlite',
      'agents/main/agent/openclaw-agent.sqlite-wal',
      'agents/main/agent/auth-profiles.json',
      'credentials/channel/token.json',
    ]));
    expect(first.files).not.toContain('agents/main/sessions/history.jsonl');

    await writeFile(configPath, '{"version":"new"}\n');
    const second = await ensureOpenClaw2026_7_1UpgradeSnapshot({ stateDir, configPath });
    expect(second.status).toBe('exists');
    await expect(readFile(join(second.snapshotDir, 'config', 'openclaw.json'), 'utf8'))
      .resolves.toBe('{"version":"old"}\n');
  });
});
