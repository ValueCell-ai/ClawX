// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GatewayManager restart recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.doUnmock('@electron/gateway/ws-client');
    vi.doUnmock('@electron/gateway/process-launcher');
    vi.doUnmock('@electron/gateway/config-sync');
    vi.useRealTimers();
  });

  it('re-enables auto-reconnect when start() fails during restart', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    // Expose private members for testing
    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
      stop: () => Promise<void>;
      start: () => Promise<void>;
    };

    // Set the manager into a state where restart can proceed:
    // - state must not be 'starting' or 'reconnecting' (would defer restart)
    // - startLock must be false
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to just reset flags (simulates normal stop)
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to fail (simulates the race condition where gateway
    // is reachable but not attachable after in-process restart)
    vi.spyOn(manager, 'start').mockRejectedValue(
      new Error('WebSocket closed before handshake: unknown'),
    );

    // Spy on scheduleReconnect
    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    // Perform the restart - it should throw because start() fails
    await expect(manager.restart()).rejects.toThrow(
      'WebSocket closed before handshake: unknown',
    );

    // KEY ASSERTION: After start() fails in restart(), shouldReconnect
    // must be re-enabled so the gateway can self-heal
    expect(internals.shouldReconnect).toBe(true);
    expect(scheduleReconnectSpy).toHaveBeenCalled();
  });

  it('does not schedule extra reconnect when restart succeeds', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
    };

    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to reset flags
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to succeed
    vi.spyOn(manager, 'start').mockImplementation(async () => {
      internals.shouldReconnect = true;
      internals.status = { state: 'running', port: 18789 };
    });

    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    await manager.restart();

    // scheduleReconnect should NOT have been called by the catch block
    // (it may be called from other paths, but not the restart-recovery catch)
    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
  });

  it('cancels deadline recovery on a code-1012 socket reload without restarting the owned process', async () => {
    let onCloseAfterHandshake: ((code: number) => void) | undefined;
    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };
    vi.doMock('@electron/gateway/ws-client', () => ({
      connectGatewaySocket: vi.fn(async (options: {
        onHandshakeComplete: (socket: typeof ws) => void;
        onCloseAfterHandshake: (code: number) => void;
      }) => {
        onCloseAfterHandshake = options.onCloseAfterHandshake;
        options.onHandshakeComplete(ws);
        return ws;
      }),
      waitForGatewayReady: vi.fn(),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      ownsProcess: boolean;
      connect: (port: number) => Promise<void>;
      scheduleReconnect: () => void;
      connectionMonitor: { clear: () => void };
    };
    internals.ownsProcess = true;
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await internals.connect(18789);
    onCloseAfterHandshake?.(1012);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    internals.connectionMonitor.clear();
  });

  it('cancels deadline recovery when an owned process exits', async () => {
    let onExit: ((child: unknown, code: number | null) => void) | undefined;
    const child = { pid: 42 };
    vi.doMock('@electron/gateway/config-sync', () => ({
      prepareGatewayLaunchContext: vi.fn(async () => ({})),
    }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: {
        onExit: (exitedChild: unknown, code: number | null) => void;
      }) => {
        onExit = options.onExit;
        return { child, lastSpawnSummary: 'test' };
      }),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      startProcess: () => Promise<void>;
      recoveryController: { start: () => void };
      scheduleReconnect: () => void;
    };
    internals.status = { state: 'running', port: 18789 };
    internals.recoveryController.start();
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await internals.startProcess();
    onExit?.(child, 1);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
  });
});
