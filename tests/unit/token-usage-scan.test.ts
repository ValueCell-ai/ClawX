import { mkdir, rm, writeFile } from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-token-usage-${suffix}`,
    testUserData: `/tmp/clawx-token-usage-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

describe('token usage session scan', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('includes usage from migrated SQLite transcripts and ignores stale JSONL for that agent', async () => {
    const agentDir = join(testHome, '.openclaw/agents/main/agent');
    await mkdir(agentDir, { recursive: true });
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    db.exec('CREATE TABLE session_nodes(session_key TEXT PRIMARY KEY, current_session_id TEXT, entry_json TEXT); CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, PRIMARY KEY(session_id, seq));');
    db.prepare('INSERT INTO session_nodes VALUES (?, ?, ?)').run('agent:main:sqlite', 'sqlite-session', '{}');
    db.prepare('INSERT INTO transcript_events VALUES (?, ?, ?)').run('sqlite-session', 1, JSON.stringify({ type: 'message', timestamp: '2026-03-12T12:19:00.000Z', message: { role: 'assistant', model: 'sqlite-model', provider: 'sqlite-provider', usage: { input: 10, output: 5, total: 15 } } }));
    db.close();
    const staleDir = join(testHome, '.openclaw/agents/main/sessions');
    await mkdir(staleDir, { recursive: true });
    await writeFile(join(staleDir, 'stale.jsonl'), JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 999, output: 999, total: 1998 } } }));
    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    await expect(getRecentTokenUsageHistory()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ agentId: 'main', totalTokens: 15, model: 'sqlite-model' })]));
    const entries = await getRecentTokenUsageHistory();
    expect(entries.some(entry => entry.totalTokens === 1998)).toBe(false);
  });

  it('includes transcripts from agent directories that exist on disk but are not configured', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
    }, null, 2), 'utf8');

    const diskOnlySessionsDir = join(openclawDir, 'agents', 'custom-custom25', 'sessions');
    await mkdir(diskOnlySessionsDir, { recursive: true });
    await writeFile(
      join(diskOnlySessionsDir, 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:19:00.000Z',
          message: {
            role: 'assistant',
            model: 'gpt-5.2-2025-12-11',
            provider: 'openai',
            usage: {
              input: 17649,
              output: 107,
              total: 17756,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const { getRecentTokenUsageHistory } = await import('@electron/utils/token-usage');
    const entries = await getRecentTokenUsageHistory();

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: 'custom-custom25',
          sessionId: 'f8e66f77-0125-4e2f-b750-9c4de01e8f5a',
          model: 'gpt-5.2-2025-12-11',
          totalTokens: 17756,
        }),
      ]),
    );
  });
});
