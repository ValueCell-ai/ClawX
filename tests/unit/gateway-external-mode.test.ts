import { beforeEach, describe, expect, it, vi } from 'vitest';

const wsState = vi.hoisted(() => ({
  sockets: [] as Array<{ url: string; close: () => void; emit: (event: string, ...args: unknown[]) => void }>,
  MockWebSocket: class MockWebSocket {
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readyState = 1;
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
    close(): void {
      this.readyState = 3;
      queueMicrotask(() => this.emit('close', 1000, Buffer.from('')));
    }
    terminate(): void {
      this.readyState = 3;
    }
    send(): void {}
  },
}));

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

vi.mock('@electron/utils/runtime-flags', () => ({
  isGatewaySpawnEnabled: () => false,
}));

describe('gateway external mode', () => {
  beforeEach(() => {
    vi.resetModules();
    wsState.sockets.length = 0;
  });

  it('connects to the exact external Gateway URL without forcing /ws', async () => {
    const { connectGatewaySocket } = await import('@electron/gateway/ws-client');

    const pendingRequests = new Map();
    const connection = connectGatewaySocket({
      port: 18789,
      wsUrl: 'ws://127.0.0.1:4000/gateway',
      deviceIdentity: null,
      platform: 'linux',
      pendingRequests,
      getToken: async () => 'token',
      onHandshakeComplete: vi.fn(),
      onMessage: vi.fn(),
      onCloseAfterHandshake: vi.fn(),
      challengeTimeoutMs: 10,
      connectTimeoutMs: 10,
    });

    const socket = wsState.sockets[0];
    expect(socket?.url).toBe('ws://127.0.0.1:4000/gateway');
    expect(socket?.url).not.toContain('/ws');

    socket?.close();
    await expect(connection).rejects.toBeInstanceOf(Error);
  });

  it('blocks managed Gateway spawning when spawn is disabled', async () => {
    const { launchGatewayProcess } = await import('@electron/gateway/process-launcher');

    await expect(launchGatewayProcess({
      port: 18789,
      launchContext: {
        appSettings: {} as never,
        openclawDir: '/tmp/clawx-openclaw',
        entryScript: '/tmp/clawx-openclaw/openclaw.mjs',
        gatewayArgs: [],
        forkEnv: {},
        mode: 'dev',
        binPathExists: false,
        loadedProviderKeyCount: 0,
        proxySummary: 'disabled',
        channelStartupSummary: 'none',
      },
      sanitizeSpawnArgs: (args) => args,
      getCurrentState: () => 'starting',
      getShouldReconnect: () => false,
      onStderrLine: vi.fn(),
      onSpawn: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    })).rejects.toThrow('Gateway spawning is disabled in external gateway / safe mode');
  });
});
