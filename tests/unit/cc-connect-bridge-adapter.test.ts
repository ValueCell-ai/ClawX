// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import {
  CLAWX_BRIDGE_ADMIN_USER_ID,
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

describe('cc-connect BridgePlatform adapter', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-bridge-adapter-'));
    electronMockState.userData = join(tempDir, 'userData');
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

  it('closes a bridge socket that is still waiting for registration acknowledgement', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    let connectionCount = 0;
    const connected = new Promise<void>((resolve) => {
      server.on('connection', () => {
        connectionCount += 1;
        resolve();
      });
    });
    const adapter = new CcConnectBridgeAdapter({
      port,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      reconnectDelayMs: 10,
    });

    try {
      const connectPromise = adapter.connect();
      await connected;
      await adapter.close();
      await expect(connectPromise).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(connectionCount).toBe(1);
      expect(adapter.isConnected()).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
    {
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: 'demo.mp4',
      content: 'fake video bytes',
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
      expect(register?.capabilities).toEqual(expect.arrayContaining(['image', 'file', 'audio', 'video']));
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
              type: 'preview_start',
              ref_id: 'text-preview-1',
              session_key: parsed.session_key,
              reply_ctx: parsed.reply_ctx,
              content: 'initial preview text',
            }));
            socket.send(JSON.stringify({
              type: 'update_message',
              preview_handle: 'text-preview-1',
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
              preview_handle: 'text-preview-1',
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
            text: 'initial preview text',
            replace: true,
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            runId: cardRun.runId,
            sessionKey: 'agent:main:main',
            text: 'draft preview text',
            replace: true,
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            runId: cardRun.runId,
            sessionKey: 'agent:main:main',
            text: '',
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
      expect(register?.metadata).toMatchObject({
        adapter: 'clawx',
        progress_style: 'card',
        supports_progress_card_payload: true,
      });
      expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'preview_ack',
          ref_id: 'preview-1',
          preview_handle: 'preview-1',
        }),
        expect.objectContaining({
          type: 'preview_ack',
          ref_id: 'text-preview-1',
          preview_handle: 'text-preview-1',
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

  it('routes handle-only text preview updates to the correct concurrent Agent run', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const inbound: Record<string, unknown>[] = [];

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type !== 'message') return;
        inbound.push(parsed);
        if (inbound.length !== 2) return;
        for (const [index, message] of inbound.entries()) {
          const handle = `concurrent-preview-${index + 1}`;
          socket.send(JSON.stringify({
            type: 'preview_start',
            ref_id: handle,
            session_key: message.session_key,
            reply_ctx: message.reply_ctx,
            content: `initial-${index + 1}`,
          }));
          socket.send(JSON.stringify({
            type: 'update_message',
            preview_handle: handle,
            content: `updated-${index + 1}`,
          }));
        }
      });
    });

    try {
      const adapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        projectForSessionKey: (sessionKey) => sessionKey.includes('research') ? 'clawx-research' : 'clawx-main',
        emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
      });
      const mainRun = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'main preview',
        idempotencyKey: 'main-preview',
      });
      const researchRun = await adapter.send({
        sessionKey: 'agent:research:main',
        message: 'research preview',
        idempotencyKey: 'research-preview',
      });

      await vi.waitFor(() => {
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            runId: mainRun.runId,
            sessionKey: 'agent:main:main',
            text: 'updated-1',
          })],
          ['chat:runtime-event', expect.objectContaining({
            type: 'assistant.delta',
            runId: researchRun.runId,
            sessionKey: 'agent:research:main',
            text: 'updated-2',
          })],
        ]));
      });
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('maps the public cc-connect progress-card payload to thinking and tool runtime events', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const emitted: Array<[string, unknown]> = [];
    const prefix = '__cc_connect_progress_card_v1__:';
    const progress = (items: unknown[]) => `${prefix}${JSON.stringify({ version: 2, state: 'running', items })}`;

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type === 'message') {
          const inferCompletion = parsed.content === 'infer completion';
          const applyPatch = parsed.content === 'apply patch';
          const refId = inferCompletion ? 'progress-inferred' : applyPatch ? 'progress-apply-patch' : 'progress-1';
          const firstItems = applyPatch
            ? [{
                kind: 'tool_use',
                tool: 'Patch',
                text: JSON.stringify([{
                  diff: '# Progress\n',
                  kind: { type: 'add' },
                  path: 'reports/progress.md',
                }]),
              }]
            : [
                { kind: 'thinking', text: 'Inspecting the workspace' },
                { kind: 'tool_use', tool: 'Bash', text: 'pwd' },
              ];
          const completedItems = applyPatch
            ? [
                firstItems[0],
                { kind: 'tool_result', tool: 'Patch', text: 'Done!', status: 'completed', success: true },
              ]
            : [
                firstItems[1],
                { kind: 'tool_result', tool: 'Bash', text: '/tmp/project', status: 'completed', exit_code: 0, success: true },
              ];
          socket.send(JSON.stringify({
            type: 'preview_start',
            ref_id: refId,
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            content: progress(firstItems),
          }));
          if (!inferCompletion) {
            socket.send(JSON.stringify({
              type: 'update_message',
              preview_handle: refId,
              content: progress(completedItems),
            }));
            socket.send(JSON.stringify({
              type: 'update_message',
              preview_handle: refId,
              content: progress(completedItems),
            }));
          }
          socket.send(JSON.stringify({
            type: 'delete_message',
            preview_handle: refId,
          }));
          socket.send(JSON.stringify({
            type: 'reply',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
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
      });
      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'inspect',
        idempotencyKey: 'idem-progress',
      });

      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'thinking.delta',
          runId: result.runId,
          text: 'Inspecting the workspace',
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.started',
          runId: result.runId,
          toolCallId: `${result.runId}:progress:1`,
          name: 'Bash',
          args: 'pwd',
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.completed',
          runId: result.runId,
          toolCallId: `${result.runId}:progress:1`,
          name: 'Bash',
          result: '/tmp/project',
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: result.runId,
          status: 'completed',
        })],
      ])));
      const started = emitted.filter(([, payload]) => (
        payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'tool.started'
      ));
      expect(started).toHaveLength(1);
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'assistant.delta',
          text: expect.stringContaining(prefix),
        })],
      ]));

      const patched = await adapter.send({
        sessionKey: 'agent:main:patch',
        message: 'apply patch',
        idempotencyKey: 'idem-progress-patch',
      });
      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: patched.runId,
          sessionKey: 'agent:main:patch',
          message: expect.objectContaining({
            role: 'assistant',
            content: [expect.objectContaining({
              type: 'toolCall',
              name: 'Patch',
              arguments: [expect.objectContaining({
                diff: '# Progress\n',
                path: 'reports/progress.md',
                kind: { type: 'add' },
              })],
            })],
          }),
        })],
      ])));

      const inferred = await adapter.send({
        sessionKey: 'agent:main:inferred',
        message: 'infer completion',
        idempotencyKey: 'idem-progress-inferred',
      });
      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'tool.completed',
          runId: inferred.runId,
          toolCallId: `${inferred.runId}:progress:1`,
          name: 'Bash',
          meta: expect.objectContaining({
            status: 'completed',
            success: true,
            inferredFromRunCompletion: true,
          }),
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: inferred.runId,
          status: 'completed',
        })],
      ])));
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
      expect(register?.capabilities).toEqual(expect.arrayContaining(['text', 'preview', 'reconstruct_reply']));
      expect(register?.capabilities).not.toEqual(expect.arrayContaining(['tool_events', 'command_output', 'patch_events']));
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

  it('keeps the BridgePlatform socket alive, reconnects after a drop, and stops reconnecting on close', async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = await new Promise<number>((resolve) => {
      server.once('listening', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const sockets: WebSocket[] = [];
    const received: Record<string, unknown>[] = [];

    server.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        received.push(parsed);
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
        }
      });
    });

    const adapter = new CcConnectBridgeAdapter({
      port,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
      heartbeatIntervalMs: 20,
      reconnectDelayMs: 20,
    });

    try {
      await adapter.connect();
      await vi.waitFor(() => {
        expect(received).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'ping', ts: expect.any(Number) }),
        ]));
      });

      sockets[0]?.close();
      await vi.waitFor(() => {
        expect(sockets).toHaveLength(2);
        expect(adapter.isConnected()).toBe(true);
      });

      await adapter.close();
      const connectionCountAfterClose = sockets.length;
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(sockets).toHaveLength(connectionCountAfterClose);
      expect(adapter.isConnected()).toBe(false);
    } finally {
      await adapter.close();
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
    const received: Record<string, unknown>[] = [];
    let capturedReplyCtx = '';

    server.on('connection', (socket) => {
      socket.on('message', (data) => {
        const parsed = JSON.parse(String(data)) as Record<string, unknown>;
        received.push(parsed);
        if (parsed.type === 'register') {
          socket.send(JSON.stringify({ type: 'register_ack', ok: true }));
          return;
        }
        if (parsed.type === 'message') {
          capturedReplyCtx = String(parsed.reply_ctx || '');
          if (parsed.content === '/stop') {
            socket.send(JSON.stringify({
              type: 'reply',
              reply_ctx: parsed.reply_ctx,
              session_key: parsed.session_key,
              content: 'Execution stopped.',
            }));
          }
        }
      });
    });

    try {
      const adapter = new CcConnectBridgeAdapter({
        port,
        token: 'token',
        project: 'clawx-main',
        emit: ((event: string, payload: unknown) => emitted.push([event, payload])) as never,
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
        stoppedSessions: ['agent:main:main'],
        upstreamStopRequested: true,
      });

      await vi.waitFor(() => {
        expect(received).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
            content: '/stop',
            session_key: 'clawx:main:main',
            project: 'clawx-main',
            reply_ctx: result.runId,
            user_id: CLAWX_BRIDGE_ADMIN_USER_ID,
          }),
        ]));
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
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('round-trips a validated Codex approval through cc-connect card_action', async () => {
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
            type: 'buttons',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            project: parsed.project,
            content: 'Allow Codex to run pwd?',
            buttons: [[
              { Text: 'Allow once', Data: 'perm:allow' },
              { Text: 'Deny', Data: 'perm:deny' },
            ]],
          }));
          return;
        }
        if (parsed.type === 'card_action') {
          socket.send(JSON.stringify({
            type: 'reply',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            content: 'approval accepted by cc-connect',
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
      });
      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: 'run pwd with approval',
        idempotencyKey: 'idem-approval',
      });

      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'approval.updated',
          runId: result.runId,
          phase: 'requested',
          status: 'pending',
          actions: [
            { action: 'perm:allow', label: 'Allow once' },
            { action: 'perm:deny', label: 'Deny' },
          ],
        })],
      ])));

      await expect(adapter.respondApproval({ runId: result.runId, action: 'perm:other' }))
        .rejects.toThrow('action is not available');
      await expect(adapter.respondApproval({ runId: result.runId, action: 'perm:allow' }))
        .resolves.toEqual({
          success: true,
          runId: result.runId,
          action: 'perm:allow',
          status: 'approved',
        });

      await vi.waitFor(() => {
        expect(received).toEqual(expect.arrayContaining([
          expect.objectContaining({
            type: 'card_action',
            session_key: 'clawx:main:main',
            reply_ctx: result.runId,
            project: 'clawx-main',
            action: 'perm:allow',
          }),
        ]));
        expect(emitted).toEqual(expect.arrayContaining([
          ['chat:runtime-event', expect.objectContaining({
            type: 'approval.updated',
            runId: result.runId,
            phase: 'resolved',
            status: 'approved',
          })],
          ['chat:message', expect.objectContaining({
            runId: result.runId,
            message: expect.objectContaining({ content: 'approval accepted by cc-connect' }),
          })],
        ]));
      });
      await expect(adapter.respondApproval({ runId: result.runId, action: 'perm:allow' }))
        .rejects.toThrow('No pending cc-connect approval');
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('round-trips a validated runtime card choice without ending the run early', async () => {
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
            type: 'card',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            project: parsed.project,
            card: {
              header: { title: 'Language', color: 'blue' },
              elements: [
                { type: 'markdown', content: 'Choose a language.' },
                {
                  type: 'actions',
                  buttons: [
                    { text: 'English', value: 'cmd:/lang en' },
                    { text: 'Unsafe', value: 'javascript:alert(1)' },
                  ],
                },
              ],
            },
          }));
          return;
        }
        if (parsed.type === 'card_action') {
          socket.send(JSON.stringify({
            type: 'reply',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            content: 'Language switched to English.',
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
      });
      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: '/lang',
        idempotencyKey: 'idem-language-card',
      });

      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'approval.updated',
          runId: result.runId,
          kind: 'choice',
          phase: 'requested',
          status: 'pending',
          message: '**Language**\n\nChoose a language.',
          actions: [{ action: 'cmd:/lang en', label: 'English' }],
        })],
      ])));
      expect(emitted).not.toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: result.runId,
        })],
      ]));

      await expect(adapter.respondApproval({
        runId: result.runId,
        action: 'cmd:/lang en',
      })).resolves.toMatchObject({ status: 'answered' });
      await vi.waitFor(() => expect(received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'card_action',
          session_key: 'clawx:main:main',
          action: 'cmd:/lang en',
          project: 'clawx-main',
        }),
      ])));
      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: result.runId,
          message: expect.objectContaining({ content: 'Language switched to English.' }),
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: result.runId,
          status: 'completed',
        })],
      ])));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('completes a select-card run after cc-connect returns the selected state card', async () => {
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
            type: 'card',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            project: parsed.project,
            card: {
              header: { title: 'Language' },
              elements: [{
                type: 'select',
                placeholder: 'Choose a language',
                options: [{ text: '日本語', value: 'act:/lang ja' }],
              }],
            },
          }));
          return;
        }
        if (parsed.type === 'card_action') {
          socket.send(JSON.stringify({
            type: 'card',
            session_key: parsed.session_key,
            reply_ctx: parsed.reply_ctx,
            project: parsed.project,
            card: {
              header: { title: '言語' },
              elements: [{ type: 'markdown', content: '現在の言語: 日本語' }],
            },
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
      });
      const result = await adapter.send({
        sessionKey: 'agent:main:main',
        message: '/lang',
        idempotencyKey: 'idem-language-select-card',
      });

      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:runtime-event', expect.objectContaining({
          type: 'approval.updated',
          runId: result.runId,
          kind: 'choice',
          actions: [{ action: 'act:/lang ja', label: '日本語' }],
        })],
      ])));
      await adapter.respondApproval({ runId: result.runId, action: 'act:/lang ja' });
      await vi.waitFor(() => expect(emitted).toEqual(expect.arrayContaining([
        ['chat:message', expect.objectContaining({
          runId: result.runId,
          message: expect.objectContaining({ content: '**言語**\n\n現在の言語: 日本語' }),
        })],
        ['chat:runtime-event', expect.objectContaining({
          type: 'run.ended',
          runId: result.runId,
          status: 'completed',
        })],
      ])));
      await adapter.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not expose Codex transcript reconciliation as a runtime transport', () => {
    const adapter = new CcConnectBridgeAdapter({
      port: 0,
      token: 'token',
      project: 'clawx-main',
      emit: vi.fn(),
    });
    expect('reconcilePendingRunsFromHistory' in adapter).toBe(false);
  });


});
