import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsState = vi.hoisted(() => ({
  sockets: [] as unknown[],
  MockWebSocket: class MockWebSocket {
    readonly sentFrames: string[] = [];
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readyState = 1;
    readonly close = vi.fn((code = 1000, reason = '') => {
      this.readyState = 3;
      queueMicrotask(() => {
        this.emit('close', code, Buffer.from(String(reason)));
      });
    });
    readonly terminate = vi.fn(() => {
      this.readyState = 3;
    });
    readonly send = vi.fn((payload: string) => {
      this.sentFrames.push(payload);
    });

    constructor(public readonly url: string) {
      wsState.sockets.push(this);
    }

    on(event: string, callback: (...args: unknown[]) => void): this {
      const current = this.listeners.get(event) ?? new Set();
      current.add(callback);
      this.listeners.set(event, current);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const callback of this.listeners.get(event) ?? []) {
        callback(...args);
      }
    }

    emitOpen(): void {
      this.emit('open');
    }

    emitJsonMessage(message: unknown): void {
      this.emit('message', Buffer.from(JSON.stringify(message)));
    }
  },
}));

type MockWebSocket = InstanceType<typeof wsState.MockWebSocket>;

vi.mock('ws', () => ({
  default: wsState.MockWebSocket,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS,
  connectGatewaySocket,
  probeGatewayReady,
} from '@electron/gateway/ws-client';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function getLatestSocket(): MockWebSocket {
  const socket = wsState.sockets[wsState.sockets.length - 1];
  if (!socket) {
    throw new Error('Expected a mocked WebSocket instance');
  }
  return socket as MockWebSocket;
}

describe('connectGatewaySocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsState.sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    wsState.sockets.length = 0;
  });

  it('keeps the handshake alive long enough for slower gateway restart responses', async () => {
    const pendingRequests = new Map();
    const onHandshakeComplete = vi.fn();

    const connectionPromise = connectGatewaySocket({
      port: 18789,
      deviceIdentity: null,
      platform: 'win32',
      pendingRequests,
      getToken: vi.fn().mockResolvedValue('token-123'),
      onHandshakeComplete,
      onMessage: (message) => {
        if (typeof message !== 'object' || message === null) return;
        const msg = message as { type?: string; id?: string; ok?: boolean; payload?: unknown; error?: unknown };
        if (msg.type !== 'res' || typeof msg.id !== 'string') return;
        const pending = pendingRequests.get(msg.id);
        if (!pending) return;
        if (msg.ok === false || msg.error) {
          pending.reject(new Error(String(msg.error ?? 'Gateway request failed')));
          return;
        }
        pending.resolve(msg.payload ?? msg);
      },
      onCloseAfterHandshake: vi.fn(),
    });

    const socket = getLatestSocket();
    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-123' },
    });

    await flushMicrotasks();

    expect(socket.sentFrames).toHaveLength(1);
    const connectFrame = JSON.parse(socket.sentFrames[0]) as { id: string; method: string };
    expect(connectFrame.method).toBe('connect');
    expect(pendingRequests.size).toBe(1);

    await vi.advanceTimersByTimeAsync(GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS - 1_000);
    expect(onHandshakeComplete).not.toHaveBeenCalled();

    socket.emitJsonMessage({
      type: 'res',
      id: connectFrame.id,
      ok: true,
      payload: { protocol: 3 },
    });

    await expect(connectionPromise).resolves.toBe(socket);
    expect(onHandshakeComplete).toHaveBeenCalledWith(socket);
    expect(pendingRequests.size).toBe(0);
  });

  it('still fails when the connect response exceeds the configured timeout', async () => {
    const pendingRequests = new Map();

    const connectionPromise = connectGatewaySocket({
      port: 18789,
      deviceIdentity: null,
      platform: 'win32',
      pendingRequests,
      getToken: vi.fn().mockResolvedValue('token-123'),
      onHandshakeComplete: vi.fn(),
      onMessage: vi.fn(),
      onCloseAfterHandshake: vi.fn(),
      connectTimeoutMs: 1_000,
    });
    const connectionErrorPromise = connectionPromise.then(
      () => null,
      (error) => error,
    );

    const socket = getLatestSocket();
    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-123' },
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_001);

    const connectionError = await connectionErrorPromise;
    expect(connectionError).toBeInstanceOf(Error);
    expect((connectionError as Error).message).toBe('Connect handshake timeout');
    await flushMicrotasks();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(pendingRequests.size).toBe(0);
  });
});

describe('probeGatewayReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsState.sockets.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    wsState.sockets.length = 0;
  });

  it('resolves true when connect.challenge message is received', async () => {
    const probePromise = probeGatewayReady(18789, 5000);
    const socket = getLatestSocket();

    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'probe-nonce' },
    });

    await expect(probePromise).resolves.toBe(true);
    expect(socket.terminate).toHaveBeenCalled();
  });

  it('resolves false on WebSocket error', async () => {
    const probePromise = probeGatewayReady(18789, 5000);
    const socket = getLatestSocket();

    socket.emit('error', new Error('ECONNREFUSED'));

    await expect(probePromise).resolves.toBe(false);
    expect(socket.terminate).toHaveBeenCalled();
  });

  it('resolves false on timeout when no message is received', async () => {
    const probePromise = probeGatewayReady(18789, 2000);
    const socket = getLatestSocket();

    socket.emitOpen();
    // No message sent — just advance time past timeout
    await vi.advanceTimersByTimeAsync(2001);

    await expect(probePromise).resolves.toBe(false);
    expect(socket.terminate).toHaveBeenCalled();
  });

  it('resolves false when socket closes before challenge', async () => {
    const probePromise = probeGatewayReady(18789, 5000);
    const socket = getLatestSocket();

    socket.emitOpen();
    // Emit close directly (not through the mock's close() method)
    socket.emit('close', 1006, Buffer.from(''));

    await expect(probePromise).resolves.toBe(false);
    expect(socket.terminate).toHaveBeenCalled();
  });

  it('does NOT resolve true on plain open event (key behavioral change)', async () => {
    const probePromise = probeGatewayReady(18789, 500);
    const socket = getLatestSocket();

    // Only emit open — no connect.challenge message
    socket.emitOpen();

    // The old implementation would have resolved true here.
    // The new implementation waits for connect.challenge.
    await vi.advanceTimersByTimeAsync(501);

    await expect(probePromise).resolves.toBe(false);
  });

  it('uses terminate() instead of close() for cleanup to avoid Windows TIME_WAIT', async () => {
    const probePromise = probeGatewayReady(18789, 5000);
    const socket = getLatestSocket();

    socket.emitOpen();
    socket.emitJsonMessage({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-1' },
    });

    await expect(probePromise).resolves.toBe(true);

    // Must use terminate(), not close()
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('ignores non-challenge messages', async () => {
    const probePromise = probeGatewayReady(18789, 1000);
    const socket = getLatestSocket();

    socket.emitOpen();
    // Send a message that is NOT connect.challenge
    socket.emitJsonMessage({
      type: 'event',
      event: 'some.other.event',
      payload: {},
    });

    // Should still be waiting — not resolved yet
    await vi.advanceTimersByTimeAsync(1001);
    await expect(probePromise).resolves.toBe(false);
  });

  it('ignores malformed JSON messages', async () => {
    const probePromise = probeGatewayReady(18789, 1000);
    const socket = getLatestSocket();

    socket.emitOpen();
    // Send raw invalid JSON
    socket.emit('message', Buffer.from('not-json'));

    await vi.advanceTimersByTimeAsync(1001);
    await expect(probePromise).resolves.toBe(false);
  });
});
