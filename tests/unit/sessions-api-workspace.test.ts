// @vitest-environment node

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testOpenClawDir = join(tmpdir(), `clawx-session-workspace-${process.pid}`);

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawDir,
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

describe('sessions API workspace summaries', () => {
  beforeEach(() => {
    rmSync(testOpenClawDir, { recursive: true, force: true });
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
});
