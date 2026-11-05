// @vitest-environment node

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testOpenClawDir = join(tmpdir(), `clawx-session-workspace-${process.pid}`);
const testOpenClawConfigDir = join(tmpdir(), `clawx-session-config-${process.pid}`);

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawDir,
  resolveOpenClawStateDir: () => testOpenClawDir,
  resolveOpenClawConfigDir: () => testOpenClawConfigDir,
}));

function seedAcpCwd(sessionKey: string, cwd: string) {
  const stateDir = join(testOpenClawDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(join(stateDir, 'openclaw.sqlite'));
  try {
    db.exec('CREATE TABLE acp_sessions (session_key TEXT PRIMARY KEY, cwd TEXT)');
    db.prepare('INSERT INTO acp_sessions (session_key, cwd) VALUES (?, ?)').run(sessionKey, cwd);
  } finally {
    db.close();
  }
}

function seedAcpReplayCwd(sessionKey: string, cwd: string, updatedAt = 2000) {
  const stateDir = join(testOpenClawDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(join(stateDir, 'openclaw.sqlite'));
  try {
    db.exec('CREATE TABLE acp_replay_sessions (session_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, cwd TEXT NOT NULL, complete INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, next_seq INTEGER NOT NULL)');
    db.prepare('INSERT INTO acp_replay_sessions (session_id, session_key, cwd, complete, created_at, updated_at, next_seq) VALUES (?, ?, ?, 1, 1000, ?, 1)')
      .run(`${sessionKey}:ledger`, sessionKey, cwd, updatedAt);
  } finally {
    db.close();
  }
}

function seedAcpRuntimeOptionsCwd(sessionKey: string, cwd: string) {
  const stateDir = join(testOpenClawDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(join(stateDir, 'openclaw.sqlite'));
  try {
    db.exec('CREATE TABLE acp_sessions (session_key TEXT PRIMARY KEY, runtime_options_json TEXT, cwd TEXT)');
    db.prepare('INSERT INTO acp_sessions (session_key, runtime_options_json, cwd) VALUES (?, ?, ?)')
      .run(sessionKey, JSON.stringify({ cwd }), '/Users/alex/fallback-cwd');
  } finally {
    db.close();
  }
}

function seedTranscript(sessionKey: string, messages: unknown[]) {
  const sessionsDir = join(testOpenClawDir, 'agents', 'main', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({ [sessionKey]: 'heartbeat.jsonl' }), 'utf8');
  writeFileSync(
    join(sessionsDir, 'heartbeat.jsonl'),
    messages.map((message) => JSON.stringify({ type: 'message', message })).join('\n'),
    'utf8',
  );
}

function seedSqliteTranscript(sessionKey: string, sessionId: string, events: unknown[]) {
  const agentDir = join(testOpenClawDir, 'agents', 'main', 'agent');
  mkdirSync(agentDir, { recursive: true });
  const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_nodes (
        session_key TEXT PRIMARY KEY,
        current_session_id TEXT
      );
      CREATE TABLE IF NOT EXISTS transcript_events (
        session_id TEXT,
        seq INTEGER,
        event_json TEXT
      );
    `);
    db.prepare(
      'INSERT INTO session_nodes (session_key, current_session_id) VALUES (?, ?) ON CONFLICT(session_key) DO UPDATE SET current_session_id = excluded.current_session_id',
    ).run(sessionKey, sessionId);
    const insert = db.prepare(
      'INSERT INTO transcript_events (session_id, seq, event_json) VALUES (?, ?, ?)',
    );
    events.forEach((event, index) => {
      insert.run(sessionId, index + 1, JSON.stringify(event));
    });
  } finally {
    db.close();
  }
}

function seedTranscriptRecords(sessionKey: string, records: unknown[]) {
  const sessionsDir = join(testOpenClawDir, 'agents', 'main', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({ [sessionKey]: 'timings.jsonl' }), 'utf8');
  writeFileSync(
    join(sessionsDir, 'timings.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n'),
    'utf8',
  );
}

describe('sessions API workspace summaries', () => {
  beforeEach(() => {
    rmSync(testOpenClawDir, { recursive: true, force: true });
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
  });

  it('deletes and renames migrated SQLite sessions persistently without sessions.json', async () => {
    const agentDir = join(testOpenClawDir, 'agents/main/agent');
    mkdirSync(agentDir, { recursive: true });
    const db = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'));
    db.exec('CREATE TABLE session_nodes(session_key TEXT PRIMARY KEY, current_session_id TEXT, label TEXT, updated_at INTEGER); CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, PRIMARY KEY(session_id, seq));');
    db.prepare('INSERT INTO session_nodes VALUES (?, ?, ?, ?)').run('agent:main:session-mutate', 'mutate-id', 'old', 1);
    db.close();
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    await expect(createSessionsApi().rename({ sessionKey: 'agent:main:session-mutate', label: 'new' })).resolves.toEqual({ success: true });
    const renamed = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'), { readOnly: true });
    expect(renamed.prepare('SELECT label FROM session_nodes WHERE session_key=?').get('agent:main:session-mutate')?.label).toBe('new');
    renamed.close();
    await expect(createSessionsApi().delete({ sessionKey: 'agent:main:session-mutate' })).resolves.toEqual({ success: true });
    const deleted = new DatabaseSync(join(agentDir, 'openclaw-agent.sqlite'), { readOnly: true });
    expect(deleted.prepare('SELECT count(*) AS n FROM session_nodes WHERE session_key=?').get('agent:main:session-mutate')?.n).toBe(0);
    deleted.close();
  });

  it('loads transcript history from the state dir when the config path is elsewhere', async () => {
    seedTranscript('agent:main:session-state', [{
      role: 'assistant',
      content: 'state transcript',
      timestamp: 10_000,
    }]);
    mkdirSync(testOpenClawConfigDir, { recursive: true });
    writeFileSync(join(testOpenClawConfigDir, 'openclaw.json'), '{}');
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    await expect(createSessionsApi().history({
      sessionKey: 'agent:main:session-state',
      limit: 5,
    })).resolves.toMatchObject({
      success: true,
      messages: [{ content: 'state transcript' }],
    });
  });

  it('extracts bounded whole-turn timings without treating inter-session messages as new turns', async () => {
    seedTranscriptRecords('agent:main:session-timings', [
      {
        type: 'message',
        timestamp: '2026-07-22T10:00:00.000Z',
        message: { role: 'user', content: '[Working directory: /tmp/project]\nRepeat this' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1' }] },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:00:03.000Z',
        message: { role: 'toolResult', content: 'tool result', toolCallId: 'tool-1' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:00:05.000Z',
        message: { role: 'assistant', content: 'First answer' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:01:00.000Z',
        message: { role: 'user', content: 'Repeat this' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:01:01.000Z',
        message: {
          role: 'user',
          content: '[Inter-session message] async continuation',
          provenance: { kind: 'inter_session' },
        },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:01:02.000Z',
        message: { role: 'tool_result', content: 'continued tool result', toolCallId: 'tool-2' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:01:04.000Z',
        message: { role: 'assistant', content: 'Second answer' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:02:00.000Z',
        message: { role: 'user', content: 'Incomplete turn' },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().turnTimings({
      sessionKey: 'agent:main:session-timings',
      limit: 1000,
    });

    expect(result).toEqual({
      success: true,
      timings: [
        {
          normalizedUserText: 'Repeat this',
          userOccurrenceFromTail: 2,
          durationMs: 5_000,
        },
        {
          normalizedUserText: 'Repeat this',
          userOccurrenceFromTail: 1,
          durationMs: 4_000,
        },
      ],
    });
  });

  it('keeps restart-recovered assistant output in the original visible turn timing', async () => {
    seedTranscriptRecords('agent:main:session-restart-timing', [
      {
        type: 'message',
        timestamp: '2026-08-27T08:52:13.539Z',
        message: { role: 'user', content: 'Explain SolidWorks file versioning' },
      },
      {
        type: 'message',
        timestamp: '2026-08-27T08:52:23.876Z',
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1' }] },
      },
      {
        type: 'message',
        timestamp: '2026-08-27T08:52:23.960Z',
        message: { role: 'toolResult', content: 'missing memory file', toolCallId: 'tool-1' },
      },
      {
        type: 'message',
        timestamp: '2026-08-27T08:55:42.364Z',
        message: {
          role: 'user',
          content: '[System] Continue the interrupted response after Gateway restart.',
          provenance: {
            kind: 'internal_system',
            sourceSessionKey: 'agent:main:session-restart-timing',
            sourceTool: 'main_session_restart_recovery',
          },
        },
      },
      {
        type: 'message',
        timestamp: '2026-08-27T08:56:54.103Z',
        message: { role: 'assistant', content: 'Recovered final answer' },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().turnTimings({
      sessionKey: 'agent:main:session-restart-timing',
      limit: 1000,
    });

    expect(result).toEqual({
      success: true,
      timings: [{
        normalizedUserText: 'Explain SolidWorks file versioning',
        userOccurrenceFromTail: 1,
        durationMs: 280_564,
      }],
    });
  });

  it('falls back to message timestamps and omits negative or orphan turn timings', async () => {
    seedTranscriptRecords('agent:main:session-timing-fallback', [
      {
        type: 'message',
        message: { role: 'assistant', content: 'orphan', timestamp: 2_000_000_000_000 },
      },
      {
        type: 'message',
        message: { role: 'user', content: 'Fallback', timestamp: 2_000_000_001_000 },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: 'answer', timestamp: 2_000_000_003_500 },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:03:10.000Z',
        message: { role: 'user', content: 'Clock skew' },
      },
      {
        type: 'message',
        timestamp: '2026-07-22T10:03:09.000Z',
        message: { role: 'assistant', content: 'older answer' },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().turnTimings({
      sessionKey: 'agent:main:session-timing-fallback',
      limit: 1000,
    });

    expect(result).toEqual({
      success: true,
      timings: [{
        normalizedUserText: 'Fallback',
        userOccurrenceFromTail: 1,
        durationMs: 2_500,
      }],
    });
  });

  it('returns OpenClaw ACP cwd as workspacePath when available', async () => {
    seedAcpCwd('agent:main:session-a', '/Users/alex/workspace/ClawX');
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-a'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-a',
      workspacePath: '/Users/alex/workspace/ClawX',
    });
  });

  it('returns ACP bridge replay cwd as workspacePath when available', async () => {
    seedAcpReplayCwd('agent:main:session-a', '/Users/alex/workspace/ReplayProject');
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-a'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-a',
      workspacePath: '/Users/alex/workspace/ReplayProject',
    });
  });

  it('prefers ACP runtime_options_json cwd over legacy acp_sessions cwd', async () => {
    seedAcpRuntimeOptionsCwd('agent:main:session-a', '/Users/alex/workspace/RuntimeProject');
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-a'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-a',
      workspacePath: '/Users/alex/workspace/RuntimeProject',
    });
  });

  it('returns null workspacePath when OpenClaw cwd is unavailable', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-missing'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-missing',
      workspacePath: null,
    });
  });

  it('marks heartbeat-only transcripts without using them as titles', async () => {
    seedTranscript('agent:main:session-heartbeat', [
      {
        role: 'user',
        content: '[OpenClaw heartbeat poll]',
        timestamp: 9_000,
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-heartbeat'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-heartbeat',
      firstUserText: null,
      lastTimestamp: 9_000_000,
      heartbeatOnly: true,
    });
  });

  it('does not mark other internal-only transcript prompts as heartbeat sessions', async () => {
    seedTranscript('agent:main:session-time-poll', [
      {
        role: 'user',
        content: 'Current time: local / 2026-05-06 12:00 UTC',
        timestamp: 9_001,
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const api = createSessionsApi();

    const result = await api.summaries({ sessionKeys: ['agent:main:session-time-poll'] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey: 'agent:main:session-time-poll',
      firstUserText: null,
      lastTimestamp: 9_001_000,
    });
    expect(result.summaries?.[0]?.heartbeatOnly).toBeUndefined();
  });

  it('derives historical titles from sqlite transcripts after sessions.json is gone', async () => {
    const sessionKey = 'agent:main:session-1791888271979';
    seedSqliteTranscript(sessionKey, '8d5062a3-d11b-4101-a00a-e3028eb5195d', [
      { type: 'session', id: '8d5062a3-d11b-4101-a00a-e3028eb5195d' },
      {
        type: 'message',
        timestamp: '2026-10-13T10:44:54.997Z',
        message: {
          role: 'user',
          content: '[Working directory: ~/.openclaw/workspace]\n\n你给我检查一下你的模型型号和供应商',
          timestamp: 1_791_888_294_706,
        },
      },
      {
        type: 'message',
        timestamp: '2026-10-13T10:45:10.508Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '当前运行的模型信息' }],
          timestamp: 1_791_888_310_508,
        },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().summaries({ sessionKeys: [sessionKey] });

    expect(result.success).toBe(true);
    expect(result.summaries?.[0]).toMatchObject({
      sessionKey,
      firstUserText: '你给我检查一下你的模型型号和供应商',
      lastTimestamp: 1_791_888_310_508,
    });
  });

  it('reads sqlite titles for every requested session through one database', async () => {
    seedSqliteTranscript('agent:main:session-alpha', 'alpha-id', [
      {
        type: 'message',
        message: { role: 'user', content: 'Alpha prompt', timestamp: 1_700_000_000_100 },
      },
    ]);
    seedSqliteTranscript('agent:main:session-beta', 'beta-id', [
      {
        type: 'message',
        message: { role: 'user', content: 'Beta prompt', timestamp: 1_700_000_000_200 },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().summaries({
      sessionKeys: ['agent:main:session-alpha', 'agent:main:session-missing', 'agent:main:session-beta'],
    });

    expect(result.summaries).toEqual([
      expect.objectContaining({ sessionKey: 'agent:main:session-alpha', firstUserText: 'Alpha prompt' }),
      expect.objectContaining({ sessionKey: 'agent:main:session-missing', firstUserText: null }),
      expect.objectContaining({ sessionKey: 'agent:main:session-beta', firstUserText: 'Beta prompt' }),
    ]);
  });

  it('keeps a slash-command prompt as the sqlite transcript title', async () => {
    const sessionKey = 'agent:main:session-1791784248045';
    seedSqliteTranscript(sessionKey, 'c7414436-8ee4-4714-8449-db52b3324c89', [
      {
        type: 'message',
        message: {
          role: 'user',
          content: '/月末发票整理  做9月报销单，阿里云这次的发票记到公司而非是郭宇梁本人',
          timestamp: 1_791_796_001_153,
        },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().summaries({ sessionKeys: [sessionKey] });

    expect(result.summaries?.[0]).toMatchObject({
      sessionKey,
      firstUserText: '/月末发票整理  做9月报销单，阿里云这次的发票记到公司而非是郭宇梁本人',
      lastTimestamp: 1_791_796_001_153,
    });
  });

  it('prefers authoritative SQLite over stale sessions.json when both exist', async () => {
    const sessionKey = 'agent:main:session-both';
    seedTranscript(sessionKey, [{
      role: 'user',
      content: 'Title from jsonl',
      timestamp: 5_000,
    }]);
    seedSqliteTranscript(sessionKey, 'session-both-id', [
      {
        type: 'message',
        message: { role: 'user', content: 'Title from sqlite', timestamp: 9_000 },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().summaries({ sessionKeys: [sessionKey] });

    expect(result.summaries?.[0]).toMatchObject({
      sessionKey,
      firstUserText: 'Title from sqlite',
      lastTimestamp: 9_000_000,
    });
  });

  it('still marks heartbeat-only sqlite transcripts without using them as titles', async () => {
    const sessionKey = 'agent:main:session-sqlite-heartbeat';
    seedSqliteTranscript(sessionKey, 'heartbeat-session-id', [
      {
        type: 'message',
        message: {
          role: 'user',
          content: '[OpenClaw heartbeat poll]',
          timestamp: 9_000,
        },
      },
    ]);
    const { createSessionsApi } = await import('@electron/services/sessions-api');

    const result = await createSessionsApi().summaries({ sessionKeys: [sessionKey] });

    expect(result.summaries?.[0]).toMatchObject({
      sessionKey,
      firstUserText: null,
      lastTimestamp: 9_000_000,
      heartbeatOnly: true,
    });
  });
});
