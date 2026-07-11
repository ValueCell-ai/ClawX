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

const electronMockState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => electronMockState.userData),
  },
}));

describe('cc-connect bridge adapter persisted sessions', () => {
  let tempDir: string;
  let sessionStoreDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-bridge-adapter-'));
    electronMockState.userData = join(tempDir, 'userData');
    sessionStoreDir = join(tempDir, 'data', 'sessions');
    await mkdir(sessionStoreDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('only maps ClawX agent sessions to bridge session keys', () => {
    expect(toCcConnectBridgeSessionKey('agent:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('agent:research:desk')).toBe('clawx:research:desk');
    expect(toCcConnectBridgeSessionKey('agent:main:cron:job-123')).toBe('clawx:main:cron:job-123');
    expect(toCcConnectBridgeSessionKey('clawx:main:main')).toBe('clawx:main:main');
    expect(toCcConnectBridgeSessionKey('feishu:chat-1:user-1')).toBe('feishu:chat-1:user-1');
    expect(ccConnectProjectNameForSessionKey('agent:research:desk')).toBe('clawx-research');
    expect(ccConnectProjectNameForSessionKey('agent:research:cron:job-123')).toBe('clawx-research');
    expect(ccConnectProjectNameForSessionKey('feishu:chat-1:user-1')).toBe('clawx-main');
  });

  it('preserves OpenClaw-compatible cron session keys across cc-connect store operations', async () => {
    const storePath = join(sessionStoreDir, 'clawx-main_cron.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        'cron:job-123': {
          id: 'cron:job-123',
          name: 'Daily cron run',
          history: [
            { id: 'u-cron', role: 'user', content: 'cron prompt', timestamp: 1000 },
            { id: 'a-cron', role: 'assistant', content: 'cron result', timestamp: 1100 },
          ],
          updated_at: 1100,
        },
      },
      active_session: {
        'clawx:main:cron:job-123': 'cron:job-123',
      },
      user_sessions: {
        'clawx:main:cron:job-123': ['cron:job-123'],
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'agent:main:cron:job-123',
        displayName: 'Daily cron run',
      }),
    ]));
    await expect(adapter.loadHistory('agent:main:cron:job-123', 10)).resolves.toEqual([
      expect.objectContaining({ id: 'u-cron', content: 'cron prompt' }),
      expect.objectContaining({ id: 'a-cron', content: 'cron result' }),
    ]);

    await adapter.deleteSession('agent:main:cron:job-123');
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, unknown>;
      active_session: Record<string, string>;
      user_sessions: Record<string, string[]>;
    };
    expect(stored.sessions).toEqual({});
    expect(stored.active_session).toEqual({});
    expect(stored.user_sessions).toEqual({});
  });

  it('merges history for the same session key across cc-connect session stores', async () => {
    await writeFile(join(sessionStoreDir, 'clawx-main_old.json'), JSON.stringify({
      sessions: {
        old: {
          id: 'old',
          name: 'Older named session',
          history: [
            { id: 'u-old', role: 'user', content: 'old question', timestamp: 1000 },
            { id: 'a-old', role: 'assistant', content: 'old answer', timestamp: 1100 },
          ],
          updated_at: 1100,
        },
      },
      active_session: {
        'clawx:main:main': 'old',
      },
      user_sessions: {
        'clawx:main:main': ['old'],
      },
    }), 'utf8');
    await writeFile(join(sessionStoreDir, 'clawx-main_new.json'), JSON.stringify({
      sessions: {
        newer: {
          id: 'newer',
          name: 'Newer named session',
          history: [
            { id: 'u-new', role: 'user', content: 'new question', timestamp: 2000 },
            { id: 'a-new', role: 'assistant', content: 'new answer', timestamp: 2100 },
          ],
          updated_at: 2100,
        },
      },
      active_session: {
        'clawx:main:main': 'newer',
      },
      user_sessions: {
        'clawx:main:main': ['newer'],
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.loadHistory('agent:main:main', 10)).resolves.toEqual([
      expect.objectContaining({ id: 'u-old', content: 'old question' }),
      expect.objectContaining({ id: 'a-old', content: 'old answer' }),
      expect.objectContaining({ id: 'u-new', content: 'new question' }),
      expect.objectContaining({ id: 'a-new', content: 'new answer' }),
    ]);
    await expect(adapter.loadHistory('clawx:main:main', 2)).resolves.toEqual([
      expect.objectContaining({ id: 'u-new' }),
      expect.objectContaining({ id: 'a-new' }),
    ]);
  });

  it('deletes active and named cc-connect sessions for the same session key', async () => {
    const storePath = join(sessionStoreDir, 'clawx-main_named.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        active: {
          id: 'active',
          history: [{ id: 'u-active', role: 'user', content: 'active question', timestamp: 1000 }],
          updated_at: 1000,
        },
        named: {
          id: 'named',
          name: 'Named chat',
          history: [{ id: 'u-named', role: 'user', content: 'named question', timestamp: 2000 }],
          updated_at: 2000,
        },
        unrelated: {
          id: 'unrelated',
          history: [{ id: 'u-other', role: 'user', content: 'other question', timestamp: 3000 }],
          updated_at: 3000,
        },
      },
      active_session: {
        'clawx:main:main': 'active',
        'clawx:research:main': 'unrelated',
      },
      user_sessions: {
        'clawx:main:main': ['active', 'named'],
        'clawx:research:main': ['unrelated'],
      },
      user_meta: {
        'clawx:main:main': { chat_name: 'Main chat' },
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await adapter.deleteSession('agent:main:main');

    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, unknown>;
      active_session: Record<string, string>;
      user_sessions: Record<string, string[]>;
      user_meta: Record<string, unknown>;
    };
    expect(stored.sessions).toEqual({
      unrelated: expect.any(Object),
    });
    expect(stored.active_session).toEqual({
      'clawx:research:main': 'unrelated',
    });
    expect(stored.user_sessions).toEqual({
      'clawx:research:main': ['unrelated'],
    });
    expect(stored.user_meta).toEqual({});
  });

  it('lists and loads named and orphan cc-connect sessions with stable agent session keys', async () => {
    const storePath = join(sessionStoreDir, 'clawx-research_1234abcd.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        active: {
          id: 'active',
          name: 'Active research',
          history: [
            { id: 'u-active', role: 'user', content: 'active question', timestamp: 1000 },
            { id: 'a-active', role: 'assistant', content: 'active answer', timestamp: 1100 },
          ],
          updated_at: 1100,
        },
        named: {
          id: 'named',
          name: 'Named research thread',
          history: [
            { id: 'u-named', role: 'user', content: 'named question', timestamp: 2000 },
            { id: 'a-named', role: 'assistant', content: 'named answer', timestamp: 2100 },
          ],
          updated_at: 2100,
        },
        orphan: {
          id: 'orphan',
          name: 'Orphan research thread',
          history: [
            { id: 'u-orphan', role: 'user', content: 'orphan question', timestamp: 3000 },
            { id: 'a-orphan', role: 'assistant', content: 'orphan answer', timestamp: 3100 },
          ],
          updated_at: 3100,
        },
      },
      active_session: {
        'clawx:research:main': 'active',
      },
      user_sessions: {
        'clawx:research:main': ['active', 'named'],
      },
      user_meta: {
        'clawx:research:main': {
          chat_name: 'Research active chat',
          user_name: 'desk',
        },
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-research',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toEqual([
      expect.objectContaining({
        key: 'agent:research:orphan',
        displayName: 'Orphan research thread',
        derivedTitle: 'Orphan research thread',
        agentId: 'research',
      }),
      expect.objectContaining({
        key: 'agent:research:named',
        displayName: 'Named research thread',
        derivedTitle: 'Named research thread',
        agentId: 'research',
      }),
      expect.objectContaining({
        key: 'agent:research:main',
        displayName: 'Research active chat / desk',
        derivedTitle: 'Active research',
        agentId: 'research',
      }),
    ]);
    await expect(adapter.loadHistory('agent:research:named', 10)).resolves.toEqual([
      expect.objectContaining({ id: 'u-named', content: 'named question' }),
      expect.objectContaining({ id: 'a-named', content: 'named answer' }),
    ]);
    await expect(adapter.loadHistory('agent:research:orphan', 10)).resolves.toEqual([
      expect.objectContaining({ id: 'u-orphan', content: 'orphan question' }),
      expect.objectContaining({ id: 'a-orphan', content: 'orphan answer' }),
    ]);

    await adapter.deleteSession('agent:research:named');

    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, unknown>;
      active_session: Record<string, string>;
      user_sessions: Record<string, string[]>;
    };
    expect(Object.keys(stored.sessions).sort()).toEqual(['active', 'orphan']);
    expect(stored.active_session).toEqual({ 'clawx:research:main': 'active' });
    expect(stored.user_sessions).toEqual({ 'clawx:research:main': ['active'] });
  });

  it('renames active and direct named cc-connect sessions without mutating unrelated session names', async () => {
    const storePath = join(sessionStoreDir, 'clawx-research_aabbccdd.json');
    await writeFile(storePath, JSON.stringify({
      sessions: {
        active: {
          id: 'active',
          name: 'Active research',
          history: [{ id: 'u-active', role: 'user', content: 'active question', timestamp: 1000 }],
          updated_at: 1000,
        },
        named: {
          id: 'named',
          name: 'Named research thread',
          history: [{ id: 'u-named', role: 'user', content: 'named question', timestamp: 2000 }],
          updated_at: 2000,
        },
      },
      active_session: {
        'clawx:research:main': 'active',
      },
      user_sessions: {
        'clawx:research:main': ['active', 'named'],
      },
      user_meta: {
        'clawx:research:main': {
          chat_name: 'Research active chat',
        },
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-research',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await adapter.renameSession('agent:research:main', 'Renamed active');
    let stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, { name?: string }>;
      user_meta: Record<string, { chat_name?: string }>;
    };
    expect(stored.sessions.active.name).toBe('Renamed active');
    expect(stored.sessions.named.name).toBe('Named research thread');
    expect(stored.user_meta['clawx:research:main']?.chat_name).toBe('Renamed active');

    await expect(adapter.listSessions()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'agent:research:main',
        displayName: 'Renamed active',
        derivedTitle: 'Renamed active',
      }),
      expect.objectContaining({
        key: 'agent:research:named',
        displayName: 'Named research thread',
        derivedTitle: 'Named research thread',
      }),
    ]));

    await adapter.renameSession('agent:research:named', 'Renamed named');
    stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      sessions: Record<string, { name?: string }>;
      user_meta: Record<string, { chat_name?: string }>;
    };
    expect(stored.sessions.active.name).toBe('Renamed active');
    expect(stored.sessions.named.name).toBe('Renamed named');
    expect(stored.user_meta['clawx:research:main']?.chat_name).toBe('Renamed active');
  });

  it('persists cc-connect rename labels for supplemental in-memory session history', async () => {
    await writeFile(join(sessionStoreDir, '.clawx-supplemental-history.json'), JSON.stringify({
      sessions: {
        'agent:main:local': [
          { id: 'u-local', role: 'user', content: 'local question', timestamp: 1000 },
          { id: 'a-local', role: 'assistant', content: 'local answer', timestamp: 1100 },
        ],
      },
    }), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await adapter.renameSession('agent:main:local', 'Local renamed title');

    await expect(adapter.listSessions()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'agent:main:local',
        displayName: 'Local renamed title',
        derivedTitle: 'Local renamed title',
      }),
    ]));
    await adapter.deleteSession('agent:main:local');
    const stored = JSON.parse(await readFile(join(sessionStoreDir, '.clawx-supplemental-history.json'), 'utf8')) as {
      labels?: Record<string, string>;
    };
    expect(stored.labels?.['agent:main:local']).toBeUndefined();
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
      await expect(adapter.listSessions()).resolves.toEqual([
        expect.objectContaining({
          key: 'agent:research:desk',
          agentId: 'research',
          derivedTitle: 'ping',
          lastMessagePreview: 'pong',
        }),
      ]);
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    {
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'screenshot.png',
      content: 'fake image bytes',
      expectedPreview: true,
    },
    {
      kind: 'file',
      mimeType: 'application/pdf',
      fileName: 'brief.pdf',
      content: 'fake pdf bytes',
      expectedPreview: false,
    },
    {
      kind: 'audio',
      mimeType: 'audio/mpeg',
      fileName: 'voice.mp3',
      content: 'fake audio bytes',
      expectedPreview: false,
    },
  ])('declares media capabilities and converts bridge $kind packets to attached files', async ({
    kind,
    mimeType,
    fileName,
    content,
    expectedPreview,
  }) => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const received: Record<string, unknown>[] = [];
    const mediaData = Buffer.from(content).toString('base64');

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
            type: kind,
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            data: mediaData,
            mime_type: mimeType,
            file_name: fileName,
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
        message: 'make image',
        idempotencyKey: 'idem-image',
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:message', expect.objectContaining({
            runId: result.runId,
            sessionKey: 'agent:main:main',
              message: expect.objectContaining({
                role: 'assistant',
                content: fileName,
                _attachedFiles: [
                  expect.objectContaining({
                    fileName,
                    mimeType,
                    fileSize: Buffer.byteLength(content),
                    preview: expectedPreview ? `data:${mimeType};base64,${mediaData}` : null,
                    source: 'gateway-media',
                  }),
                ],
            }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            status: 'completed',
          })],
        ]));
      });

      const register = received.find((message) => message.type === 'register');
      expect(register?.capabilities).toEqual(expect.arrayContaining(['image', 'file', 'audio']));
      const messageEvent = emitted.find(([event]) => event === 'chat:message')?.[1] as {
        message?: { _attachedFiles?: Array<{ filePath?: string }> };
      } | undefined;
      const filePath = messageEvent?.message?._attachedFiles?.[0]?.filePath;
      expect(filePath).toContain(join('runtimes', 'cc-connect', 'media', 'outgoing', 'bridge'));
      await expect(readFile(filePath || '', 'utf8')).resolves.toBe(content);
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('handles bridge rich packets without claiming unsupported upstream delivery parity', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const received: Record<string, unknown>[] = [];
    let messageCount = 0;

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        received.push(parsed);
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          socket.send(JSON.stringify({ type: 'preview_start', ref_id: 'preview-1' }));
          return;
        }
        if (parsed.type === 'message') {
          messageCount += 1;
          if (messageCount === 1) {
            socket.send(JSON.stringify({
              type: 'update_message',
              session_key: parsed.session_key,
              reply_ctx: parsed.reply_ctx,
              content: 'draft preview text',
            }));
            socket.send(JSON.stringify({
              type: 'typing_start',
              session_key: parsed.session_key,
              reply_ctx: parsed.reply_ctx,
            }));
            socket.send(JSON.stringify({
              type: 'delete_message',
              session_key: parsed.session_key,
              reply_ctx: parsed.reply_ctx,
              message_id: 'transient-message',
            }));
            socket.send(JSON.stringify({
              type: 'card',
              session_key: parsed.session_key,
              reply_ctx: parsed.reply_ctx,
              card: { title: 'Card title', body: 'Card body' },
            }));
            return;
          }
          socket.send(JSON.stringify({
            type: 'buttons',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            content: 'Choose an option',
            buttons: [{ text: 'Approve', value: 'approve' }],
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

      const cardRun = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'show card',
        idempotencyKey: 'idem-card',
      });
      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            runId: cardRun.runId,
            sessionKey: 'agent:main:main',
            text: 'draft preview text',
            replace: true,
          })],
          ['chat:message', expect.objectContaining({
            runId: cardRun.runId,
            sessionKey: 'agent:main:main',
            message: expect.objectContaining({
              role: 'assistant',
              content: JSON.stringify({ title: 'Card title', body: 'Card body' }),
            }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: cardRun.runId,
            status: 'completed',
          })],
        ]));
      });

      const buttonRun = await adapter.send({
        sessionKey: 'agent:main:buttons',
        message: 'show buttons',
        idempotencyKey: 'idem-buttons',
      });
      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:message', expect.objectContaining({
            runId: buttonRun.runId,
            sessionKey: 'agent:main:buttons',
            message: expect.objectContaining({
              role: 'assistant',
              content: 'Choose an option',
            }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: buttonRun.runId,
            sessionKey: 'agent:main:buttons',
            status: 'completed',
          })],
        ]));
      });

      const register = received.find((message) => message.type === 'register');
      expect(register?.capabilities).toEqual(expect.arrayContaining([
        'card',
        'buttons',
        'preview',
        'update_message',
        'delete_message',
      ]));
      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'preview_ack',
          ref_id: 'preview-1',
          preview_handle: 'preview-1',
        }),
      ]));
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: cardRun.runId,
          message: expect.objectContaining({ content: 'transient-message' }),
        })],
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maps bridge tool, command, and patch packets to runtime events and generated-file messages', async () => {
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
            type: 'tool_call',
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            tool_call_id: 'edit-1',
            name: 'Edit',
            arguments: {
              file_path: '/workspace/demo.ts',
              old_string: 'const value = 1\n',
              new_string: 'const value = 2\n',
            },
          }));
          socket.send(JSON.stringify({
            type: 'command_output',
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            tool_call_id: 'edit-1',
            item_id: 'cmd-1',
            title: 'apply edit',
            output: 'patched /workspace/demo.ts',
            status: 'running',
            cwd: '/workspace',
          }));
          socket.send(JSON.stringify({
            type: 'patch_completed',
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            tool_call_id: 'edit-1',
            item_id: 'patch-1',
            title: 'demo.ts',
            summary: '1 file changed',
            added: 1,
            modified: 1,
          }));
          socket.send(JSON.stringify({
            type: 'tool_result',
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            tool_call_id: 'edit-1',
            name: 'Edit',
            result: 'ok',
          }));
          socket.send(JSON.stringify({
            type: 'reply',
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            content: 'done',
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
        message: 'edit demo.ts',
        idempotencyKey: 'idem-tools',
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'tool.started',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            toolCallId: 'edit-1',
            name: 'Edit',
            args: expect.objectContaining({ file_path: '/workspace/demo.ts' }),
          })],
          ['chat:message', expect.objectContaining({
            runId: result.runId,
            sessionKey: 'agent:main:main',
            message: expect.objectContaining({
              role: 'assistant',
              content: [expect.objectContaining({
                type: 'toolCall',
                id: 'edit-1',
                name: 'Edit',
                arguments: expect.objectContaining({
                  file_path: '/workspace/demo.ts',
                  old_string: 'const value = 1\n',
                  new_string: 'const value = 2\n',
                }),
              })],
            }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'command.output',
            runId: result.runId,
            toolCallId: 'edit-1',
            itemId: 'cmd-1',
            output: 'patched /workspace/demo.ts',
            cwd: '/workspace',
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'patch.completed',
            runId: result.runId,
            toolCallId: 'edit-1',
            itemId: 'patch-1',
            summary: '1 file changed',
            added: 1,
            modified: 1,
            deleted: 0,
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'tool.completed',
            runId: result.runId,
            toolCallId: 'edit-1',
            result: 'ok',
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            status: 'completed',
          })],
        ]));
      });

      const register = received.find((message) => message.type === 'register');
      expect(register?.capabilities).toEqual(expect.arrayContaining(['tool_events', 'command_output', 'patch_events']));
      await expect(adapter.loadHistory('agent:main:main')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: [expect.objectContaining({
            type: 'toolCall',
            id: 'edit-1',
            name: 'Edit',
            arguments: expect.objectContaining({ file_path: '/workspace/demo.ts' }),
          })],
        }),
        expect.objectContaining({ role: 'assistant', content: 'done' }),
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

  it('aborts pending app runs and ignores late bridge replies', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    let capturedReplyCtx = '';

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type === 'message') {
          capturedReplyCtx = String(parsed.reply_ctx || '');
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
        message: 'slow ping',
        idempotencyKey: 'idem-abort',
      });
      await vi.waitFor(() => expect(capturedReplyCtx).toBe(result.runId));

      await expect(adapter.abort({ sessionKey: 'agent:main:main' })).resolves.toEqual({
        success: true,
        abortedRuns: [result.runId],
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            status: 'aborted',
            stopReason: 'user',
          })],
        ]));
      });

      const socket = Array.from(server.clients)[0];
      socket.send(JSON.stringify({
        type: 'reply',
        reply_ctx: result.runId,
        session_key: 'clawx:main:main',
        content: 'late pong',
      }));

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: result.runId,
          message: expect.objectContaining({ content: 'late pong' }),
        })],
      ]));
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

  it('mirrors Codex transcript function calls into runtime tool events while a bridge run is pending', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const codexSessionsDir = join(tempDir, 'codex-home', 'sessions');

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
        codexSessionsDir,
      });

      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'show .agents skills',
        idempotencyKey: 'idem-codex-transcript',
      });
      const transcriptDir = join(codexSessionsDir, '2026', '06', '20');
      await mkdir(transcriptDir, { recursive: true });
      const ts = new Date().toISOString();
      await writeFile(join(transcriptDir, 'rollout-test.jsonl'), [
        JSON.stringify({
          timestamp: ts,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'show .agents skills' },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: 'call-list-skills',
            arguments: JSON.stringify({ cmd: 'find .agents/skills -maxdepth 3 -print | sort', workdir: '/workspace' }),
          },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-list-skills',
            output: [
              'Chunk ID: abc123',
              'Wall time: 0.0000 seconds',
              'Process exited with code 0',
              'Original token count: 2',
              'Output:',
              '.agents/skills',
              '.agents/skills/bytedcli',
              '',
            ].join('\n'),
          },
        }),
      ].join('\n'), 'utf8');

      await adapter.reconcilePendingRunsFromHistory();
      await adapter.reconcilePendingRunsFromHistory();

      expect(emitted).toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          state: 'final',
          runId: result.runId,
          sessionKey: 'agent:main:main',
          message: expect.objectContaining({
            id: `${result.runId}:call-list-skills:codex-tool`,
            role: 'assistant',
            content: [expect.objectContaining({
              type: 'toolCall',
              id: 'call-list-skills',
              name: 'Bash',
            })],
          }),
        })],
        ['chat:message', expect.objectContaining({
          state: 'final',
          runId: result.runId,
          sessionKey: 'agent:main:main',
          message: expect.objectContaining({
            id: `${result.runId}:call-list-skills:codex-result`,
            role: 'toolresult',
            toolCallId: 'call-list-skills',
            toolName: 'Bash',
          }),
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.started',
          runId: result.runId,
          sessionKey: 'agent:main:main',
          toolCallId: 'call-list-skills',
          name: 'Bash',
          args: '$ find .agents/skills -maxdepth 3 -print | sort',
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.completed',
          runId: result.runId,
          sessionKey: 'agent:main:main',
          toolCallId: 'call-list-skills',
          name: 'Bash',
        })],
      ]));
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.completed',
          toolCallId: 'call-list-skills',
          result: expect.anything(),
        })],
      ]));
      expect(emitted.filter(([, payload]) => (
        typeof payload === 'object'
        && payload !== null
        && (payload as { type?: string; toolCallId?: string }).type === 'tool.started'
        && (payload as { type?: string; toolCallId?: string }).toolCallId === 'call-list-skills'
      ))).toHaveLength(1);
      await expect(adapter.loadHistory('agent:main:main')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: `${result.runId}:call-list-skills:codex-tool`,
          role: 'assistant',
          content: [expect.objectContaining({
            type: 'toolCall',
            id: 'call-list-skills',
            name: 'Bash',
            arguments: '$ find .agents/skills -maxdepth 3 -print | sort',
          })],
          stopReason: 'tool_use',
        }),
        expect.objectContaining({
          id: `${result.runId}:call-list-skills:codex-result`,
          role: 'toolresult',
          toolCallId: 'call-list-skills',
          toolName: 'Bash',
          content: '.agents/skills\n.agents/skills/bytedcli',
        }),
      ]));

      const reloadedAdapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        emit: vi.fn(),
        sessionStoreDir,
        codexSessionsDir,
      });
      await expect(reloadedAdapter.loadHistory('agent:main:main')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: `${result.runId}:call-list-skills:codex-tool`,
          role: 'assistant',
        }),
        expect.objectContaining({
          id: `${result.runId}:call-list-skills:codex-result`,
          role: 'toolresult',
          content: '.agents/skills\n.agents/skills/bytedcli',
        }),
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('mirrors Codex custom_tool_call transcript events into supplemental history', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const codexSessionsDir = join(tempDir, 'codex-home', 'sessions');

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
        codexSessionsDir,
      });

      const result = await adapter.send({
        sessionKey: 'agent:research:tool-smoke',
        message: 'create a smoke file',
        idempotencyKey: 'idem-codex-custom-tool',
      });
      const transcriptDir = join(codexSessionsDir, '2026', '06', '22');
      await mkdir(transcriptDir, { recursive: true });
      const ts = new Date().toISOString();
      await writeFile(join(transcriptDir, 'rollout-custom-tool.jsonl'), [
        JSON.stringify({
          timestamp: ts,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'create a smoke file' },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            status: 'completed',
            call_id: 'call-apply-patch',
            name: 'apply_patch',
            input: [
              '*** Begin Patch',
              '*** Add File: clawx-real-tool-smoke.txt',
              '+CLAWX_REAL_TOOL_FILE_OK',
              '*** End Patch',
              '',
            ].join('\n'),
          },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'event_msg',
          payload: {
            type: 'patch_apply_end',
            call_id: 'call-apply-patch',
          },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call-apply-patch',
            output: [
              'Exit code: 0',
              'Wall time: 0.2 seconds',
              'Output:',
              'Success. Updated the following files:',
              'A clawx-real-tool-smoke.txt',
              '',
            ].join('\n'),
          },
        }),
      ].join('\n'), 'utf8');

      await adapter.reconcilePendingRunsFromHistory();

      expect(emitted).toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          state: 'final',
          runId: result.runId,
          sessionKey: 'agent:research:tool-smoke',
          message: expect.objectContaining({
            id: `${result.runId}:call-apply-patch:codex-tool`,
            role: 'assistant',
            content: [expect.objectContaining({
              type: 'toolCall',
              id: 'call-apply-patch',
              name: 'apply_patch',
            })],
          }),
        })],
        ['chat:message', expect.objectContaining({
          state: 'final',
          runId: result.runId,
          sessionKey: 'agent:research:tool-smoke',
          message: expect.objectContaining({
            id: `${result.runId}:call-apply-patch:codex-result`,
            role: 'toolresult',
            toolCallId: 'call-apply-patch',
            toolName: 'apply_patch',
          }),
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.started',
          runId: result.runId,
          sessionKey: 'agent:research:tool-smoke',
          toolCallId: 'call-apply-patch',
          name: 'apply_patch',
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.completed',
          runId: result.runId,
          sessionKey: 'agent:research:tool-smoke',
          toolCallId: 'call-apply-patch',
          name: 'apply_patch',
        })],
      ]));
      await expect(adapter.loadHistory('agent:research:tool-smoke')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: `${result.runId}:call-apply-patch:codex-tool`,
          role: 'assistant',
          content: [expect.objectContaining({
            type: 'toolCall',
            id: 'call-apply-patch',
            name: 'apply_patch',
          })],
          stopReason: 'tool_use',
        }),
        expect.objectContaining({
          id: `${result.runId}:call-apply-patch:codex-result`,
          role: 'toolresult',
          toolCallId: 'call-apply-patch',
          toolName: 'apply_patch',
          content: 'Success. Updated the following files:\nA clawx-real-tool-smoke.txt',
        }),
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('announces a session update when delayed Codex transcript backfill adds tool events after final', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const codexSessionsDir = join(tempDir, 'codex-home', 'sessions');

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
            reply_ctx: parsed.reply_ctx,
            session_key: parsed.session_key,
            content: 'delayed transcript done',
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
        codexSessionsDir,
      });

      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'delayed transcript tool',
        idempotencyKey: 'idem-delayed-codex-transcript',
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'run.ended',
            runId: result.runId,
            sessionKey: 'agent:main:main',
          })],
        ]));
      }, { timeout: 4_000 });

      const transcriptDir = join(codexSessionsDir, '2026', '06', '22');
      await mkdir(transcriptDir, { recursive: true });
      const ts = new Date().toISOString();
      await writeFile(join(transcriptDir, 'rollout-delayed-tool.jsonl'), [
        JSON.stringify({
          timestamp: ts,
          type: 'event_msg',
          payload: { type: 'user_message', message: 'delayed transcript tool' },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            call_id: 'call-delayed-patch',
            name: 'apply_patch',
            input: [
              '*** Begin Patch',
              '*** Add File: delayed-backfill.md',
              '+delayed backfill ok',
              '*** End Patch',
              '',
            ].join('\n'),
          },
        }),
        JSON.stringify({
          timestamp: ts,
          type: 'response_item',
          payload: {
            type: 'custom_tool_call_output',
            call_id: 'call-delayed-patch',
            output: 'Success. Updated the following files:\nA delayed-backfill.md',
          },
        }),
      ].join('\n'), 'utf8');

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:message', expect.objectContaining({
            runId: result.runId,
            sessionKey: 'agent:main:main',
            message: expect.objectContaining({
              id: `${result.runId}:call-delayed-patch:codex-tool`,
              role: 'assistant',
            }),
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'session.updated',
            runId: result.runId,
            sessionKey: 'agent:main:main',
            reason: 'codex-transcript-backfill',
          })],
        ]));
      }, { timeout: 4_000 });

      await expect(adapter.loadHistory('agent:main:main')).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: `${result.runId}:call-delayed-patch:codex-tool`,
          role: 'assistant',
        }),
        expect.objectContaining({
          id: `${result.runId}:call-delayed-patch:codex-result`,
          role: 'toolresult',
          toolCallId: 'call-delayed-patch',
        }),
      ]));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('syncs completed cc-connect sessions with managed Codex transcript tool calls', async () => {
    const emitted: Array<[string, unknown]> = [];
    const codexSessionsDir = join(tempDir, 'codex-home', 'sessions');
    const agentSessionId = '019f0992-491e-7eb0-9fed-e1d0886d71a8';
    const prompt = [
      'Use the apply_patch tool to create a file named clawx-real-ui-artifact.md in the current workspace.',
      'The file content must be exactly two lines:',
      '# ClawX UI Artifact',
      'CLAWX_REAL_UI_ARTIFACT_OK',
      'After creating the file, reply exactly: CLAWX_REAL_UI_ARTIFACT_DONE',
    ].join('\n');

    await writeFile(join(sessionStoreDir, 'clawx-main_real.json'), JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          name: 'default',
          agent_session_id: agentSessionId,
          history: [
            { role: 'user', content: prompt, timestamp: '2026-06-27T22:53:51.523755+08:00' },
            { role: 'assistant', content: 'CLAWX_REAL_UI_ARTIFACT_DONE', timestamp: '2026-06-27T22:54:27.662144+08:00' },
          ],
          created_at: '2026-06-27T22:53:51.523755+08:00',
          updated_at: '2026-06-27T22:54:27.662144+08:00',
        },
      },
      active_session: {
        'clawx:main:main': 's1',
      },
      user_sessions: {
        'clawx:main:main': ['s1'],
      },
    }), 'utf8');

    const transcriptDir = join(codexSessionsDir, '2026', '06', '27');
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(join(transcriptDir, 'rollout-real.jsonl'), [
      JSON.stringify({
        timestamp: '2026-06-27T14:53:29.811Z',
        type: 'session_meta',
        payload: { id: agentSessionId },
      }),
      JSON.stringify({
        timestamp: '2026-06-27T14:54:06.520Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-27T14:54:06.520Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: prompt },
      }),
      JSON.stringify({
        timestamp: '2026-06-27T14:54:13.029Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'call_Cmlhk9VyhQ46Hje16SlCF4yE',
          name: 'apply_patch',
          input: [
            '*** Begin Patch',
            '*** Add File: clawx-real-ui-artifact.md',
            '+# ClawX UI Artifact',
            '+CLAWX_REAL_UI_ARTIFACT_OK',
            '*** End Patch',
            '',
          ].join('\n'),
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-27T14:54:13.199Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call_Cmlhk9VyhQ46Hje16SlCF4yE',
          output: 'Exit code: 0\nWall time: 0.2 seconds\nOutput:\nSuccess. Updated the following files:\nA clawx-real-ui-artifact.md\n',
        },
      }),
      JSON.stringify({
        timestamp: '2026-06-27T14:54:27.648Z',
        type: 'event_msg',
        payload: { type: 'task_complete' },
      }),
    ].join('\n'), 'utf8');

    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
      sessionStoreDir,
      codexSessionsDir,
    });

    await expect(adapter.loadHistory('agent:main:main', 20)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `cc-connect-transcript-${agentSessionId}:call_Cmlhk9VyhQ46Hje16SlCF4yE:codex-tool`,
        role: 'assistant',
        content: [expect.objectContaining({
          type: 'toolCall',
          id: 'call_Cmlhk9VyhQ46Hje16SlCF4yE',
          name: 'apply_patch',
        })],
        stopReason: 'tool_use',
      }),
      expect.objectContaining({
        id: `cc-connect-transcript-${agentSessionId}:call_Cmlhk9VyhQ46Hje16SlCF4yE:codex-result`,
        role: 'toolresult',
        toolCallId: 'call_Cmlhk9VyhQ46Hje16SlCF4yE',
        toolName: 'apply_patch',
        content: 'Success. Updated the following files:\nA clawx-real-ui-artifact.md',
      }),
    ]));
    expect(emitted).toEqual(expect.arrayContaining([
      ['chat:runtime-event', expect.objectContaining({
        type: 'session.updated',
        sessionKey: 'agent:main:main',
        reason: 'codex-transcript-store-sync',
      })],
    ]));

    emitted.length = 0;
    await adapter.loadHistory('agent:main:main', 20);
    expect(emitted).toEqual([]);
  });

  it('lists and reads cc-connect channel sessions from the persisted session store', async () => {
    await writeFile(join(sessionStoreDir, 'clawx-main_1234abcd.json'), JSON.stringify({
      sessions: {
        s0: {
          id: 's0',
          name: 'Stale Empty Feishu DM',
          agent_type: 'codex',
          history: [],
          created_at: 1_780_899_000_000,
          updated_at: 1_780_899_000_000,
        },
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
        'feishu:oc_chat:ou_user': 's0',
        'clawx:research:desk': 's2',
      },
      user_sessions: {
        'feishu:oc_chat:ou_user': ['s0', 's1'],
        'clawx:research:desk': ['s2'],
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
        derivedTitle: 'Feishu DM',
        lastMessagePreview: '在。有什么需要我处理？',
        agentId: 'main',
        updatedAt: 1_780_900_001_000,
      },
      {
        key: 'agent:research:desk',
        displayName: 'ClawX Main',
        derivedTitle: 'ClawX Main',
        lastMessagePreview: 'hello from app',
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

  it('keeps the bound agent id for cc-connect channel sessions', async () => {
    await writeFile(join(sessionStoreDir, 'clawx-coder_1234abcd.json'), JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          name: 'Feishu Coder DM',
          history: [
            { role: 'user', content: '修一下', timestamp: 1_780_910_000_000 },
            { role: 'assistant', content: '我来处理。', timestamp: 1_780_910_001_000 },
          ],
          created_at: 1_780_910_000_000,
          updated_at: 1_780_910_001_000,
        },
      },
      active_session: {
        'feishu:oc_chat:ou_coder': 's1',
      },
      user_sessions: {
        'feishu:oc_chat:ou_coder': ['s1'],
      },
    }), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toEqual([
      expect.objectContaining({
        key: 'feishu:oc_chat:ou_coder',
        agentId: 'coder',
        displayName: 'Feishu Coder DM',
        derivedTitle: 'Feishu Coder DM',
      }),
    ]);
  });

  it('does not read Codex transcripts when cc-connect sessions have no stored history', async () => {
    const codexHomeDir = join(tempDir, 'codex-home');
    const transcriptDir = join(codexHomeDir, 'sessions', '2026', '06', '09');
    await mkdir(transcriptDir, { recursive: true });
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
    ].join('\n'), 'utf8');
    const adapter = new CcConnectBridgeAdapter({
      port: 1,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      sessionStoreDir,
    });

    await expect(adapter.listSessions()).resolves.toEqual([]);
    await expect(adapter.loadHistory('feishu:chat-1:user-1')).resolves.toEqual([]);
    await expect(adapter.summarizeSessions(['feishu:chat-1:user-1'])).resolves.toEqual([{
      sessionKey: 'feishu:chat-1:user-1',
      firstUserText: null,
      lastTimestamp: null,
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
