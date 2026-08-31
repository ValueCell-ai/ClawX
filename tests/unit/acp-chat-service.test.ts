import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

const storeMock = vi.hoisted(() => ({
  getSetting: vi.fn(),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: loggerMock,
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: storeMock.getSetting,
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
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
    }),
    newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' }),
    loadSession: vi.fn().mockResolvedValue({}),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

function createPassthroughAccessRegistry() {
  let activeGrant: {
    sessionKey: string;
    generation: number;
    workspaceRoot: string;
    executionCwd: string;
  } | null = null;
  return {
    prepareGrant: vi.fn(async (input) => ({ ...input })),
    snapshot: vi.fn(() => activeGrant ? { ...activeGrant } : null),
    commitGrant: vi.fn((context) => { activeGrant = { ...context }; }),
    restore: vi.fn((snapshot) => { activeGrant = snapshot ? { ...snapshot } : null; }),
    get: vi.fn((sessionKey, generation) => (
      activeGrant?.sessionKey === sessionKey && activeGrant.generation === generation
        ? { ...activeGrant }
        : null
    )),
  };
}

async function createService(connection = createConnection(), accessRegistry = createPassthroughAccessRegistry()) {
  const send = vi.fn();
  const { AcpChatService } = await import('../../electron/services/acp-chat-service');
  const service = new AcpChatService(
    { webContents: { send } } as never,
    accessRegistry as never,
    connection as never,
    undefined,
  );
  return { service, connection, send, accessRegistry };
}

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

async function createSpawnedService(connection = createConnection()) {
  const send = vi.fn();
  const child = createFakeChild();
  acpSdkMock.state.connectionForSpawn = connection;
  childProcessMock.state.child = child;
  const { AcpChatService } = await import('../../electron/services/acp-chat-service');
  const service = new AcpChatService(
    { webContents: { send } } as never,
    createPassthroughAccessRegistry() as never,
    undefined,
    undefined,
  );
  return { service, connection, send, child };
}

async function expectCancelledSoon(promise: Promise<unknown>) {
  await expect(Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 25)),
  ])).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
}

function createInitResponse() {
  return {
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
  };
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
    storeMock.getSetting.mockResolvedValue('clawx-test-gateway-token');
  });

  it('forks the embedded OpenClaw entry for ACP instead of spawning a public CLI wrapper', async () => {
    const { service } = await createSpawnedService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
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

  it('passes the authoritative ClawX Gateway token to the ACP child environment', async () => {
    const { service } = await createSpawnedService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(storeMock.getSetting).toHaveBeenCalledWith('gatewayToken');
    expect(childProcessMock.fork).toHaveBeenCalledWith(
      expect.stringContaining('openclaw.mjs'),
      ['acp'],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_GATEWAY_TOKEN: 'clawx-test-gateway-token',
          OPENCLAW_ACP_ACCEPTED_PROMPT_RECOVERY_GRACE_MS: '480000',
        }),
      }),
    );
  });

  it('filters non-JSON stdout diagnostics before the ACP SDK parser sees them', async () => {
    const { service, child } = await createSpawnedService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });

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

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
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

  it('follows ACP session/list cursors, projects the requested family, and preserves the loaded session', async () => {
    const connection = createConnection();
    connection.listSessions
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 'agent:main:parent',
            cwd: '/workspace',
            title: 'Parent',
            updatedAt: '2026-09-01T09:00:00.000Z',
          },
          {
            sessionId: 'agent:main:subagent:older',
            cwd: '/workspace',
            title: 'Older child',
            updatedAt: '2026-09-01T10:00:00.000Z',
            _meta: { spawnedBy: 'agent:main:parent' },
          },
        ],
        nextCursor: 'page-2',
      })
      .mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 'agent:main:subagent:newer',
            cwd: '/workspace',
            title: 'Newer child',
            updatedAt: '2026-09-01T11:00:00.000Z',
            _meta: { parentSessionId: 'agent:main:parent' },
          },
          {
            sessionId: 'agent:main:subagent:grandchild',
            cwd: '/workspace',
            _meta: { parentSessionId: 'agent:main:subagent:newer' },
          },
        ],
        nextCursor: null,
      });
    const { service } = await createService(connection);
    await service.loadSession({
      sessionKey: 'agent:main:loaded',
      workspaceRoot: '/workspace',
      cwd: '/workspace',
    });
    connection.loadSession.mockClear();

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: true,
      current: {
        sessionKey: 'agent:main:parent',
        title: 'Parent',
        updatedAt: '2026-09-01T09:00:00.000Z',
        parentSessionKey: null,
      },
      children: [
        {
          sessionKey: 'agent:main:subagent:newer',
          title: 'Newer child',
          updatedAt: '2026-09-01T11:00:00.000Z',
          parentSessionKey: 'agent:main:parent',
        },
        {
          sessionKey: 'agent:main:subagent:older',
          title: 'Older child',
          updatedAt: '2026-09-01T10:00:00.000Z',
          parentSessionKey: 'agent:main:parent',
        },
      ],
    });

    expect(connection.listSessions).toHaveBeenNthCalledWith(1, {});
    expect(connection.listSessions).toHaveBeenNthCalledWith(2, { cursor: 'page-2' });
    expect(connection.loadSession).not.toHaveBeenCalled();
    await expect(service.sendPrompt({
      sessionKey: 'agent:main:loaded',
      cwd: '/workspace',
      message: 'still loaded',
    })).resolves.toEqual({ success: true, generation: 1 });
    expect(connection.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'agent:main:loaded',
    }));
  });

  it('requires the ACP session/list capability advertised during initialization', async () => {
    const connection = createConnection();
    connection.initialize.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: {} },
    });
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'ACP agent does not support session/list',
    });
    expect(connection.listSessions).not.toHaveBeenCalled();
  });

  it.each([
    false,
    'supported',
    [],
    new Date('2026-09-01T00:00:00.000Z'),
    42,
    null,
  ])('rejects malformed ACP session/list capability value %p', async (listCapability) => {
    const connection = createConnection();
    connection.initialize.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { list: listCapability },
      },
    });
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'ACP agent does not support session/list',
    });
    expect(connection.listSessions).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    'agent:main:parent',
    [],
    {},
    { sessionKey: '' },
    { sessionKey: 42 },
    { sessionKey: 'main' },
  ])('returns a typed failure for invalid ACP session family payload %p', async (payload) => {
    const { service, connection } = await createService();

    await expect(service.getSessionFamily(payload as never)).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'Invalid ACP session family payload',
    });
    expect(connection.initialize).not.toHaveBeenCalled();
    expect(connection.listSessions).not.toHaveBeenCalled();
  });

  it('returns a typed failure when ACP initialization rejects', async () => {
    const connection = createConnection();
    connection.initialize.mockRejectedValue(new Error('Initialization failed'));
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'Initialization failed',
    });
    expect(connection.initialize).toHaveBeenCalledTimes(2);
    expect(connection.listSessions).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'repeated cursor',
      arrange: (listSessions: ReturnType<typeof vi.fn>) => listSessions
        .mockResolvedValueOnce({ sessions: [], nextCursor: 'same-cursor' })
        .mockResolvedValueOnce({ sessions: [], nextCursor: 'same-cursor' }),
      expectedCalls: 2,
    },
    {
      name: 'non-string cursor',
      arrange: (listSessions: ReturnType<typeof vi.fn>) => listSessions
        .mockResolvedValueOnce({ sessions: [], nextCursor: 42 }),
      expectedCalls: 1,
    },
    {
      name: 'empty cursor',
      arrange: (listSessions: ReturnType<typeof vi.fn>) => listSessions
        .mockResolvedValueOnce({ sessions: [], nextCursor: '' }),
      expectedCalls: 1,
    },
    {
      name: 'blank cursor',
      arrange: (listSessions: ReturnType<typeof vi.fn>) => listSessions
        .mockResolvedValueOnce({ sessions: [], nextCursor: '   ' }),
      expectedCalls: 1,
    },
  ])('terminates malformed ACP session/list pagination for a $name', async ({ arrange, expectedCalls }) => {
    const connection = createConnection();
    arrange(connection.listSessions);
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'Invalid ACP session/list cursor',
    });
    expect(connection.listSessions).toHaveBeenCalledTimes(expectedCalls);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { sessions: null },
    { sessions: 'not-an-array' },
    { sessions: [null] },
    { sessions: [{ cwd: '/workspace' }] },
  ])('returns a typed failure for malformed ACP session/list page %p', async (page) => {
    const connection = createConnection();
    connection.listSessions.mockResolvedValueOnce(page);
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'Invalid ACP session/list response',
    });
  });

  it('bounds ACP session/list pagination even when every cursor is unique', async () => {
    const connection = createConnection();
    connection.listSessions.mockImplementation(async ({ cursor }: { cursor?: string }) => ({
      sessions: [],
      nextCursor: `cursor-${Number(cursor?.split('-')[1] ?? 0) + 1}`,
    }));
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'ACP session/list exceeded 128 pages',
    });
    expect(connection.listSessions).toHaveBeenCalledTimes(128);
  });

  it('returns an empty typed failure when ACP session/list fails', async () => {
    const connection = createConnection();
    connection.listSessions.mockRejectedValueOnce(new Error('Gateway unavailable'));
    const { service } = await createService(connection);

    await expect(service.getSessionFamily({ sessionKey: 'agent:main:parent' })).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'Gateway unavailable',
    });
  });

  it('creates fresh generated sessions with ACP session/new so replay ledgers are complete', async () => {
    const { service, connection } = await createService();

    await expect(service.loadSession({ sessionKey: 'agent:pi:session-123', workspaceRoot: '/repo', cwd: '/repo', createIfMissing: true })).resolves.toEqual({
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

  it('uses an ephemeral ACP session for durable replay and routes its transcript to the logical Gateway session', async () => {
    const connection = createConnection();
    const { service, send } = await createService(connection);
    connection.newSession.mockImplementationOnce(async () => {
      await service.client.sessionUpdate({
        sessionId: 'acp-durable-replay',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'consult-answer',
          content: { type: 'text', text: 'Durable consult answer' },
        },
      } as never);
      return { sessionId: 'acp-durable-replay' };
    });

    await expect(service.loadSession({
      sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo', forceDurableReplay: true,
    })).resolves.toEqual({
      success: true,
      generation: 1,
      sessionUpdates: [{
        sessionKey: 'agent:pi:s1',
        generation: 1,
        historical: true,
        notification: {
          sessionId: 'agent:pi:s1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'consult-answer',
            content: { type: 'text', text: 'Durable consult answer' },
          },
        },
      }],
    });

    expect(connection.newSession).toHaveBeenCalledWith({
      cwd: '/repo',
      mcpServers: [],
      _meta: { sessionKey: 'agent:pi:s1', prefixCwd: true },
    });
    expect(connection.loadSession).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, expect.anything());
  });

  it('routes fresh-session prompts through the ACP session id returned by session/new', async () => {
    const { service, connection } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:session-123', workspaceRoot: '/repo', cwd: '/repo', createIfMissing: true });
    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:session-123',
      cwd: '/repo',
      message: 'hello',
      messageId: 'msg-1',
    })).resolves.toEqual({ success: true, generation: 1 });

    expect(connection.prompt).toHaveBeenCalledWith({
      sessionId: 'acp-session-1',
      prompt: [{ type: 'text', text: 'hello' }],
      _meta: { sessionKey: 'agent:pi:session-123', prefixCwd: true, messageId: 'msg-1' },
    });
  });

  it.each([
    '/status',
    '  /compact',
  ])('disables the ACP cwd prefix for %s', async (message) => {
    const { service, connection } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:session-123', workspaceRoot: '/repo', cwd: '/repo', createIfMissing: true });
    await expect(service.sendPrompt({
      sessionKey: 'agent:pi:session-123',
      cwd: '/repo',
      message,
      messageId: 'msg-command',
    })).resolves.toEqual({ success: true, generation: 1 });

    expect(connection.prompt).toHaveBeenCalledWith({
      sessionId: 'acp-session-1',
      prompt: [{ type: 'text', text: message.trim() }],
      _meta: { sessionKey: 'agent:pi:session-123', prefixCwd: false, messageId: 'msg-command' },
    });
  });

  it('rewrites fresh-session ACP updates to the ClawX session key for the renderer', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:session-123', workspaceRoot: '/repo', cwd: '/repo', createIfMissing: true });
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

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'live', messageId: 'msg-live' });
    send.mockClear();
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'hello' },
        futureExtensionField: { retained: true },
      },
      _meta: { futureTopLevelMetadata: 'retained' },
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
          futureExtensionField: { retained: true },
        },
        _meta: { futureTopLevelMetadata: 'retained' },
      },
    });
  });

  it('keeps routing an in-flight prompt while another session is viewed and reactivates it without replay', async () => {
    const connection = createConnection();
    const prompt = createDeferred<{ stopReason: string }>();
    connection.prompt.mockReturnValueOnce(prompt.promise);
    const { service, send } = await createService(connection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    const sendPrompt = service.sendPrompt({
      sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'keep streaming', messageId: 'msg-user',
    });
    await vi.waitFor(() => expect(connection.prompt).toHaveBeenCalledTimes(1));

    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-assistant',
        content: { type: 'text', text: 'before switch ' },
      },
    } as never);
    await service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-assistant',
        content: { type: 'text', text: 'while away ' },
      },
    } as never);

    await expect(service.loadSession({
      sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo',
    })).resolves.toEqual({ success: true, generation: 1, resumedActivePrompt: true });
    await service.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-assistant',
        content: { type: 'text', text: 'after return' },
      },
    } as never);

    const routedChunks = send.mock.calls
      .filter(([channel, envelope]) => (
        channel === HOST_EVENT_CHANNELS.chat.acpSessionUpdate
        && envelope.sessionKey === 'agent:pi:s1'
        && envelope.notification.update.sessionUpdate === 'agent_message_chunk'
      ))
      .map(([, envelope]) => ({
        generation: envelope.generation,
        text: envelope.notification.update.content.text,
      }));
    expect(routedChunks).toEqual([
      { generation: 1, text: 'before switch ' },
      { generation: 1, text: 'while away ' },
      { generation: 1, text: 'after return' },
    ]);
    expect(connection.loadSession).toHaveBeenCalledTimes(2);

    prompt.resolve({ stopReason: 'end_turn' });
    await expect(sendPrompt).resolves.toEqual({ success: true, generation: 1 });
    await expect(service.loadSession({
      sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo',
    })).resolves.toEqual({ success: true, generation: 3 });
  });

  it('records ACP session load and forwarded update trace entries', async () => {
    const { clearAcpTraceForTests, getAcpTraceSnapshot } = await import('../../electron/services/acp-trace');
    clearAcpTraceForTests();
    const { service } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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
    const connection = createConnection();
    const prompt = createDeferred<{ stopReason: string }>();
    connection.prompt.mockReturnValueOnce(prompt.promise);
    const { service, send } = await createService(connection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    const sendPrompt = service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
    await vi.waitFor(() => expect(connection.prompt).toHaveBeenCalledTimes(1));
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
    prompt.resolve({ stopReason: 'end_turn' });
    await sendPrompt;
  });

  it('responds to an inactive live prompt permission with its original generation', async () => {
    const connection = createConnection();
    const prompt = createDeferred<{ stopReason: string }>();
    connection.prompt.mockReturnValueOnce(prompt.promise);
    const { service, send } = await createService(connection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    const sendPrompt = service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit' });
    await vi.waitFor(() => expect(connection.prompt).toHaveBeenCalledTimes(1));
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);
    const requestId = send.mock.calls.at(-1)?.[1].requestId;

    await service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    await expect(service.respondPermission({
      sessionKey: 'agent:pi:s1',
      requestId,
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })).resolves.toEqual({ success: true, generation: 1 });
    await expect(pending).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });

    prompt.resolve({ stopReason: 'end_turn' });
    await sendPrompt;
  });

  it('returns cancelled for permission requests from non-active sessions', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
    send.mockClear();
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);

    await expect(service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 2,
    });

    await expectCancelledSoon(pending);
  });

  it('cancels pending permission requests when reloading the same session', async () => {
    const { service, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
    send.mockClear();
    const pending = service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });

    await expectCancelledSoon(pending);
  });

  it('cancels permission requests received while session/load is in progress', async () => {
    const connection = createConnection();
    const load = createDeferred<unknown>();
    connection.loadSession.mockReturnValueOnce(load.promise);
    const { service, send } = await createService(connection);
    const loadPromise = service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await vi.waitFor(() => expect(connection.loadSession).toHaveBeenCalledTimes(1));
    send.mockClear();

    await expectCancelledSoon(service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-load', title: 'Unexpected load permission', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never));
    expect(send).not.toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpPermissionRequest, expect.anything());

    load.resolve({});
    await loadPromise;
  });

  it('cancels permission requests after load until the current session starts a prompt', async () => {
    const { service, send } = await createService();
    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    send.mockClear();

    await expectCancelledSoon(service.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-handoff', title: 'Late load permission', status: 'pending' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    } as never));
    expect(send).not.toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpPermissionRequest, expect.anything());
  });

  it('cancels pending permission requests and drops the connection when the ACP child exits', async () => {
    const firstConnection = createConnection();
    const { service, child } = await createSpawnedService(firstConnection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
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
    await service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    expect(childProcessMock.fork).toHaveBeenCalledTimes(2);
    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
  });

  it('cancels pending permission requests and drops the connection when the ACP child errors', async () => {
    const firstConnection = createConnection();
    const { service, child } = await createSpawnedService(firstConnection);

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
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
    await service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    expect(childProcessMock.fork).toHaveBeenCalledTimes(2);
    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
  });

  it('shares one initialize call for simultaneous session loads', async () => {
    const connection = createConnection();
    const initialized = createDeferred<ReturnType<typeof createInitResponse>>();
    connection.initialize.mockReturnValue(initialized.promise);
    const { service } = await createService(connection);

    const firstLoad = service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    const secondLoad = service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });

    await Promise.resolve();
    expect(connection.initialize).toHaveBeenCalledTimes(1);

    initialized.resolve(createInitResponse());
    await expect(Promise.all([firstLoad, secondLoad])).resolves.toHaveLength(2);
  });

  it('keeps replacement initialization single-flight when a family query loses its startup child', async () => {
    const firstConnection = createConnection();
    const firstInitialized = createDeferred<ReturnType<typeof createInitResponse>>();
    firstConnection.initialize.mockReturnValue(firstInitialized.promise);
    const { service, child: firstChild } = await createSpawnedService(firstConnection);
    const firstFamily = service.getSessionFamily({ sessionKey: 'agent:main:parent' });
    await vi.waitFor(() => expect(firstConnection.initialize).toHaveBeenCalledTimes(1));

    const secondConnection = createConnection();
    const secondInitialized = createDeferred<ReturnType<typeof createInitResponse>>();
    secondConnection.initialize.mockReturnValue(secondInitialized.promise);
    acpSdkMock.state.connectionForSpawn = secondConnection;
    childProcessMock.state.child = createFakeChild();

    firstChild.emit('exit', 1);
    const replacementFamily = service.getSessionFamily({ sessionKey: 'agent:main:parent' });
    await expect(firstFamily).resolves.toEqual({
      success: false,
      current: null,
      children: [],
      error: 'ACP process exited with code 1',
    });
    const replacementLoad = service.loadSession({
      sessionKey: 'agent:main:loaded',
      workspaceRoot: '/workspace',
      cwd: '/workspace',
    });
    await vi.waitFor(() => expect(secondConnection.initialize).toHaveBeenCalled());

    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
    secondInitialized.resolve(createInitResponse());
    await expect(replacementFamily).resolves.toEqual({
      success: true,
      current: null,
      children: [],
    });
    await expect(replacementLoad).resolves.toEqual({ success: true, generation: 1 });
    expect(secondConnection.initialize).toHaveBeenCalledTimes(1);
    expect(secondConnection.listSessions).toHaveBeenCalledTimes(1);
    expect(secondConnection.loadSession).toHaveBeenCalledWith({
      sessionId: 'agent:main:loaded',
      cwd: '/workspace',
      mcpServers: [],
    });
  });

  it('retains the owned startup retry when no replacement initialization wins the child-exit race', async () => {
    const firstConnection = createConnection();
    const firstInitialized = createDeferred<ReturnType<typeof createInitResponse>>();
    firstConnection.initialize.mockReturnValue(firstInitialized.promise);
    const { service, child: firstChild } = await createSpawnedService(firstConnection);
    const family = service.getSessionFamily({ sessionKey: 'agent:main:parent' });
    await vi.waitFor(() => expect(firstConnection.initialize).toHaveBeenCalledTimes(1));

    const retryConnection = createConnection();
    acpSdkMock.state.connectionForSpawn = retryConnection;
    childProcessMock.state.child = createFakeChild();
    firstChild.emit('exit', 1);

    await expect(family).resolves.toEqual({
      success: true,
      current: null,
      children: [],
    });
    await expect(service.loadSession({
      sessionKey: 'agent:main:loaded',
      workspaceRoot: '/workspace',
      cwd: '/workspace',
    })).resolves.toEqual({ success: true, generation: 1 });
    expect(childProcessMock.fork).toHaveBeenCalledTimes(2);
    expect(retryConnection.initialize).toHaveBeenCalledTimes(1);
    expect(retryConnection.listSessions).toHaveBeenCalledTimes(1);
    expect(retryConnection.loadSession).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping session loads on the shared ACP connection', async () => {
    const connection = createConnection();
    const firstLoad = createDeferred<unknown>();
    connection.loadSession
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce({});
    const { service } = await createService(connection);

    const first = service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await vi.waitFor(() => expect(connection.loadSession).toHaveBeenCalledTimes(1));
    const second = service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    await Promise.resolve();

    expect(connection.loadSession).toHaveBeenCalledTimes(1);
    firstLoad.resolve({});
    await expect(first).resolves.toMatchObject({ success: true, generation: 1 });
    await expect(second).resolves.toMatchObject({ success: true, generation: 2 });
    expect(connection.loadSession).toHaveBeenCalledTimes(2);
  });

  it('returns session/load replay as one batch without forwarding incremental events', async () => {
    const connection = createConnection();
    const { service, send } = await createService(connection);
    connection.loadSession.mockImplementationOnce(async () => {
      await service.client.sessionUpdate({
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'history-message',
          content: { type: 'text', text: 'complete history' },
        },
      } as never);
      return {};
    });

    await expect(service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 1,
      sessionUpdates: [{
        sessionKey: 'agent:pi:s1',
        generation: 1,
        historical: true,
        notification: {
          sessionId: 'agent:pi:s1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'history-message',
            content: { type: 'text', text: 'complete history' },
          },
        },
      }],
    });
    expect(send).not.toHaveBeenCalledWith(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, expect.anything());
  });

  it('filters old-session updates received before session/new returns its ACP id', async () => {
    const connection = createConnection();
    const { service } = await createService(connection);
    connection.newSession.mockImplementationOnce(async () => {
      await service.client.sessionUpdate({
        sessionId: 'acp-old-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'stale-message',
          content: { type: 'text', text: 'old session tail' },
        },
      } as never);
      return { sessionId: 'acp-new-session' };
    });

    await expect(service.loadSession({
      sessionKey: 'agent:pi:session-new',
      workspaceRoot: '/repo',
      cwd: '/repo',
      createIfMissing: true,
    })).resolves.toEqual({ success: true, generation: 1 });
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
    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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

    const loadPromise = service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
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

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    connection.loadSession.mockRejectedValueOnce(new Error('load failed'));

    await expect(service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' })).resolves.toEqual({
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

  it.each([
    { createIfMissing: false, operation: 'loadSession' as const },
    { createIfMissing: true, operation: 'newSession' as const },
  ])('commits a canonical access grant only after $operation resolves', async ({ createIfMissing, operation }) => {
    const parent = mkdtempSync(join(tmpdir(), 'clawx-acp-service-access-'));
    const workspaceRoot = join(parent, 'workspace');
    const executionCwd = join(workspaceRoot, 'nested');
    mkdirSync(executionCwd, { recursive: true });
    const connection = createConnection();
    const pending = createDeferred<unknown>();
    connection[operation].mockReturnValueOnce(pending.promise);

    try {
      const { AcpSessionAccessRegistry } = await import('../../electron/services/acp-session-access-registry');
      const accessRegistry = new AcpSessionAccessRegistry();
      const { service } = await createService(connection, accessRegistry);
      const load = service.loadSession({
        sessionKey: 'agent:pi:grant',
        workspaceRoot: join(workspaceRoot, '.'),
        cwd: join(executionCwd, '.'),
        ...(createIfMissing ? { createIfMissing: true } : {}),
      });
      await vi.waitFor(() => expect(connection[operation]).toHaveBeenCalledTimes(1));

      expect(accessRegistry.get('agent:pi:grant', 1)).toBeNull();
      pending.resolve(createIfMissing ? { sessionId: 'created-session' } : {});
      await expect(load).resolves.toEqual({ success: true, generation: 1 });

      expect(accessRegistry.get('agent:pi:grant', 1)).toEqual({
        sessionKey: 'agent:pi:grant',
        generation: 1,
        workspaceRoot: realpathSync(workspaceRoot),
        executionCwd: realpathSync(executionCwd),
      });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('restores the previous access grant when a later load fails', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'clawx-acp-service-rollback-'));
    const firstRoot = join(parent, 'first');
    const secondRoot = join(parent, 'second');
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);

    try {
      const { AcpSessionAccessRegistry } = await import('../../electron/services/acp-session-access-registry');
      const accessRegistry = new AcpSessionAccessRegistry();
      const { service, connection } = await createService(createConnection(), accessRegistry);
      await service.loadSession({ sessionKey: 'agent:pi:first', workspaceRoot: firstRoot, cwd: firstRoot });
      connection.loadSession.mockRejectedValueOnce(new Error('load failed'));

      await expect(service.loadSession({
        sessionKey: 'agent:pi:second', workspaceRoot: secondRoot, cwd: secondRoot,
      })).resolves.toEqual({ success: false, error: 'load failed' });

      expect(accessRegistry.get('agent:pi:first', 1)).toEqual({
        sessionKey: 'agent:pi:first',
        generation: 1,
        workspaceRoot: realpathSync(firstRoot),
        executionCwd: realpathSync(firstRoot),
      });
      expect(accessRegistry.get('agent:pi:second', 2)).toBeNull();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects a prompt cwd that differs from the registered execution cwd', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'clawx-acp-service-prompt-cwd-'));

    try {
      const { AcpSessionAccessRegistry } = await import('../../electron/services/acp-session-access-registry');
      const { service, connection } = await createService(createConnection(), new AcpSessionAccessRegistry());
      await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot, cwd: workspaceRoot });

      await expect(service.sendPrompt({
        sessionKey: 'agent:pi:s1',
        cwd: join(workspaceRoot, 'replacement'),
        message: 'wrong cwd',
      })).resolves.toEqual({
        success: false,
        error: 'ACP prompt cwd does not match the registered execution cwd',
      });
      expect(connection.prompt).not.toHaveBeenCalled();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('continues with a queued session load after the older load fails', async () => {
    const { service, connection, send, accessRegistry } = await createService();
    const firstLoad = createDeferred<unknown>();

    connection.loadSession
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce({});

    const older = service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await vi.waitFor(() => expect(connection.loadSession).toHaveBeenCalledTimes(1));

    const newer = service.loadSession({ sessionKey: 'agent:pi:s2', workspaceRoot: '/repo', cwd: '/repo' });
    firstLoad.reject(new Error('older load failed'));
    await expect(older).resolves.toEqual({ success: false, error: 'older load failed' });
    await expect(newer).resolves.toEqual({ success: true, generation: 1 });
    expect(accessRegistry.get('agent:pi:s2', 1)).toEqual({
      sessionKey: 'agent:pi:s2',
      generation: 1,
      workspaceRoot: '/repo',
      executionCwd: '/repo',
    });

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
      generation: 1,
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

  it.each(['success', 'failure'] as const)(
    'serializes deferred access preparation and keeps the later grant after older %s',
    async (olderOutcome) => {
      type AccessContext = {
        sessionKey: string;
        generation: number;
        workspaceRoot: string;
        executionCwd: string;
      };
      const preparations: Array<{
        input: AccessContext;
        deferred: ReturnType<typeof createDeferred<AccessContext>>;
      }> = [];
      let activeGrant: AccessContext | null = null;
      const accessRegistry = {
        prepareGrant: vi.fn((input: AccessContext) => {
          const deferred = createDeferred<AccessContext>();
          preparations.push({ input, deferred });
          return deferred.promise;
        }),
        snapshot: vi.fn(() => activeGrant ? { ...activeGrant } : null),
        commitGrant: vi.fn((context: AccessContext) => { activeGrant = { ...context }; }),
        restore: vi.fn((snapshot: AccessContext | null) => { activeGrant = snapshot ? { ...snapshot } : null; }),
        get: vi.fn((sessionKey: string, generation: number) => (
          activeGrant?.sessionKey === sessionKey && activeGrant.generation === generation
            ? { ...activeGrant }
            : null
        )),
      };
      const connection = createConnection();
      const { service } = await createService(connection, accessRegistry);

      const olderLoad = service.loadSession({
        sessionKey: 'agent:pi:older', workspaceRoot: '/older', cwd: '/older',
      });
      await vi.waitFor(() => expect(preparations).toHaveLength(1));
      const laterLoad = service.loadSession({
        sessionKey: 'agent:pi:later', workspaceRoot: '/later', cwd: '/later',
      });
      await Promise.resolve();
      expect(preparations).toHaveLength(1);

      if (olderOutcome === 'success') {
        preparations[0].deferred.resolve(preparations[0].input);
        await expect(olderLoad).resolves.toEqual({ success: true, generation: 1 });
      } else {
        preparations[0].deferred.reject(new Error('older preparation failed'));
        await expect(olderLoad).resolves.toEqual({
          success: false,
          error: 'older preparation failed',
        });
      }

      await vi.waitFor(() => expect(preparations).toHaveLength(2));
      const laterGeneration = olderOutcome === 'success' ? 2 : 1;
      expect(preparations.map(({ input }) => input.generation)).toEqual([1, laterGeneration]);
      preparations[1].deferred.resolve(preparations[1].input);
      await expect(laterLoad).resolves.toEqual({ success: true, generation: laterGeneration });

      expect(accessRegistry.get('agent:pi:later', laterGeneration)).toEqual({
        sessionKey: 'agent:pi:later',
        generation: laterGeneration,
        workspaceRoot: '/later',
        executionCwd: '/later',
      });
      expect(accessRegistry.get('agent:pi:older', 1)).toBeNull();
      expect(connection.loadSession).toHaveBeenCalledWith({
        sessionId: 'agent:pi:later',
        cwd: '/later',
        mcpServers: [],
      });
      expect(accessRegistry.restore).not.toHaveBeenCalled();
    },
  );

  it('cancels the ACP session and resolves pending permission requests for that session', async () => {
    const { service, connection, send } = await createService();

    await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
    await service.sendPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'edit the file' });
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

      await service.loadSession({ sessionKey: 'agent:pi:s1', workspaceRoot: '/repo', cwd: '/repo' });
      await expect(service.sendPrompt({
        sessionKey: 'agent:pi:s1',
        cwd: '/repo',
        message: 'Inspect attachments',
        messageId: 'msg-user-1',
        media: [
          { filePath: imagePath, stagingId: 'staged-image', mimeType: 'image/png', fileName: 'image.png' },
          { filePath, stagingId: 'staged-notes', mimeType: 'text/plain', fileName: 'notes.txt' },
        ],
      })).resolves.toEqual({ success: true, generation: 1 });

      expect(connection.prompt).toHaveBeenCalledWith({
        sessionId: 'agent:pi:s1',
        prompt: [
          { type: 'text', text: 'Inspect attachments' },
          {
            type: 'image',
            data: Buffer.from('fake-image').toString('base64'),
            mimeType: 'image/png',
            uri: imagePath,
            _meta: { clawx: { stagingId: 'staged-image', fileName: 'image.png' } },
          },
          {
            type: 'resource_link',
            uri: filePath,
            name: 'notes.txt',
            mimeType: 'text/plain',
            _meta: { clawx: { stagingId: 'staged-notes' } },
          },
        ],
        _meta: { sessionKey: 'agent:pi:s1', prefixCwd: true, messageId: 'msg-user-1' },
      });
    } finally {
      rmSync(imagePath, { force: true });
      rmSync(filePath, { force: true });
    }
  });
});
