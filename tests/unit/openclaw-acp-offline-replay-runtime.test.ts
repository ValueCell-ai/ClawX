// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
const key = 'agent:main:offline-replay-fixture';
const marker = 'openclaw.ai/transcript-replay';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

function nativeMessage(id: string, run: string, at: number, content: unknown, extra: Json = {}): Json {
  return {
    role: 'assistant', timestamp: at - 10_000, stopReason: 'stop', content,
    __openclaw: { id, runId: run, recordTimestampMs: at, transcriptPosition: { source: 'native-window', rawSeq: Number(id.replace(/\D/g, '')) || 1 } },
    ...extra,
  };
}
const text = (value: string) => [{ type: 'text', text: value }];
const assistantText = (updates: Json[]) => updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => (u.content as Json).text as string).join('');

async function fixture() {
  const home = await mkdtemp(path.join(tmpdir(), 'clawx-acp-offline-'));
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
  let promptIndex = 0;
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
        const reply = promptIndex++ === 0 ? 'ORIGINAL_LEDGER_REPLY' : 'SUBSEQUENT_PROMPT_REPLY';
        payload = { runId, status: 'started' };
        setTimeout(() => socket.send(JSON.stringify({ type: 'event', event: 'chat', payload: { sessionKey: key, runId, state: 'final', seq: 1, message: { role: 'assistant', content: text(reply) } } })), 10);
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
  await acp.call('session/prompt', { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'Original request' }] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { state, requests, acp, ledger, startAcp, at: Date.now(), databasePath: path.join(home, 'state/openclaw.sqlite') };
}

describe('installed ACP offline transcript-tail replay', () => {
  it('repairs a legacy complete ledger once, persists native commit time, and survives another prompt and a fresh process', async () => {
    const f = await fixture();
    const before = f.ledger();
    const offline = nativeMessage('record13', 'announce:v1:offline', f.at, text('OFFLINE_COMPLETION'));
    f.state.messages = [offline, offline]; // duplicate native response identity
    const updates = await f.acp.load();
    expect(assistantText(updates)).toBe('ORIGINAL_LEDGER_REPLY\n\nOFFLINE_COMPLETION');
    const imported = f.ledger().filter((r) => (r.update._meta as Json)?.[marker]);
    expect(imported).toHaveLength(1);
    expect(imported[0].at).toBe(f.at);
    expect(f.ledger().slice(0, before.length)).toEqual(before);
    expect(assistantText(await f.acp.load())).toBe(assistantText(updates));
    await f.acp.call('session/prompt', { sessionId: key, prompt: [{ type: 'text', text: 'Next request' }] });
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLY\n\nOFFLINE_COMPLETIONSUBSEQUENT_PROMPT_REPLY');
    await f.acp.close();
    const fresh = await f.startAcp();
    expect(assistantText(await fresh.load())).toContain('OFFLINE_COMPLETION');
    expect(f.ledger().filter((r) => (r.update._meta as Json)?.[marker])).toHaveLength(1);
    expect(f.requests.filter((r) => r.method === 'sessions.get').every((r) => r.params.key === key && r.params.limit === 1_000_000)).toBe(true);
  }, 30_000);

  it('keeps text, thought and tool boundaries ordered and deduplicates overlapping buffered live events', async () => {
    const f = await fixture();
    const run = 'announce:v1:overlap';
    const call = { type: 'toolCall', id: 'offline-tool', name: 'exec', arguments: { code: 'return 1' } };
    f.state.messages = [
      nativeMessage('record20', run, f.at, [{ type: 'thinking', thinking: 'offline thought' }, ...text('BEFORE_TOOL'), call], { stopReason: 'toolUse' }),
      nativeMessage('record21', run, f.at + 1, text('tool output'), { role: 'toolResult', toolCallId: 'offline-tool' }),
      nativeMessage('record22', run, f.at + 2, text('AFTER_TOOL')),
    ];
    f.state.duringRead = (ws) => {
      const send = (event: string, payload: Json) => ws.send(JSON.stringify({ type: 'event', event, payload: { sessionKey: key, runId: run, ...payload } }));
      send('session.tool', { stream: 'tool', data: { phase: 'start', toolCallId: 'offline-tool', name: 'exec', args: { code: 'return 1' } } });
      send('session.tool', { stream: 'tool', data: { phase: 'result', toolCallId: 'offline-tool', result: 'tool output' } });
      send('chat', { state: 'delta', message: { content: text('BEFORE_TOOLAFTER_TOOL') } });
      send('chat', { state: 'final', message: { content: text('BEFORE_TOOLAFTER_TOOL') } });
    };
    const updates = await f.acp.load();
    expect(updates.filter((u) => u.sessionUpdate === 'tool_call')).toHaveLength(1);
    expect(updates.filter((u) => u.sessionUpdate === 'tool_call_update')).toHaveLength(1);
    expect(assistantText(updates)).toBe('ORIGINAL_LEDGER_REPLY\n\nBEFORE_TOOL\n\nAFTER_TOOL');
    const meaningful = updates.filter((u) => ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(String(u.sessionUpdate)));
    expect(meaningful.map((u) => u.sessionUpdate)).toEqual(['agent_message_chunk', 'agent_thought_chunk', 'agent_message_chunk', 'tool_call', 'tool_call_update', 'agent_message_chunk']);
    expect(assistantText(await f.acp.load())).toBe(assistantText(updates));
  }, 30_000);

  it('drains a newer buffered suffix when the transcript only covers the start of an unfinished run', async () => {
    const f = await fixture();
    const run = 'announce:v1:inflight';
    f.state.messages = [nativeMessage('record30', run, f.at, text('PREFIX'), { stopReason: 'toolUse' })];
    f.state.duringRead = (ws) => ws.send(JSON.stringify({ type: 'event', event: 'chat', payload: { sessionKey: key, runId: run, state: 'final', message: { content: text('PREFIX_SUFFIX') } } }));
    const updates = await f.acp.load();
    expect(assistantText(updates)).toBe('ORIGINAL_LEDGER_REPLY\n\nPREFIX_SUFFIX');
    expect(assistantText(await f.acp.load())).toBe(assistantText(updates));
  }, 30_000);

  it('imports only an unseen suffix for a partially recorded run without rewriting its prefix', async () => {
    const f = await fixture();
    const run = 'announce:v1:partial';
    f.state.duringRead = (ws) => ws.send(JSON.stringify({ type: 'event', event: 'chat', payload: { sessionKey: key, runId: run, state: 'delta', message: { content: text('PARTIAL') } } }));
    await f.acp.load();
    const original = f.ledger();
    await new Promise((resolve) => setTimeout(resolve, 10));
    f.state.messages = [nativeMessage('record35', run, Date.now(), text('PARTIAL_SUFFIX'))];
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLYPARTIAL_SUFFIX');
    expect(f.ledger().slice(0, original.length)).toEqual(original);
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLYPARTIAL_SUFFIX');
  }, 30_000);

  it('does not advance transcript coverage to the wall clock of an import', async () => {
    const f = await fixture();
    f.state.messages = [nativeMessage('record36', 'announce:v1:first', f.at, text('FIRST_OFFLINE'))];
    await new Promise((resolve) => setTimeout(resolve, 40));
    await f.acp.load();
    // This record predates the first import operation but follows its native coverage.
    f.state.messages.push(nativeMessage('record37', 'announce:v1:second', f.at + 1, text('SECOND_OFFLINE')));
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLY\n\nFIRST_OFFLINE\n\nSECOND_OFFLINE');
    expect(f.ledger().filter((r) => (r.update._meta as Json)?.[marker]).map((r) => r.at)).toEqual([f.at, f.at + 1]);
  }, 30_000);

  it('rolls back the whole tail batch if persistence fails after its first update', async () => {
    const f = await fixture();
    const before = f.ledger();
    const db = new DatabaseSync(f.databasePath);
    try {
      db.exec("CREATE TRIGGER fixture_reject_tail BEFORE INSERT ON acp_replay_events WHEN instr(NEW.update_json, 'FAIL_DURING_IMPORT') > 0 BEGIN SELECT RAISE(ABORT, 'fixture import failure'); END");
    } finally { db.close(); }
    f.state.messages = [
      nativeMessage('record38', 'announce:v1:atomic', f.at, text('FIRST_BATCH_UPDATE')),
      nativeMessage('record39', 'announce:v1:atomic', f.at + 1, text('FAIL_DURING_IMPORT')),
    ];
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLY');
    expect(f.ledger()).toEqual(before);
  }, 30_000);

  it('keeps the complete ledger on fetch failure and rejects stale, invalid and control records', async () => {
    const f = await fixture();
    const before = f.ledger();
    f.state.failRead = true;
    expect(assistantText(await f.acp.load())).toBe('ORIGINAL_LEDGER_REPLY');
    expect(f.ledger()).toEqual(before);
    f.state.failRead = false;
    const highWater = Math.max(...before.map((r) => Number(r.at)));
    f.state.messages = [
      nativeMessage('record40', 'old', highWater, text('STALE')),
      nativeMessage('record41', 'invalid', Number.NaN, text('INVALID_TIMESTAMP')),
      { role: 'assistant', timestamp: f.at, content: text('NO_NATIVE_ID') },
      nativeMessage('record42', 'control', f.at, 'internal control', { role: 'user', provenance: { kind: 'internal_system' } }),
      nativeMessage('record43', 'offline', f.at, text('VALID_TAIL')),
    ];
    const updates = await f.acp.load();
    expect(assistantText(updates)).toBe('ORIGINAL_LEDGER_REPLY\n\nVALID_TAIL');
    expect(updates.filter((u) => u.sessionUpdate === 'user_message_chunk')).toHaveLength(1);
  }, 30_000);

  it('imports one durable tail when two ACP processes load the same ledger', async () => {
    const f = await fixture();
    const second = await f.startAcp();
    f.state.messages = [nativeMessage('record50', 'announce:v1:two-readers', Date.now(), text('ONE_DURABLE_TAIL'))];
    const [a, b] = await Promise.all([f.acp.load(), second.load()]);
    expect(assistantText(a)).toBe('ORIGINAL_LEDGER_REPLY\n\nONE_DURABLE_TAIL');
    expect(assistantText(b)).toBe(assistantText(a));
    expect(f.ledger().filter((r) => (r.update._meta as Json)?.[marker])).toHaveLength(1);
  }, 30_000);

  it('uses the same overlap protection when an incomplete ledger falls back to transcript replay', async () => {
    const f = await fixture();
    const db = new DatabaseSync(f.databasePath);
    try { db.prepare('UPDATE acp_replay_sessions SET complete = 0 WHERE session_key = ?').run(key); }
    finally { db.close(); }
    const run = 'announce:v1:fallback';
    f.state.messages = [nativeMessage('record60', run, f.at, text('INCOMPLETE_FALLBACK'))];
    f.state.duringRead = (ws) => ws.send(JSON.stringify({ type: 'event', event: 'chat', payload: { sessionKey: key, runId: run, state: 'final', message: { content: text('INCOMPLETE_FALLBACK') } } }));
    expect(assistantText(await f.acp.load())).toBe('INCOMPLETE_FALLBACK');
  }, 30_000);
});
