import { describe, expect, it } from 'vitest';
import {
  applyGatewaySessionsChanged,
  normalizeGatewaySessionPatch,
  normalizeGatewaySessionRow,
} from '@/stores/chat/session-catalog';

const SESSION_KEY = 'agent:main:session-a';

describe('Gateway session catalog projection', () => {
  it('normalizes list and event rows through one allowlisted projection', () => {
    const raw = {
      key: `  ${SESSION_KEY}  `,
      label: 'Label',
      displayName: 'Display',
      derivedTitle: 'Derived',
      lastMessagePreview: 'Preview',
      thinkingLevel: 'high',
      model: 'model-a',
      updatedAt: '2026-07-20T00:00:00.000Z',
      status: ' RUNNING ',
      hasActiveRun: true,
      lastChannel: 'discord',
      ignored: 'must not leak',
    };

    const row = normalizeGatewaySessionRow(raw);
    const patch = normalizeGatewaySessionPatch(raw);

    expect(row).toEqual({
      key: SESSION_KEY,
      label: 'Label',
      displayName: 'Display',
      derivedTitle: 'Derived',
      lastMessagePreview: 'Preview',
      thinkingLevel: 'high',
      model: 'model-a',
      updatedAt: Date.parse('2026-07-20T00:00:00.000Z'),
      status: 'running',
      hasActiveRun: true,
      channel: 'discord',
    });
    expect(patch.values).toEqual(row);
    expect(patch.present).toEqual(new Set(Object.keys(row)));
    expect(row).not.toHaveProperty('ignored');
  });

  it('uses a nested session snapshot instead of top-level row fields', () => {
    const result = applyGatewaySessionsChanged(
      [{ key: SESSION_KEY, status: 'done', model: 'old-model' }],
      {
        key: SESSION_KEY,
        status: 'failed',
        model: 'envelope-model',
        ts: 10,
        session: { key: SESSION_KEY, status: 'running', model: 'nested-model' },
      },
      new Map(),
    );

    expect(result).toMatchObject({ applied: true, requiresReload: false });
    expect(result.sessions).toEqual([{ key: SESSION_KEY, status: 'running', model: 'nested-model' }]);
  });

  it('keeps a local new-chat placeholder hidden when the Gateway reports its ACP display name', () => {
    const result = applyGatewaySessionsChanged(
      [{ key: SESSION_KEY, displayName: SESSION_KEY, createdLocally: true }],
      {
        sessionKey: SESSION_KEY,
        ts: 10,
        displayName: 'ACP',
        updatedAt: 10,
      },
      new Map(),
    );

    expect(result).toMatchObject({ applied: true, requiresReload: true });
    expect(result.sessions).toEqual([{
      key: SESSION_KEY,
      displayName: 'ACP',
      createdLocally: true,
      updatedAt: 10_000,
    }]);
  });

  it('preserves explicit false and clears optional fields only when null is present', () => {
    const result = applyGatewaySessionsChanged(
      [{ key: SESSION_KEY, hasActiveRun: true, model: 'old-model', label: 'Keep me' }],
      {
        key: SESSION_KEY,
        hasActiveRun: false,
        model: null,
        ts: 10,
      },
      new Map(),
    );

    expect(result.sessions).toEqual([{ key: SESSION_KEY, hasActiveRun: false, label: 'Keep me' }]);
  });

  it('rejects conflicting nested and envelope keys and requests canonical reload', () => {
    const sessions = [{ key: SESSION_KEY, status: 'done' }];
    const result = applyGatewaySessionsChanged(
      sessions,
      {
        key: SESSION_KEY,
        ts: 10,
        session: { key: 'agent:main:other', status: 'running' },
      },
      new Map(),
    );

    expect(result).toEqual({ sessions, applied: false, requiresReload: true });
  });

  it('deletes only the exact envelope-key row', () => {
    const result = applyGatewaySessionsChanged(
      [
        { key: SESSION_KEY },
        { key: `${SESSION_KEY}:child` },
      ],
      { sessionKey: SESSION_KEY, reason: 'delete', ts: 10 },
      new Map(),
    );

    expect(result).toEqual({
      sessions: [{ key: `${SESSION_KEY}:child` }],
      applied: true,
      deletedKey: SESSION_KEY,
      requiresReload: false,
    });
  });

  it('inserts an unknown row only from a reliable nested snapshot', () => {
    const fences = new Map<string, number>();
    const partial = applyGatewaySessionsChanged(
      [],
      { key: SESSION_KEY, status: 'running', hasActiveRun: true, ts: 10 },
      fences,
    );
    const snapshot = applyGatewaySessionsChanged(
      [],
      {
        key: SESSION_KEY,
        ts: 11,
        session: { key: SESSION_KEY, displayName: 'New session', status: 'running', hasActiveRun: true },
      },
      fences,
    );

    expect(partial).toEqual({ sessions: [], applied: false, requiresReload: true });
    expect(snapshot).toMatchObject({ applied: true, requiresReload: false });
    expect(snapshot.sessions).toEqual([{
      key: SESSION_KEY,
      displayName: 'New session',
      status: 'running',
      hasActiveRun: true,
    }]);
  });

  it('never inserts or mutates attention rows from run-scoped cron snapshots', () => {
    const baseKey = 'agent:main:cron:job-a';
    const runKey = `${baseKey}:run:run-a`;
    const sessions = [{ key: baseKey, status: 'done', hasActiveRun: false }];
    const result = applyGatewaySessionsChanged(
      sessions,
      {
        key: runKey,
        ts: 10,
        session: { key: runKey, status: 'running', hasActiveRun: true },
      },
      new Map(),
    );

    expect(result).toEqual({ sessions, applied: false, requiresReload: false });
  });

  it('rejects an event older than the latest accepted timestamp for its exact key', () => {
    const fences = new Map([[SESSION_KEY, 20]]);
    const sessions = [{ key: SESSION_KEY, status: 'done', hasActiveRun: false }];
    const result = applyGatewaySessionsChanged(
      sessions,
      { key: SESSION_KEY, status: 'running', hasActiveRun: true, ts: 19 },
      fences,
    );

    expect(result).toEqual({ sessions, applied: false, requiresReload: false });
    expect(fences.get(SESSION_KEY)).toBe(20);
  });
});
