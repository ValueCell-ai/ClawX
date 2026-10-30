// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket, WebSocketServer } from 'ws';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
const key = 'agent:main:compaction-fixture';
const marker = 'openclaw.ai/compaction';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'clawx-acp-compaction-'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const config = path.join(home, 'openclaw.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local' } }));
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanups.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const state = { messages: [] as Json[], failRead: false, duringRead: undefined as undefined | ((socket: WebSocket) => void) };
  const requests: Array<{ method: string; params: Json }> = [];
  const activeRuns: string[] = [];
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture', ts: Date.now() } }));
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      requests.push(request);
      let payload: unknown = {};
      if (request.method === 'connect') payload = { type: 'hello-ok', protocol: 3, server: { version: 'fixture', connId: String(Math.random()) }, features: { methods: [], events: [] }, snapshot: {}, policy: { tickIntervalMs: 60_000 } };
      else if (request.method === 'sessions.resolve') payload = { key };
      else if (request.method === 'sessions.list') payload = { sessions: [{ key, sessionId: 'native-session' }] };
      else if (request.method === 'sessions.get') {
        if (state.failRead) {
          socket.send(JSON.stringify({ type: 'res', id: request.id, ok: false, error: { code: 'UNAVAILABLE', message: 'temporary transcript failure' } }));
          return;
        }
        const onRead = state.duringRead;
        state.duringRead = undefined;
        onRead?.(socket);
        payload = { messages: state.messages };
      } else if (request.method === 'chat.send') {
        const runId = request.params.idempotencyKey;
        activeRuns.push(runId);
        payload = { runId, status: 'started' };
      }
      socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }));
    });
  });
  const port = (server.address() as { port: number }).port;
  async function startAcp() {
    const child = spawn(process.execPath, [path.resolve('node_modules/openclaw/dist/server-DkfYuk25.mjs'), '--url', `ws://127.0.0.1:${port}`, '--token', 'fixture', '--verbose'], {
      env: { ...process.env, HOME: home, OPENCLAW_STATE_DIR: home, OPENCLAW_CONFIG_PATH: config },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stderr.on('data', (data) => { diagnostics += String(data); });
    const close = async () => {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    };
    cleanups.push(close);
    const updates: Json[] = [];
    let id = 0;
    const pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message = JSON.parse(line);
      if (message.method === 'session/update') updates.push(message.params.update);
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    const call = (method: string, params: Json) => new Promise<Json>((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out: ${diagnostics}`)), 15_000);
      pending.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    });
    await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const load = async () => {
      const start = updates.length;
      await call('session/load', { sessionId: key, cwd: home, mcpServers: [] });
      return updates.slice(start);
    };
    return { call, load, updates, close };
  }
  function ledger() {
    const db = new DatabaseSync(path.join(home, 'state/openclaw.sqlite'), { readOnly: true });
    try {
      return db.prepare('SELECT e.seq,e.at,e.run_id,e.update_json FROM acp_replay_events e JOIN acp_replay_sessions s USING(session_id) WHERE s.session_key = ? ORDER BY e.seq').all(key).map((r) => ({ ...r, update: JSON.parse(String(r.update_json)) as Json }));
    } finally { db.close(); }
  }
  const acp = await startAcp();
  const created = await acp.call('session/new', { cwd: home, mcpServers: [], _meta: { sessionKey: key } });
  const emit = (event: string, payload: Json) => {
    for (const socket of server.clients) socket.send(JSON.stringify({ type: 'event', event, payload }));
  };
  return { state, requests, acp, ledger, startAcp, activeRuns, emit, sessionId: created.sessionId };

}

const compactions = (updates: Json[]) => updates.flatMap((u) => {
  const value = (u._meta as Json)?.[marker];
  return value ? [value as Json] : [];
});
const lifecycle = (id: string, phase: string, extra: Json = {}) => ({
  operation: 'compact', sessionKey: key, compactionId: id, phase, source: 'manual',
  completed: phase === 'end', aborted: false, timestamp: new Date().toISOString(), ...extra,
});

// Each case cold-starts the installed OpenClaw ACP process, which can exceed
// Vitest's 5s default on loaded CI runners.
describe('installed ACP compaction lifecycle', { timeout: 30_000 }, () => {
  it('records pending manual and automatic operations once and replays them after a fresh process', async () => {
    const f = await fixture();
    const prompt = f.acp.call('session/prompt', { sessionId: f.sessionId, prompt: [{ type: 'text', text: '/compact' }] });
    await expect.poll(() => f.activeRuns.length).toBe(1);
    const runId = f.activeRuns[0];
    for (const source of ['manual', 'preflight', 'overflow', 'threshold']) {
      for (const phase of ['start', 'end']) {
        const data = lifecycle(`cmp-${source}`, phase, { source, willRetry: source !== 'manual' });
        // Duplicated native deliveries must not create extra ledger entries.
        f.emit('agent', { sessionKey: key, runId, stream: 'compaction', data });
        f.emit('agent', { sessionKey: key, runId, stream: 'compaction', data });
      }
    }
    await expect.poll(() => compactions(f.acp.updates).length).toBe(8);
    expect(compactions(f.acp.updates).map((m) => m.status)).toEqual(Array(4).fill(['in_progress', 'completed']).flat());
    f.emit('chat', { sessionKey: key, runId, state: 'final', message: { role: 'assistant', content: [{ type: 'text', text: 'Compacted' }] } });
    await prompt;
    await expect.poll(() => f.ledger().filter((e) => (e.update._meta as Json)?.[marker]).length).toBe(8);
    await f.acp.close();
    const cold = await f.startAcp();
    expect(compactions(await cold.load())).toEqual(compactions(f.acp.updates));
    const before = cold.updates.length;
    f.emit('agent', { sessionKey: key, runId, stream: 'compaction', data: lifecycle('cmp-manual', 'start') });
    f.emit('agent', { sessionKey: key, runId, stream: 'compaction', data: lifecycle('cmp-manual', 'end') });
    // A following valid event is a processing barrier for the duplicate pair.
    f.emit('session.operation', lifecycle('barrier', 'end'));
    await expect.poll(() => compactions(cold.updates.slice(before)).length).toBe(1);
    expect(compactions(cold.updates.slice(before))[0].compactionId).toBe('barrier');
  });

  it('projects passive external operations, buffers them during load and rejects wrong sessions and prose', async () => {
    const f = await fixture();
    f.state.duringRead = (socket) => {
      socket.send(JSON.stringify({ type: 'event', event: 'session.operation', payload: lifecycle('passive', 'start') }));
      socket.send(JSON.stringify({ type: 'event', event: 'session.operation', payload: lifecycle('passive', 'end') }));
    };
    const replay = await f.acp.load();
    await expect.poll(() => compactions(f.acp.updates).length).toBe(2);
    expect(compactions(replay).map((m) => m.status)).toEqual(['in_progress', 'completed']);
    const before = f.acp.updates.length;
    f.emit('session.operation', lifecycle('wrong', 'start', { sessionKey: 'agent:main:other' }));
    f.emit('agent', { sessionKey: key, runId: 'unrelated-parent', stream: 'assistant', data: { phase: 'commentary', text: 'DO_NOT_PROJECT' } });
    f.emit('agent', { sessionKey: key, runId: 'external-compact', stream: 'compaction', data: lifecycle('external', 'end', { completed: false, aborted: true }) });
    await expect.poll(() => compactions(f.acp.updates.slice(before)).length).toBe(1);
    expect(compactions(f.acp.updates.slice(before))[0]).toMatchObject({ compactionId: 'external', status: 'cancelled' });
    expect(JSON.stringify(f.acp.updates)).not.toContain('DO_NOT_PROJECT');
    expect(compactions(f.acp.updates).some((m) => m.compactionId === 'wrong')).toBe(false);
  });

  it('maps failed and cancelled outcomes and never reopens a completed occurrence', async () => {
    const f = await fixture();
    await f.acp.load();
    f.emit('session.operation', lifecycle('failed', 'start'));
    f.emit('session.operation', lifecycle('failed', 'end', { completed: false, failureReason: 'x'.repeat(900), reasonCode: 'provider_failed' }));
    f.emit('session.operation', lifecycle('failed', 'start'));
    f.emit('session.operation', lifecycle('cancelled', 'end', { completed: false, aborted: true }));
    await expect.poll(() => compactions(f.acp.updates).length).toBe(3);
    const [start, failed, cancelled] = compactions(f.acp.updates);
    expect(start.status).toBe('in_progress');
    expect(failed).toMatchObject({ status: 'failed', reasonCode: 'provider_failed' });
    expect(failed.reason).toHaveLength(500);
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('installed native compaction producers and subscribers', () => {
  async function producers() {
    const dist = path.resolve('node_modules/openclaw/dist');
    const embedded = await readFile(path.join(dist, 'embedded-agent-w-EKmRVf.mjs'), 'utf8');
    const helper = embedded.slice(embedded.indexOf('async function withCompactionLifecycle('), embedded.indexOf('async function compactEmbeddedAgentSession(input, options)'));
    const events: Json[] = [];
    const outcome = { ok: true, compacted: true };
    const context = {
      randomUUID: () => `id-${Math.random()}`,
      captureAgentRunLifecycleGeneration: () => 'native-generation',
      emitAgentEvent: (event: Json) => events.push(event),
      compactEmbeddedAgentSessionWithoutLifecycle: async () => outcome,
      compactEmbeddedRunForRecoveryWithoutLifecycle: async () => ({ result: outcome, preserved: true }),
      log$3: { warn: () => {} }, formatErrorMessage: String,
    } as Record<string, unknown>;
    const functions = [
      embedded.slice(embedded.indexOf('async function compactEmbeddedAgentSession(input, options)'), embedded.indexOf('async function compactEmbeddedAgentSessionWithoutLifecycle(')),
      embedded.slice(embedded.indexOf('async function compactEmbeddedRunForRecovery(input, recovery)'), embedded.indexOf('async function compactEmbeddedRunForRecoveryWithoutLifecycle(')),
    ];
    runInNewContext(`${helper.replace(/^import[^\n]+\n/, '').replace('export async', 'async')}\n${functions.join('\n')}\nglobalThis.manual = compactEmbeddedAgentSession; globalThis.recovery = compactEmbeddedRunForRecovery; globalThis.report = withCompactionLifecycle;`, context);
    return { context, events, outcome };
  }

  it('executes the actual queued /compact and recovery wrappers with stable IDs and typed sources', async () => {
    const { context, events } = await producers();
    const manual = context.manual as (input: Json, options: Json) => Promise<unknown>;
    const recovery = context.recovery as (input: Json, recovery: Json) => Promise<unknown>;
    await manual({ trigger: 'manual', sessionKey: key }, {});
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ sessionKey: key, lifecycleGeneration: 'native-generation', stream: 'compaction', data: { phase: 'start', source: 'manual' } });
    expect(events[1]).toMatchObject({ data: { phase: 'end', completed: true, willRetry: false, compactionId: (events[0].data as Json).compactionId } });
    await manual({ trigger: 'manual', sessionKey: key, compactionLifecycleManaged: true }, {});
    expect(events).toHaveLength(2); // RPC owns this lifecycle.
    for (const trigger of ['budget', 'overflow', 'timeout_recovery']) {
      const result = await recovery({ runParams: { runId: 'real-run' }, resolvedSessionKey: key, assertRecoveryActive: () => {} }, { trigger });
      expect(result).toMatchObject({ preserved: true });
      expect(events.at(-2)).toMatchObject({ runId: 'real-run', data: { phase: 'start', source: trigger === 'overflow' ? 'overflow' : 'preflight' } });
      expect(events.at(-1)).toMatchObject({ data: { phase: 'end', completed: true, willRetry: true, compactionId: (events.at(-2)?.data as Json).compactionId } });
    }
    expect(new Set(events.filter((e) => (e.data as Json).phase === 'start').map((e) => (e.data as Json).compactionId)).size).toBe(4);
  });

  it('reports native returned aborts and thrown failures without swallowing or replacing the outcome', async () => {
    const { context } = await producers();
    const report = context.report as (params: Json, operation: () => Promise<unknown>) => Promise<unknown>;
    const events: Json[] = [];
    const params = { source: 'manual', emit: (data: Json) => events.push(data) };
    const cancelled = { ok: false, compacted: false, reason: 'compaction aborted' };
    expect(await report(params, async () => cancelled)).toBe(cancelled);
    expect(events.at(-1)).toMatchObject({ aborted: true, completed: false });
    const failure = new Error('x'.repeat(900));
    await expect(report(params, async () => { throw failure; })).rejects.toBe(failure);
    expect(events.at(-1)).toMatchObject({ aborted: false, completed: false, reasonCode: 'compaction_failed' });
    expect(events.at(-1)?.failureReason).toHaveLength(500);
  });

  it('unions authorized global and exact-session recipients once and retains scoped broadcast options', async () => {
    const bundle = await readFile(path.resolve('node_modules/openclaw/dist/sessions-shared-Dr0eLQJX.mjs'), 'utf8');
    const code = bundle.slice(bundle.indexOf('function emitSessionOperation('), bundle.indexOf('function isWorkerDispatchInputError('));
    const context: Record<string, unknown> = {};
    runInNewContext(`${code}\nglobalThis.emit = emitSessionOperation;`, context);
    const deliveries: Array<{ event: string; ids: string[]; opts: Json }> = [];
    const emit = context.emit as (context: Json, payload: Json) => void;
    const gateway = {
      getSessionEventSubscriberConnIds: () => new Set(['global', 'both']),
      getSessionMessageSubscriberConnIds: (sessionKey: string) => new Set(sessionKey === key ? ['both', 'exact'] : ['other']),
      broadcastToConnIds: (event: string, _payload: Json, ids: Set<string>, opts: Json) => deliveries.push({ event, ids: [...ids], opts }),
    };
    emit(gateway, lifecycle('rpc', 'start', { agentId: 'main' }));
    expect(deliveries).toEqual([{ event: 'session.operation', ids: ['global', 'both', 'exact'], opts: { sessionKeys: [key], agentId: 'main', dropIfSlow: true } }]);
    expect(deliveries[0].opts.sessionSubscriptionVerified).toBeUndefined();
    emit(gateway, { operation: 'reset', sessionKey: key });
    expect(deliveries[1].ids).toEqual(['global', 'both']);
  });
});

