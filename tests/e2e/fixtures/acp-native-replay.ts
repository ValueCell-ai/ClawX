import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { WebSocketServer } from 'ws';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { AcpSessionUpdateEnvelope } from '../../../shared/acp-chat/types';

type Json = Record<string, unknown>;

export const NATIVE_REPLAY_SESSION_KEY = 'agent:main:main';
export const NATIVE_REPLAY_TEXT = {
  request: 'Create the report and verify the command result.',
  recovery: 'Continue the current task from the existing transcript, preserving completed work. If an action was interrupted, inspect its state before deciding whether to retry it. Do not restart the task or repeat completed actions.',
  exec: 'Exec failed (fixture-process, code 0)\n\nThe command was terminated, but external side effects may already have completed. Verify the resulting state before retrying.',
  cron: '[cron:fixture-job] Inspect the report\n\nThis is an unattended scheduled run. Nobody is present to clarify or approve, so complete the task with what you have.',
  hidden: 'INTERNAL_DISPLAY_FALSE_FIXTURE',
  hiddenOutput: 'INTERNAL_HIDDEN_CAPTION\nMEDIA:/tmp/internal-report.pdf',
  thought: 'Inspect the existing command state before continuing.',
  toolOutput: 'Command timed out; its output remains available for inspection.',
  reply: 'The report is ready and the completed command was not repeated.',
  explanation: 'The quoted instruction tells the runtime to resume its existing work.',
} as const;

export const NATIVE_REPLAY_QUOTED_REQUEST = `Explain this quoted instruction:\n\n${NATIVE_REPLAY_TEXT.recovery}`;

export const NATIVE_MULTI_STAGE = {
  request: '请先思考一会儿，然后讲一个 200 字的故事，然后看看当前目录有什么文件，然后再讲个 100 字的故事',
  first: '第一个故事：钟又响了。钟声重复，钟声重复，小女孩终于找到了回家的路。',
  second: '第二个故事：雨停以后，小猫叼着一片落叶，走进温暖的灯光里。',
} as const;

/** Synthetic native transcript records, not prefiltered ACP updates. */
export function nativeReplayMessages(): Json[] {
  const text = (value: string) => [{ type: 'text', text: value }];
  const at = Date.now();
  return [
    { role: 'user', content: text(NATIVE_REPLAY_TEXT.request) },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: NATIVE_REPLAY_TEXT.thought },
      { type: 'toolCall', id: 'fixture-command', name: 'exec', arguments: { command: 'inspect-report-state' } },
    ], stopReason: 'toolUse' },
    { role: 'toolResult', toolCallId: 'fixture-command', content: text(NATIVE_REPLAY_TEXT.toolOutput), isError: true },
    { role: 'user', content: text(NATIVE_REPLAY_TEXT.exec), inputProvenance: { kind: 'internal_system' } },
    { role: 'user', content: text(NATIVE_REPLAY_TEXT.recovery), provenance: { kind: 'internal_system' } },
    { role: 'user', content: text(NATIVE_REPLAY_TEXT.cron), provenance: { kind: 'internal_system' } },
    { role: 'user', content: text(NATIVE_REPLAY_TEXT.hidden), display: false },
    { role: 'assistant', content: text(NATIVE_REPLAY_TEXT.hiddenOutput), display: false },
    { role: 'assistant', content: text(NATIVE_REPLAY_TEXT.reply), stopReason: 'stop' },
    { role: 'user', content: text(NATIVE_REPLAY_QUOTED_REQUEST) },
    { role: 'assistant', content: text(NATIVE_REPLAY_TEXT.explanation), stopReason: 'stop' },
  ].map((message, index) => ({
    ...message,
    timestamp: at + index,
    __openclaw: { id: `fixture-record-${index}`, recordTimestampMs: at + index },
  }));
}

/**
 * Run installed OpenClaw's real ACP session/load against an isolated loopback
 * Gateway. There is deliberately no pre-existing ACP ledger, so the native
 * transcript fallback must enforce visibility before Renderer sees any update.
 */
export async function collectNativeReplay(
  homeDir: string,
  messages: Json[],
): Promise<AcpSessionUpdateEnvelope[]> {
  return (await collectNativeSession(homeDir, messages)).replay;
}

/** Observed Gateway v4 producer frames, projected and persisted by real ACP. */
export async function collectNativeMultiStageTurn(homeDir: string) {
  const frames: Array<{ event: string; payload: Json }> = [];
  const delta = (text: string) => {
    frames.push(
      { event: 'chat', payload: { state: 'delta', deltaText: text.slice(0, 4), replace: true,
        message: { role: 'assistant', content: [{ type: 'text', text: text.slice(0, 4) }] } } },
      { event: 'chat', payload: { state: 'delta', deltaText: text.slice(4) } },
      { event: 'chat', payload: { state: 'delta', deltaText: '', replace: true,
        message: { role: 'assistant', content: [] } } },
    );
  };
  delta(NATIVE_MULTI_STAGE.first);
  frames.push(
    { event: 'session.tool', payload: { stream: 'tool', data: {
      phase: 'start', toolCallId: 'list-directory', name: 'exec', args: { command: 'ls' },
    } } },
    { event: 'session.tool', payload: { stream: 'tool', data: {
      phase: 'result', toolCallId: 'list-directory', name: 'exec', result: 'report.txt',
    } } },
  );
  delta(NATIVE_MULTI_STAGE.second);
  frames.push({ event: 'chat', payload: { state: 'final', message: {
    role: 'assistant', content: [{ type: 'text', text: `${NATIVE_MULTI_STAGE.first}\n\n${NATIVE_MULTI_STAGE.second}` }],
  } } });
  return collectNativeSession(homeDir, [], { prompt: NATIVE_MULTI_STAGE.request, frames });
}

async function collectNativeSession(
  homeDir: string,
  messages: Json[],
  turn?: { prompt: string; frames: Array<{ event: string; payload: Json }> },
): Promise<{ live: AcpSessionUpdateEnvelope[]; replay: AcpSessionUpdateEnvelope[] }> {
  await mkdir(homeDir, { recursive: true });
  const nativeHome = await mkdtemp(path.join(homeDir, 'acp-native-replay-'));
  const configPath = path.join(nativeHome, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({ gateway: { mode: 'local' } }));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let child: ChildProcessWithoutNullStreams | undefined;
  let diagnostics = '';
  const pending = new Map<number, { resolve(value: Json): void; reject(error: Error): void }>();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture', ts: Date.now() } }));
      socket.on('message', (raw) => {
        const request = JSON.parse(String(raw)) as { id: string; method: string; params?: Json };
        let payload: unknown = {};
        if (request.method === 'connect') {
          payload = { type: 'hello-ok', protocol: 3, server: { version: 'fixture', connId: 'native-replay' }, features: { methods: [], events: [] }, snapshot: {}, policy: { tickIntervalMs: 60_000 } };
        } else if (request.method === 'sessions.resolve') {
          payload = { key: NATIVE_REPLAY_SESSION_KEY };
        } else if (request.method === 'sessions.list') {
          payload = { sessions: [{ key: NATIVE_REPLAY_SESSION_KEY, sessionId: 'native-replay-fixture', displayName: 'main' }] };
        } else if (request.method === 'sessions.get') {
          payload = { messages };
        } else if (request.method === 'chat.send') {
          payload = { runId: request.params?.idempotencyKey, status: 'started' };
        }
        socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload }));
        if (request.method === 'chat.send' && turn) {
          for (const [index, frame] of turn.frames.entries()) socket.send(JSON.stringify({
            type: 'event', event: frame.event, payload: {
              sessionKey: NATIVE_REPLAY_SESSION_KEY, runId: request.params?.idempotencyKey,
              seq: index + 1, ...frame.payload,
            },
          }));
        }
      });
    });

    const port = (server.address() as { port: number }).port;
    child = spawn(process.execPath, [path.resolve('node_modules/openclaw/openclaw.mjs'), 'acp', '--url', `ws://127.0.0.1:${port}`, '--token', 'fixture'], {
      env: {
        ...process.env,
        HOME: nativeHome,
        USERPROFILE: nativeHome,
        OPENCLAW_STATE_DIR: nativeHome,
        OPENCLAW_CONFIG_PATH: configPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', (data) => { diagnostics = (diagnostics + String(data)).slice(-16_000); });
    const updates: SessionNotification[] = [];
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.startsWith('{')) return;
      const message = JSON.parse(line) as { id?: number; method?: string; params?: SessionNotification; result?: Json; error?: { message?: string } };
      if (message.method === 'session/update' && message.params) updates.push(message.params);
      if (message.id === undefined) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'ACP request failed'));
      else waiter.resolve(message.result ?? {});
    });
    const rejectPending = (error: Error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    };
    child.on('error', rejectPending);
    child.on('exit', (code) => rejectPending(new Error(`Native ACP exited (${String(code)}): ${diagnostics}`)));
    let requestId = 0;
    const call = (method: string, params: Json) => new Promise<Json>((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${diagnostics}`));
      }, 20_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    await call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const session = turn
      ? await call('session/new', { cwd: nativeHome, mcpServers: [], _meta: { sessionKey: NATIVE_REPLAY_SESSION_KEY } })
      : await call('session/load', { sessionId: NATIVE_REPLAY_SESSION_KEY, cwd: nativeHome, mcpServers: [] });
    const envelope = (notifications: SessionNotification[], historical: boolean): AcpSessionUpdateEnvelope[] => notifications.map((notification) => ({
      sessionKey: NATIVE_REPLAY_SESSION_KEY,
      generation: 1,
      historical,
      notification: { ...notification, sessionId: NATIVE_REPLAY_SESSION_KEY },
    }));
    const liveStart = updates.length;
    if (!turn) return { live: [], replay: envelope(updates, true) };
    await call('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: turn.prompt }] });
    const live = envelope(updates.slice(liveStart), false);
    const replayStart = updates.length;
    await call('session/load', { sessionId: NATIVE_REPLAY_SESSION_KEY, cwd: nativeHome, mcpServers: [] });
    return { live, replay: envelope(updates.slice(replayStart), true) };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
    }
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
