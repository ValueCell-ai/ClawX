// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  CcConnectBridgeAdapter,
  ccConnectProjectNameForSessionKey,
  toCcConnectBridgeSessionKey,
} from '@electron/runtime/cc-connect-bridge-adapter';

describe('cc-connect bridge adapter persisted sessions', () => {
  let tempDir: string;
  let sessionStoreDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-bridge-adapter-'));
    sessionStoreDir = join(tempDir, 'data', 'sessions');
    await mkdir(sessionStoreDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('only maps ClawX agent sessions to bridge session keys', () => {
    expect(toCcConnectBridgeSessionKey('agent:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('agent:research:desk')).toBe('clawx:research:desk');
    expect(toCcConnectBridgeSessionKey('clawx:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('feishu:chat-1:user-1')).toBe('feishu:chat-1:user-1');
    expect(ccConnectProjectNameForSessionKey('agent:research:desk')).toBe('clawx-research');
    expect(ccConnectProjectNameForSessionKey('feishu:chat-1:user-1')).toBe('clawx-main');
  });

  it('routes app sends to the selected agent project and mirrors OpenClaw stream events', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const received: Record<string, unknown>[] = [];

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        received.push(parsed);
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type === 'message') {
          socket.send(JSON.stringify({
            type: 'reply_stream',
            reply_ctx: parsed.reply_ctx,
            delta: 'pong',
            done: false,
          }));
          socket.send(JSON.stringify({
            type: 'reply_stream',
            reply_ctx: parsed.reply_ctx,
            full_text: 'pong',
            done: true,
          }));
        }
      });
    });

    try {
      const adapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        projectForSessionKey: ccConnectProjectNameForSessionKey,
        emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
        sessionStoreDir,
      });

      await expect(adapter.send({
        sessionKey: 'agent:research:desk',
        message: 'ping',
        idempotencyKey: 'idem-1',
      })).resolves.toEqual(expect.objectContaining({ runId: expect.stringMatching(/^cc-connect-/) }));

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            sessionKey: 'agent:research:desk',
            delta: 'pong',
          })],
          ['chat:message', expect.objectContaining({
            sessionKey: 'agent:research:desk',
            message: expect.objectContaining({ role: 'assistant', content: 'pong' }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            sessionKey: 'agent:research:desk',
            status: 'completed',
          })],
        ]));
      });

      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          session_key: 'clawx:research:desk',
          project: 'clawx-research',
        }),
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maps bridge replies without reply_ctx back to the pending app run', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type === 'message') {
          socket.send(JSON.stringify({
            type: 'reply',
            session_key: parsed.session_key,
            content: 'pong without ctx',
          }));
        }
      });
    });

    try {
      const adapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
        sessionStoreDir,
      });

      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'ping',
        idempotencyKey: 'idem-no-ctx',
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:message', expect.objectContaining({
            runId: result.runId,
            sessionKey: 'agent:main:main',
            message: expect.objectContaining({ role: 'assistant', content: 'pong without ctx' }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            status: 'completed',
          })],
        ]));
      });
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('ends pending app runs when cc-connect only persists the assistant response to history', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
        }
      });
    });

    try {
      const adapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
        sessionStoreDir,
      });

      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'persisted ping',
        idempotencyKey: 'idem-history',
      });
      const completionTimestamp = Date.now() + 1_000;
      await writeFile(join(sessionStoreDir, 'clawx-main_history.json'), JSON.stringify({
        sessions: {
          s1: {
            id: 's1',
            history: [
              { id: 'u1', role: 'user', content: 'persisted ping', timestamp: completionTimestamp - 500 },
              { id: 'a1', role: 'assistant', content: 'persisted pong', timestamp: completionTimestamp },
            ],
            updated_at: completionTimestamp,
          },
        },
        active_session: {
          'clawx:main:main': 's1',
        },
      }), 'utf8');

      await adapter.reconcilePendingRunsFromHistory();

      expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: result.runId,
          sessionKey: 'agent:main:main',
          status: 'completed',
        })],
      ]));
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: result.runId,
          message: expect.objectContaining({ content: 'persisted pong' }),
        })],
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('lists and reads cc-connect channel sessions from the persisted session store', async () => {
    await writeFile(join(sessionStoreDir, 'clawx-main_abc.json'), JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          name: 'Feishu DM',
          agent_session_id: 'codex-old-session',
          agent_type: 'codex',
          history: [
            { role: 'user', content: '你在吗', timestamp: 1_780_900_000_000 },
            { role: 'assistant', content: '在。有什么需要我处理？', timestamp: 1_780_900_001_000 },
          ],
          created_at: 1_780_900_000_000,
          updated_at: 1_780_900_001_000,
        },
        s2: {
          id: 's2',
          name: 'ClawX Main',
          agent_type: 'codex',
          history: [
            { role: 'user', content: 'hello from app', timestamp: 1_780_800_000_000 },
          ],
          created_at: 1_780_800_000_000,
          updated_at: 1_780_800_000_000,
        },
      },
      active_session: {
        'feishu:oc_chat:ou_user': 's1',
        'clawx:research:desk': 's2',
      },
      user_meta: {
        'feishu:oc_chat:ou_user': {
          chat_name: '网关',
          user_name: 'channel-user',
        },
      },
    }), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toMatchObject([
      {
        key: 'feishu:oc_chat:ou_user',
        displayName: '网关 / channel-user',
        updatedAt: 1_780_900_001_000,
      },
      {
        key: 'agent:research:desk',
        displayName: 'hello from app',
        updatedAt: 1_780_800_000_000,
      },
    ]);
    await expect(adapter.loadHistory('feishu:oc_chat:ou_user')).resolves.toMatchObject([
      { role: 'user', content: '你在吗' },
      { role: 'assistant', content: '在。有什么需要我处理？' },
    ]);
    await expect(adapter.loadHistory('agent:research:desk')).resolves.toMatchObject([
      { role: 'user', content: 'hello from app' },
    ]);
    await expect(adapter.summarizeSessions(['feishu:oc_chat:ou_user', 'agent:research:desk'])).resolves.toEqual([
      {
        sessionKey: 'feishu:oc_chat:ou_user',
        firstUserText: '你在吗',
        lastTimestamp: 1_780_900_001_000,
      },
      {
        sessionKey: 'agent:research:desk',
        firstUserText: 'hello from app',
        lastTimestamp: 1_780_800_000_000,
      },
    ]);
  });

  it('falls back to Codex transcripts when cc-connect channel sessions have no stored history', async () => {
    const codexHomeDir = join(tempDir, 'codex-home');
    const configPath = join(tempDir, 'config.toml');
    const transcriptDir = join(codexHomeDir, 'sessions', '2026', '06', '09');
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(configPath, [
      '[[projects]]',
      'name = "clawx-coder"',
      '[projects.agent.options]',
      'work_dir = "/tmp/workspace-coder"',
      '',
      '[[projects]]',
      'name = "clawx-project-manager"',
      '[projects.agent.options]',
      'work_dir = "/tmp/workspace-project-manager"',
      '',
    ].join('\n'), 'utf8');
    const startedAt = '2026-06-09T12:38:51.848Z';
    const channelUpdatedAt = '2026-06-09T20:38:51.331+08:00';
    await writeFile(join(sessionStoreDir, 'clawx-coder_abcdef12.json'), JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          name: 'default',
          agent_session_id: '',
          history: null,
          created_at: channelUpdatedAt,
          updated_at: channelUpdatedAt,
        },
      },
      active_session: {
        'feishu:chat-1:user-1': 's1',
      },
    }), 'utf8');
    await writeFile(join(transcriptDir, 'rollout-2026-06-09T20-38-51-test.jsonl'), [
      JSON.stringify({
        timestamp: startedAt,
        type: 'session_meta',
        payload: { id: 'transcript-1', timestamp: startedAt, cwd: '/tmp/workspace-coder' },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:52.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md bootstrap text' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:52.100Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-1' },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:53.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'channel hello' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:54.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'channel ack' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:55.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          call_id: 'call-1',
          arguments: '{"cmd":"pwd"}',
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:56.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'ok',
        },
      }),
    ].join('\n'), 'utf8');
    await writeFile(join(transcriptDir, 'rollout-2026-06-09T20-38-51-wrong-agent.jsonl'), [
      JSON.stringify({
        timestamp: startedAt,
        type: 'session_meta',
        payload: { id: 'transcript-wrong', timestamp: startedAt, cwd: '/tmp/workspace-project-manager' },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:52.100Z',
        type: 'turn_context',
        payload: { turn_id: 'turn-wrong' },
      }),
      JSON.stringify({
        timestamp: '2026-06-09T12:38:53.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'wrong agent hello' }],
        },
      }),
    ].join('\n'), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
      codexHomeDir,
      configPath,
    });

    await expect(adapter.listSessions()).resolves.toMatchObject([{
      key: 'feishu:chat-1:user-1',
      agentId: 'coder',
      displayName: 'channel hello',
      updatedAt: Date.parse('2026-06-09T12:38:56.000Z'),
    }]);
    await expect(adapter.loadHistory('feishu:chat-1:user-1')).resolves.toMatchObject([
      { role: 'user', content: 'channel hello' },
      { role: 'assistant', content: 'channel ack' },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'call-1',
          name: 'exec_command',
          input: { cmd: 'pwd' },
        }],
      },
      { role: 'toolresult', toolCallId: 'call-1', content: 'ok' },
    ]);
    await expect(adapter.summarizeSessions(['feishu:chat-1:user-1'])).resolves.toEqual([{
      sessionKey: 'feishu:chat-1:user-1',
      firstUserText: 'channel hello',
      lastTimestamp: Date.parse('2026-06-09T12:38:56.000Z'),
    }]);
  });

  it('deletes persisted channel sessions without dropping unrelated sessions', async () => {
    const storePath = join(sessionStoreDir, 'clawx-main_abc.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        s1: { id: 's1', history: [{ role: 'user', content: 'channel' }], updated_at: 10 },
        s2: { id: 's2', agent_session_id: 'keep-agent-session', history: [{ role: 'user', content: 'app' }], updated_at: 20 },
      },
      active_session: {
        'feishu:oc_chat:ou_user': 's1',
        'clawx:main:main': 's2',
      },
      user_sessions: {
        'feishu:oc_chat:ou_user': ['s1'],
        'clawx:main:main': ['s2'],
      },
      user_meta: {
        'feishu:oc_chat:ou_user': { chat_name: '网关' },
      },
    }), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await adapter.deleteSession('feishu:oc_chat:ou_user');

    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, unknown>;
      active_session: Record<string, unknown>;
      user_sessions: Record<string, unknown>;
      user_meta: Record<string, unknown>;
    };
    expect(stored.sessions.s1).toBeUndefined();
    expect(stored.sessions.s2).toMatchObject({ agent_session_id: 'keep-agent-session', updated_at: 20 });
    expect(stored.active_session['feishu:oc_chat:ou_user']).toBeUndefined();
    expect(stored.active_session['clawx:main:main']).toBe('s2');
    expect(stored.user_sessions['feishu:oc_chat:ou_user']).toBeUndefined();
    expect(stored.user_meta['feishu:oc_chat:ou_user']).toBeUndefined();
  });
});
