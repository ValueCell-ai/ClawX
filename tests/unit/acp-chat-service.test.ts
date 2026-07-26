import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

const acpSdkMock = vi.hoisted(() => {
  const state = { connectionForSpawn: undefined as unknown };
  return {
    state,
    ClientSideConnection: vi.fn(function () {
      return state.connectionForSpawn;
    }),
    ndJsonStream: vi.fn(() => ({})),
  };
});

const childProcessMock = vi.hoisted(() => {
  const state = { child: undefined as unknown };
  return {
    state,
    spawn: vi.fn(() => state.child),
    fork: vi.fn(() => state.child),
  };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: loggerMock,
}));

vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: acpSdkMock.ClientSideConnection,
  ndJsonStream: acpSdkMock.ndJsonStream,
  PROTOCOL_VERSION: 1,
}));

vi.mock('node:child_process', () => ({
  default: { spawn: childProcessMock.spawn, fork: childProcessMock.fork },
  spawn: childProcessMock.spawn,
  fork: childProcessMock.fork,
}));

function createConnection() {
  return {
    initialize: vi.fn().mockResolvedValue({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
    newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

async function createService(connection = createConnection()) {
  const send = vi.fn();
  const { AcpChatService } = await import('../../electron/services/acp-chat-service');
  const service = new AcpChatService({ webContents: { send } } as never, connection as never);
  return { service, connection, send };
}

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

async function createSpawnedService(connection = createConnection()) {
  const send = vi.fn();
  const child = createFakeChild();
  acpSdkMock.state.connectionForSpawn = connection;
  childProcessMock.state.child = child;
  const { AcpChatService } = await import('../../electron/services/acp-chat-service');
  const service = new AcpChatService({ webContents: { send } } as never);
  return { service, connection, send, child };
}

async function expectCancelledSoon(promise: Promise<unknown>) {
  await expect(Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 25)),
  ])).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
}

function createInitResponse() {
  return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('AcpChatService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acpSdkMock.state.connectionForSpawn = undefined;
    childProcessMock.state.child = undefined;
  });

  it('forks the embedded OpenClaw entry for ACP instead of spawning a public CLI wrapper', async () => {
    const { service } = await createSpawnedService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    expect(childProcessMock.fork).toHaveBeenCalledWith(
      expect.stringContaining('openclaw.mjs'),
      ['acp'],
      expect.objectContaining({
        cwd: expect.stringContaining('openclaw'),
        execArgv: [],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
        env: expect.objectContaining({
          OPENCLAW_NO_RESPAWN: '1',
          OPENCLAW_EMBEDDED_IN: 'ClawX',
          OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
        }),
      }),
    );
  });

  it('filters non-JSON stdout diagnostics before the ACP SDK parser sees them', async () => {
    const { service, child } = await createSpawnedService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    const output = acpSdkMock.ndJsonStream.mock.calls[0]?.[1] as ReadableStream<Uint8Array>;
    const reader = output.getReader();
    const nextChunk = reader.read();
    child.stdout.write('│ startup doctor note\n{"jsonrpc":"2.0","id":1,"result":{}}\n');

    const { done, value } = await nextChunk;
    reader.releaseLock();

    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toBe('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect(loggerMock.info).toHaveBeenCalledWith('[acp-chat] [stdout] │ startup doctor note');
  });

  it('loads historical sessions without explicit routing metadata so replay can resolve by session key', async () => {
    const { service, connection } = await createService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(connection.initialize).toHaveBeenCalledWith({
      protocolVersion: 1,
      clientCapabilities: {},
    });
    expect(connection.loadSession).toHaveBeenCalledWith({
      sessionId: 'agent:pi:s1',
      cwd: '/repo',
      mcpServers: [],
    });
    expect(connection.newSession).not.toHaveBeenCalled();
  });

  it('creates fresh generated sessions with ACP session/new so replay ledgers are complete', async () => {
    const { service, connection } = await createService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:session-123', cwd: '/repo', createIfMissing: true })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(connection.newSession).toHaveBeenCalledWith({
      cwd: '/repo',
      mcpServers: [],
      _meta: { sessionKey: 'agent:pi:session-123', prefixCwd: true },
    });
    expect(connection.loadSession).not.toHaveBeenCalled();
  });

  it('routes fresh-session prompts through the ACP session id returned by session/new', async () => {
    const { service, connection } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:session-123', cwd: '/repo', createIfMissing: true });
    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:session-123',
      cwd: '/repo',
      message: 'hello',
      messageId: 'msg-1',
    })).resolves.toEqual({ success: true, generation: 1 });

    expect(connection.prompt).toHaveBeenCalledWith({
      sessionId: 'acp-session-1',
      prompt: [{ type: 'text', text: 'hello' }],
      messageId: 'msg-1',
      _meta: { sessionKey: 'agent:pi:session-123', prefixCwd: true },
    });
  });

  it('rewrites fresh-session ACP updates to the ClawX session key for the renderer', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:session-123', cwd: '/repo', createIfMissing: true });
    await service.client.sessionUpdate({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'completed',
      },
    } as never);

    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, {
      sessionKey: 'agent:pi:session-123',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:session-123',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Read file',
          status: 'completed',
        },
      },
    });
  });

  it('emits raw ACP session updates with sessionKey and generation for the active session', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'live', messageId: 'msg-live' });
    send.mockClear();
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'hello' },
      },
    } as never);
    await service.client.sessionUpdate({
      sessionId: 'agent:other:s2',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-2',
        content: { type: 'text', text: 'ignored' },
      },
    } as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, {
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'hello' },
        },
      },
    });
  });

  it('records ACP session load and forwarded update trace entries', async () => {
    const { clearAcpTraceForTests, getAcpTraceSnapshot } = await import('../../electron/services/acp-trace');
    clearAcpTraceForTests();
    const { service } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'hello' },
      },
    } as never);

    expect(getAcpTraceSnapshot().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'main',
        event: 'session/load:start',
        sessionKey: 'agent:pi:s1',
      }),
      expect.objectContaining({
        source: 'main',
        event: 'session/load:success',
        sessionKey: 'agent:pi:s1',
        generation: 1,
      }),
      expect.objectContaining({
        source: 'main',
        event: 'session-update:received',
        direction: 'upstream',
      }),
      expect.objectContaining({
        source: 'main',
        event: 'session-update:forwarded',
        direction: 'downstream',
      }),
    ]));
  });

  it('records ignored ACP session updates with a mismatch reason', async () => {
    const { clearAcpTraceForTests, getAcpTraceSnapshot } = await import('../../electron/services/acp-trace');
    clearAcpTraceForTests();
    const { service } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await service.client.sessionUpdate({
      sessionId: 'agent:other:s2',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-2',
        content: { type: 'text', text: 'ignored' },
      },
    } as never);

    expect(getAcpTraceSnapshot().entries).toContainEqual(expect.objectContaining({
      source: 'main',
      event: 'session-update:ignored',
      direction: 'upstream',
      sessionKey: 'agent:pi:s1',
      details: expect.objectContaining({ reason: 'session-mismatch' }),
    }));
  });

  it('marks ACP session updates from historical loads until the next live prompt starts', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'history-tool',
        title: 'Historical tool',
        status: 'completed',
      },
    } as never);

    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, {
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'history-tool',
          title: 'Historical tool',
          status: 'completed',
        },
      },
    });

    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'live', messageId: 'live-message' });
    send.mockClear();
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'live-tool',
        title: 'Live tool',
        status: 'completed',
      },
    } as never);

    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, expect.not.objectContaining({
      historical: true,
    }));
  });

  it('emits permission requests separately and resolves them from respondPermission', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    send.mockClear();

    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);
    const envelope = send.mock.calls[0]?.[1];

    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpPermissionRequest, {
      sessionKey: 'agent:pi:s1',
      generation: 1,
      requestId: expect.any(String),
      request: {
        sessionId: 'agent:pi:s1',
        toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    });
    expect(send).not.toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, expect.anything());

    await expect(service.respondPermission({
      sessionKey: 'agent:pi:s1',
      requestId: envelope.requestId,
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })).resolves.toEqual({ success: true, generation: 1 });
    await expect(pending).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('returns cancelled for permission requests from non-active sessions', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    send.mockClear();

    await expectCancelledSoon(service.client.requestPermission({
      sessionId: 'agent:other:s2',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never));

    expect(send).not.toHaveBeenCalled();
  });

  it('cancels pending permission requests when switching sessions', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    send.mockClear();
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);

    await expect(service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 2,
    });

    await expectCancelledSoon(pending);
  });

  it('cancels pending permission requests and drops the connection when the ACP child exits', async () => {
    const firstConnection = createConnection();
    const { service, child } = await createSpawnedService(firstConnection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);
    const secondConnection = createConnection();
    acpSdkMock.state.connectionForSpawn = secondConnection;
    childProcessMock.state.child = createFakeChild();

    child.emit('exit', 1);

    await expectCancelledSoon(pending);
    await service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' });
    expect(childProcessMock.fork).toHaveBeenCalledTimes(2);
    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
  });

  it('cancels pending permission requests and drops the connection when the ACP child errors', async () => {
    const firstConnection = createConnection();
    const { service, child } = await createSpawnedService(firstConnection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);
    const secondConnection = createConnection();
    acpSdkMock.state.connectionForSpawn = secondConnection;
    childProcessMock.state.child = createFakeChild();

    child.emit('error', new Error('spawn failed'));

    await expectCancelledSoon(pending);
    await service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' });
    expect(childProcessMock.fork).toHaveBeenCalledTimes(2);
    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
  });

  it('shares one initialize call for simultaneous session loads', async () => {
    const connection = createConnection();
    const initialized = createDeferred<ReturnType<typeof createInitResponse>>();
    connection.initialize.mockReturnValue(initialized.promise);
    const { service } = await createService(connection);

    const firstLoad = service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    const secondLoad = service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' });

    await Promise.resolve();
    expect(connection.initialize).toHaveBeenCalledTimes(1);

    initialized.resolve(createInitResponse());
    await expect(Promise.all([firstLoad, secondLoad])).resolves.toHaveLength(2);
  });

  it('rejects prompts before any ACP session has loaded', async () => {
    const { service, connection } = await createService();

    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello',
    })).resolves.toEqual({ success: false, error: 'No active ACP session' });

    expect(connection.prompt).not.toHaveBeenCalled();
  });

  it('rejects prompts for inactive ACP sessions', async () => {
    const { service, connection } = await createService();
    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    connection.prompt.mockClear();

    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:s2',
      cwd: '/repo',
      message: 'wrong session',
    })).resolves.toEqual({ success: false, error: 'ACP prompt session is not active' });

    expect(connection.prompt).not.toHaveBeenCalled();
  });

  it('rejects prompts while a session load is still in progress', async () => {
    const connection = createConnection();
    const load = createDeferred<unknown>();
    connection.loadSession.mockReturnValueOnce(load.promise);
    const { service, connection: activeConnection } = await createService(connection);

    const loadPromise = service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await vi.waitFor(() => expect(connection.loadSession).toHaveBeenCalledTimes(1));

    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'too early',
    })).resolves.toEqual({ success: false, error: 'ACP session is not loaded' });

    expect(activeConnection.prompt).not.toHaveBeenCalled();
    load.resolve({});
    await loadPromise;
  });

  it('rolls back active session and generation when loadSession fails', async () => {
    const { service, connection, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    connection.loadSession.mockRejectedValueOnce(new Error('load failed'));

    await expect(service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' })).resolves.toEqual({
      success: false,
      error: 'load failed',
    });
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s2',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-2',
        content: { type: 'text', text: 'ignored' },
      },
    } as never);
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'still active' },
      },
    } as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, {
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'still active' },
        },
      },
    });
  });

  it('does not let an older failed overlapping load roll back a newer loaded session', async () => {
    const { service, connection, send } = await createService();
    const firstLoad = createDeferred<unknown>();

    connection.loadSession
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce({});

    const older = service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await vi.waitFor(() => expect(connection.loadSession).toHaveBeenCalledTimes(1));

    await expect(service.loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 2,
    });

    firstLoad.reject(new Error('older load failed'));
    await expect(older).resolves.toEqual({ success: false, error: 'older load failed' });

    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'old ignored' },
      },
    } as never);
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s2',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-2',
        content: { type: 'text', text: 'new active' },
      },
    } as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, {
      sessionKey: 'agent:pi:s2',
      generation: 2,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s2',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-2',
          content: { type: 'text', text: 'new active' },
        },
      },
    });
  });

  it('cancels the ACP session and resolves pending permission requests for that session', async () => {
    const { service, connection, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    send.mockClear();

    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject' }],
    } as never);

    await expect(service.cancelSession({ sessionKey: 'agent:pi:s1' })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(connection.cancel).toHaveBeenCalledWith({ sessionId: 'agent:pi:s1' });
    await expect(pending).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('builds ACP prompt blocks from message and media', async () => {
    const imagePath = join(tmpdir(), `clawx-acp-service-${Date.now()}.png`);
    const filePath = join(tmpdir(), `clawx-acp-service-${Date.now()}.txt`);
    writeFileSync(imagePath, 'fake-image');
    writeFileSync(filePath, 'plain text');

    try {
      const { service, connection } = await createService();

      await service.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
      await expect(service.sendPrompt({
        sessionKey: 'agent:pi:s1',
        cwd: '/repo',
        message: 'Inspect attachments',
        messageId: 'msg-user-1',
        media: [
          { filePath: imagePath, mimeType: 'image/png', fileName: 'image.png' },
          { filePath, mimeType: 'text/plain', fileName: 'notes.txt' },
        ],
      })).resolves.toEqual({ success: true, generation: 1 });

      expect(connection.prompt).toHaveBeenCalledWith({
        sessionId: 'agent:pi:s1',
        messageId: 'msg-user-1',
        prompt: [
          { type: 'text', text: 'Inspect attachments' },
          {
            type: 'image',
            data: Buffer.from('fake-image').toString('base64'),
            mimeType: 'image/png',
            uri: imagePath,
          },
          {
            type: 'resource_link',
            uri: filePath,
            name: 'notes.txt',
          },
        ],
        _meta: { sessionKey: 'agent:pi:s1', prefixCwd: true },
      });
    } finally {
      rmSync(imagePath, { force: true });
      rmSync(filePath, { force: true });
    }
  });
});
