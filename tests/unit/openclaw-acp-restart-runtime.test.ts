// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocketServer, WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

const sessionKey = 'agent:main:acp-restart-fixture';
type Json = Record<string, unknown>;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

/** Real installed ACP stdio process and real reconnecting GatewayClient. */
async function runtime(options: { acknowledge?: boolean; grace?: number; unmaterialized?: boolean; reconnectSubscriptionFailures?: number } = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'clawx-acp-restart-'));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const config = path.join(home, 'openclaw.json');
  await writeFile(config, JSON.stringify({ gateway: { mode: 'local' } }));
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanups.push(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const requests: Array<{ method: string; params: Json }> = [];
  let socket: WebSocket | undefined;
  let connects = 0;
  let offline = false;
  let materialized = !options.unmaterialized;
  let subscribed = false;
  let reconnectSubscriptionFailures = options.reconnectSubscriptionFailures ?? 0;
  let waitResult: Json = { status: 'timeout' };
  let holdWait = false;
  const heldWaits: Array<() => void> = [];
  server.on('connection', (ws) => {
    if (offline) { ws.close(1012, 'fixture restart'); return; }
    socket = ws;
    subscribed = false;
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture', ts: Date.now() } }));
    ws.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      requests.push(request);
      let payload: unknown = {};
      if (request.method === 'connect') {
        connects++;
        payload = { type: 'hello-ok', protocol: 3, server: { version: 'fixture', connId: String(connects) }, features: { methods: [], events: [] }, snapshot: {}, policy: { tickIntervalMs: 60_000 } };
      } else if (request.method === 'sessions.resolve') payload = { key: sessionKey };
      else if (request.method === 'sessions.list') payload = { sessions: [{ key: sessionKey, sessionId: 'native-session' }] };
      else if (request.method === 'sessions.messages.subscribe') {
        if (!materialized || (connects > 1 && reconnectSubscriptionFailures-- > 0)) {
          ws.send(JSON.stringify({ type: 'res', id: request.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'Session not found before first send' } }));
          return;
        }
        subscribed = true;
      }
      else if (request.method === 'chat.send') {
        materialized = true;
        if (options.acknowledge === false) return;
        payload = { runId: request.params.idempotencyKey, status: 'started' };
      } else if (request.method === 'agent.wait') {
        if (holdWait) {
          heldWaits.push(() => ws.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { runId: request.params.runId, status: 'ok', terminalReply: { disposition: 'empty' } } })));
          return;
        }
        payload = { runId: request.params.runId, ...waitResult };
      } else if (request.method === 'chat.history') payload = {
        sessionId: 'native-session', hasMore: false,
        messages: [{ role: 'assistant', __openclaw: { runId: waitResult.runId }, content: [{ type: 'text', text: 'durable recovered reply' }] }],
      };
      ws.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }));
    });
  });
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, [path.resolve('node_modules/openclaw/dist/server-DkfYuk25.mjs'), '--url', `ws://127.0.0.1:${port}`, '--token', 'fixture', '--verbose'], {
    env: { ...process.env, HOME: home, OPENCLAW_STATE_DIR: home, OPENCLAW_CONFIG_PATH: config, OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS: String(options.grace ?? 480_000) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  cleanups.push(async () => {
    child.kill('SIGKILL');
    if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => { diagnostics += String(data); });
  const updates: Json[] = [];
  let id = 0;
  const pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('{')) return;
    const message = JSON.parse(line);
    if (message.method === 'session/update') updates.push(message.params.update);
    if (typeof message.id === 'number') {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter?.reject(new Error(message.error.message));
      else waiter?.resolve(message.result);
    }
  });
  const call = (method: string, params: Json) => new Promise<Json>((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} timed out: ${diagnostics}`)), method === 'session/prompt' ? 25_000 : 10_000);
    pending.set(requestId, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
  });
  await expect.poll(() => connects, { timeout: 15_000, message: 'ACP connects to fixture Gateway' }).toBe(1);
  try {
    await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const session = await call('session/new', { cwd: home, mcpServers: [], _meta: { sessionKey } });
    const prompt = call('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'restart fixture' }] });
    // Attach the rejection handler before exercising a timeout.
    const outcome = prompt.then((result) => ({ result }), (error: Error) => ({ error: error.message }));
    await expect.poll(() => requests.find((r) => r.method === 'chat.send')).toBeTruthy();
    const runId = String(requests.find((r) => r.method === 'chat.send')!.params.idempotencyKey);
    const event = (eventName: string, payload: Json) => {
      if (eventName === 'session.tool' && !subscribed) return;
      socket!.send(JSON.stringify({ type: 'event', event: eventName, payload }));
    };
    return {
      updates, requests, runId, outcome,
      get connects() { return connects; },
      setWaitResult: (result: Json) => { waitResult = result; },
      holdWait: () => { holdWait = true; },
      releaseWait: () => { holdWait = false; for (const release of heldWaits.splice(0)) release(); },
      event,
      chat: (run: string, source: string | undefined, state: string, text = '') => event('chat', { sessionKey, runId: run, resumedFromRunId: source, state, seq: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } }),
      disconnect: () => { offline = true; socket!.close(1012, 'fixture restart'); },
      reconnect: () => { offline = false; },
      cancel: () => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: session.sessionId } })}\n`); },
    };
  } catch (error) { throw new Error(`${String(error)}\n${diagnostics}`, { cause: error }); }
}

describe('installed OpenClaw ACP restart continuation', () => {
  it('survives more than five seconds, rejects unrelated lineage, streams tools and settles the original prompt', async () => {
    const r = await runtime({ unmaterialized: true, reconnectSubscriptionFailures: 2 });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let chat.send acknowledgement reach ACP
    r.event('agent', { sessionKey, runId: r.runId, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 'old-tool' } });
    r.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    r.reconnect();
    await expect.poll(() => r.connects, { timeout: 10_000 }).toBe(2);
    await expect.poll(() => r.requests.filter((q) => q.method === 'sessions.messages.subscribe').length).toBeGreaterThanOrEqual(6);
    r.chat('unrelated', undefined, 'final', 'WRONG_NO_SOURCE');
    r.chat('unrelated', 'not-the-source', 'final', 'WRONG_SOURCE');
    r.event('chat', { sessionKey: 'agent:other:session', runId: 'unrelated', resumedFromRunId: r.runId, state: 'final', message: { content: [{ type: 'text', text: 'WRONG_SESSION' }] } });
    r.event('session.tool', { sessionKey, runId: 'recovery-1', resumedFromRunId: r.runId, stream: 'tool', data: { phase: 'start', name: 'exec', toolCallId: 'new-tool' } });
    r.event('session.tool', { sessionKey, runId: 'recovery-1', resumedFromRunId: r.runId, stream: 'tool', data: { phase: 'result', toolCallId: 'new-tool', result: 'done' } });
    r.chat('recovery-1', r.runId, 'delta', 'continued');
    r.chat('recovery-1', r.runId, 'final', 'continued');
    await expect(r.outcome).resolves.toEqual({ result: { stopReason: 'end_turn' } });
    expect(r.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => (u.content as Json).text)).toEqual(['continued']);
    expect(r.updates).toContainEqual(expect.objectContaining({ toolCallId: 'old-tool', status: 'failed' }));
    expect(r.updates).toContainEqual(expect.objectContaining({ toolCallId: 'new-tool', status: 'completed' }));
  }, 30_000);

  it('adopts a second recovery and cancellation aborts the newest run', async () => {
    const r = await runtime();
    await new Promise((resolve) => setTimeout(resolve, 50));
    r.chat('recovery-1', r.runId, 'delta', 'first ');
    r.chat('recovery-2', 'recovery-1', 'delta', 'second');
    await expect.poll(() => r.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').length).toBe(2);
    r.cancel();
    await expect(r.outcome).resolves.toEqual({ result: { stopReason: 'cancelled' } });
    await expect.poll(() => r.requests.find((q) => q.method === 'chat.abort')?.params.runId).toBe('recovery-2');
  }, 20_000);

  it('reconciles an already-finished recovered run even when its live events were missed', async () => {
    const r = await runtime();
    await new Promise((resolve) => setTimeout(resolve, 50));
    r.disconnect();
    r.setWaitResult({ runId: 'finished-recovery', resumedFromRunId: r.runId, status: 'ok', terminalReply: { disposition: 'visible', text: 'durable recovered reply' } });
    r.reconnect();
    await expect(r.outcome).resolves.toEqual({ result: { stopReason: 'end_turn' } });
    expect(r.requests).toContainEqual(expect.objectContaining({ method: 'agent.wait', params: expect.objectContaining({ sessionKey }) }));
    expect(r.updates).toContainEqual(expect.objectContaining({ content: { type: 'text', text: 'durable recovered reply' } }));
  }, 20_000);

  it('ignores an old agent.wait response after a successor has been adopted', async () => {
    const r = await runtime();
    await new Promise((resolve) => setTimeout(resolve, 50));
    r.holdWait();
    r.disconnect();
    r.reconnect();
    await expect.poll(() => r.requests.some((q) => q.method === 'agent.wait'), { timeout: 10_000 }).toBe(true);
    r.chat('successor', r.runId, 'delta', 'successor reply');
    await expect.poll(() => r.updates.some((u) => (u.content as Json)?.text === 'successor reply')).toBe(true);
    r.releaseWait();
    r.chat('successor', r.runId, 'final', 'successor reply');
    await expect(r.outcome).resolves.toEqual({ result: { stopReason: 'end_turn' } });
    expect(r.updates.some((u) => String((u.content as Json)?.text).includes('interruption'))).toBe(false);
  }, 20_000);

  it.each([{ acknowledge: false, grace: 480_000 }, { acknowledge: true, grace: 6_000 }])('expires disconnected prompts within their finite deadline: %j', async (options) => {
    const r = await runtime(options);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    r.disconnect();
    // ACP's SDK deliberately sanitizes internal errors in JSON-RPC responses.
    await expect(r.outcome).resolves.toEqual({ error: 'Internal error' });
    expect(r.updates).toContainEqual(expect.objectContaining({ content: {
      type: 'text', text: expect.stringContaining(options.acknowledge ? 'after accepting' : 'before OpenClaw could confirm'),
    } }));
    expect(Date.now() - started).toBeLessThan(9_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(options.acknowledge ? 5_900 : 4_900);
  }, 20_000);
});
