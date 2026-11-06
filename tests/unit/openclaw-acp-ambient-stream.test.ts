// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');

type Ambient = {
  beginReplay(session: { sessionId: string; sessionKey: string }): Promise<void>;
  completeReplay(session: { sessionId: string; sessionKey: string }, baseline: Record<string, string>): Promise<void>;
  deactivate(sessionId?: string): Promise<void>;
  isReplayBuffered(evt: Record<string, unknown>): boolean;
  handleChatEvent(evt: Record<string, unknown>): Promise<void>;
  handleAgentEvent(evt: Record<string, unknown>): Promise<boolean>;
  recoverSubscriptions(): Promise<void>;
  dispatchEvent?: (evt: Record<string, unknown>) => Promise<void>;
};

let bundle: string;

beforeAll(async () => {
  bundle = await readFile(path.join(dist, 'server-DkfYuk25.mjs'), 'utf8');
});

function loadAmbientClass() {
  const start = bundle.indexOf('function resolveAmbientReplayBaseline(');
  const end = bundle.indexOf('//#endregion', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const context = {
    ACP_TRANSCRIPT_REPLAY_META: 'openclaw.ai/transcript-replay',
    normalizeOptionalString: (value: unknown) => (
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    ),
    extractReplayChunks: () => [],
    resolveAssistantEventPhase: () => 'commentary',
    resolveAcpEventTextSnapshot: (previous: string, data: { text?: string; delta?: string }) => {
      if (data.delta) return previous + data.delta;
      return data.text ?? previous;
    },
    resolveAcpTextDelta: (previous: string, next: string) => {
      if (next === previous) return '';
      if (next.startsWith(previous)) return next.slice(previous.length);
      return next;
    },
    formatToolTitle: (name: string) => name,
    inferToolKind: () => 'other',
    extractToolCallLocations: () => undefined,
    extractToolCallContent: () => undefined,
    AcpTranslatorAmbient: undefined as new (...args: unknown[]) => Ambient,
  } as Record<string, unknown>;
  runInNewContext(
    `${bundle.slice(start, end)}\nglobalThis.AcpTranslatorAmbient = AcpTranslatorAmbient;`,
    context,
  );
  return context.AcpTranslatorAmbient as new (...args: unknown[]) => Ambient;
}

function createHarness() {
  const requests: Array<{ method: string; params: unknown }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const gateway = {
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return {};
    },
  };
  const sessionUpdates = {
    emit: async (update: Record<string, unknown>) => {
      updates.push(update);
    },
  };
  const AmbientClass = loadAmbientClass();
  const ambient = new AmbientClass(gateway, sessionUpdates, undefined, () => {});
  return { ambient, requests, updates };
}

const session = { sessionId: 'acp-session-1', sessionKey: 'agent:main:subagent:child' };

describe('OpenClaw ACP ambient session streaming', () => {
  it('subscribes on load replay and unsubscribes on close', async () => {
    const { ambient, requests } = createHarness();

    await ambient.beginReplay(session);
    expect(requests.map((request) => request.method)).toContain('sessions.messages.subscribe');
    expect(requests).toContainEqual({
      method: 'sessions.messages.subscribe',
      params: { key: session.sessionKey },
    });

    await ambient.completeReplay(session, {});
    await ambient.deactivate(session.sessionId);
    expect(requests.map((request) => request.method)).toContain('sessions.messages.unsubscribe');
  });

  it('buffers matching events during replay and dispatches them after completion', async () => {
    const { ambient } = createHarness();
    const dispatched: Array<Record<string, unknown>> = [];
    ambient.dispatchEvent = async (evt) => {
      dispatched.push(evt);
    };

    await ambient.beginReplay(session);
    const buffered = { event: 'chat', payload: { sessionKey: session.sessionKey, runId: 'announce:v1:child' } };
    expect(ambient.isReplayBuffered(buffered)).toBe(true);
    expect(ambient.isReplayBuffered({ event: 'chat', payload: { sessionKey: 'agent:main:other' } })).toBe(false);

    await ambient.completeReplay(session, { sentText: 'replayed' });
    expect(dispatched).toEqual([buffered]);
  });

  it('streams tool lifecycle and commentary thought for a live subagent run', async () => {
    const { ambient, updates } = createHarness();
    await ambient.beginReplay(session);
    await ambient.completeReplay(session, {});

    await expect(ambient.handleAgentEvent({
      event: 'agent',
      payload: {
        stream: 'assistant',
        sessionKey: session.sessionKey,
        runId: 'announce:v1:child',
        data: { phase: 'commentary', text: 'checking files' },
      },
    })).resolves.toBe(true);
    expect(updates.at(-1)).toMatchObject({
      sessionId: session.sessionId,
      update: { sessionUpdate: 'agent_thought_chunk' },
    });

    await expect(ambient.handleAgentEvent({
      event: 'session.tool',
      payload: {
        stream: 'tool',
        sessionKey: session.sessionKey,
        runId: 'announce:v1:child',
        data: { phase: 'start', name: 'read', toolCallId: 'tool-1', args: { path: 'a.ts' } },
      },
    })).resolves.toBe(true);
    expect(updates.at(-1)).toMatchObject({
      sessionId: session.sessionId,
      update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', status: 'in_progress' },
    });

    await expect(ambient.handleAgentEvent({
      event: 'session.tool',
      payload: {
        stream: 'tool',
        sessionKey: session.sessionKey,
        runId: 'announce:v1:child',
        data: { phase: 'result', toolCallId: 'tool-1', result: 'ok', isError: false },
      },
    })).resolves.toBe(true);
    expect(updates.at(-1)).toMatchObject({
      update: { sessionUpdate: 'tool_call_update', status: 'completed' },
    });
  });

  it('does not stream events for an unrelated session', async () => {
    const { ambient, updates } = createHarness();
    await ambient.beginReplay(session);
    await ambient.completeReplay(session, {});

    await expect(ambient.handleAgentEvent({
      event: 'agent',
      payload: {
        stream: 'tool',
        sessionKey: 'agent:main:other',
        runId: 'announce:v1:child',
        data: { phase: 'start', name: 'read', toolCallId: 'tool-1', args: {} },
      },
    })).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });
});
