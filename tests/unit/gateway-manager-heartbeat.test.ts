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

describe('GatewayManager heartbeat recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.doUnmock('@electron/gateway/ws-client');
    vi.useRealTimers();
  });

  function createRunningManager(manager: object, ownsProcess = true) {
    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };
    const internals = manager as {
      ws: typeof ws;
      ownsProcess: boolean;
      shouldReconnect: boolean;
      status: { state: string; port: number; gatewayReady: boolean };
      startPing: () => void;
      connectionMonitor: { clear: () => void };
    };
    internals.ws = ws;
    internals.ownsProcess = ownsProcess;
    internals.shouldReconnect = true;
    internals.status = { state: 'running', port: 18789, gatewayReady: true };
    internals.startPing();
    return { ws, internals };
  }

  it('keeps missed pongs diagnostic-only before the liveness deadline', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { ws, internals } = createRunningManager(manager);
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await vi.advanceTimersByTimeAsync(179_999);

    expect(ws.ping).toHaveBeenCalledTimes(2);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(1);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    internals.connectionMonitor.clear();
  });

  it('resets the deadline after an incoming Gateway frame', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { internals } = createRunningManager(manager);
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await vi.advanceTimersByTimeAsync(120_000);
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({ type: 'unknown' });

    await vi.advanceTimersByTimeAsync(179_999);
    expect(rpcSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(rpcSpy).toHaveBeenCalledWith('system-presence', {}, 5_000);
    internals.connectionMonitor.clear();
  });

  it('does not restart an owned Gateway when the deadline probe succeeds', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { internals } = createRunningManager(manager);
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await vi.advanceTimersByTimeAsync(180_000);

    expect(rpcSpy).toHaveBeenCalledWith('system-presence', {}, 5_000);
    expect(restartSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().recovery).toMatchObject({
      state: 'healthy',
      lastDeadlineProbeResult: 'succeeded',
    });
    internals.connectionMonitor.clear();
  });

  it('records a succeeded deadline probe when the real RPC response marks the Gateway alive', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
      send: vi.fn((request: string) => {
        const { id } = JSON.parse(request) as { id: string };
        queueMicrotask(() => {
          (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
            type: 'res',
            id,
            ok: true,
            payload: {},
          });
        });
      }),
    };
    const internals = manager as unknown as {
      ws: typeof ws;
      ownsProcess: boolean;
      shouldReconnect: boolean;
      status: { state: string; port: number; gatewayReady: boolean };
      startPing: () => void;
      connectionMonitor: { clear: () => void };
    };
    internals.ws = ws;
    internals.ownsProcess = true;
    internals.shouldReconnect = true;
    internals.status = { state: 'running', port: 18789, gatewayReady: true };
    internals.startPing();

    await vi.advanceTimersByTimeAsync(180_000);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().recovery).toMatchObject({
      state: 'healthy',
      lastDeadlineProbeResult: 'succeeded',
    });
    internals.connectionMonitor.clear();
  });

  it('restarts an owned Gateway exactly once after a failed deadline probe', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { internals } = createRunningManager(manager);
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: system-presence'));

    await vi.advanceTimersByTimeAsync(180_000);

    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().recovery).toMatchObject({
      state: 'restart-executing',
      lastDeadlineProbeResult: 'failed',
      escalationReason: 'deadline-probe-timeout',
      externallyManaged: false,
    });
    internals.connectionMonitor.clear();
  });

  it('keeps a failed owned-process escalation pending through restart cooldown', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { internals } = createRunningManager(manager);
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: system-presence'));
    await vi.advanceTimersByTimeAsync(179_000);
    (internals as unknown as {
      restartGovernor: { recordExecuted: (now: number) => void };
    }).restartGovernor.recordExecuted(Date.now());

    await vi.advanceTimersByTimeAsync(1_000);
    expect(restartSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(restartSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(restartSpy).toHaveBeenCalledTimes(1);
    internals.connectionMonitor.clear();
  });

  it('uses guarded transport reconnect without stopping or restarting an external Gateway', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const { ws, internals } = createRunningManager(manager, false);
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const stopSpy = vi.spyOn(manager, 'stop').mockResolvedValue();
    const reconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: system-presence'));

    await vi.advanceTimersByTimeAsync(180_000);

    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(reconnectSpy).toHaveBeenCalledWith('transport');
    expect(restartSpy).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().recovery).toMatchObject({
      state: 'external-unavailable',
      externallyManaged: true,
      escalationReason: 'deadline-probe-timeout',
    });
    internals.connectionMonitor.clear();
  });

  it('ignores a synchronously closed superseded external socket before scheduling transport-only reconnect', async () => {
    let closeFirstSocket: ((code: number) => void) | undefined;
    const firstSocket = {
      readyState: 1,
      ping: vi.fn(),
      on: vi.fn(),
      terminate: vi.fn(() => closeFirstSocket?.(1006)),
    };
    const replacementSocket = {
      readyState: 1,
      ping: vi.fn(),
      on: vi.fn(),
      terminate: vi.fn(),
    };
    let connectionAttempts = 0;
    vi.doMock('@electron/gateway/ws-client', () => ({
      connectGatewaySocket: vi.fn(async (options: {
        onHandshakeComplete: (socket: typeof firstSocket) => void;
        onCloseAfterHandshake: (code: number) => void;
      }) => {
        connectionAttempts += 1;
        if (connectionAttempts === 1) {
          closeFirstSocket = options.onCloseAfterHandshake;
          options.onHandshakeComplete(firstSocket);
          return firstSocket;
        }
        options.onHandshakeComplete(replacementSocket);
        return replacementSocket;
      }),
      waitForGatewayReady: vi.fn(),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager({ baseDelay: 1, maxDelay: 1 });
    const internals = manager as unknown as {
      ownsProcess: boolean;
      shouldReconnect: boolean;
      connect: (port: number) => Promise<void>;
      connectionMonitor: { clear: () => void };
    };
    internals.ownsProcess = false;
    internals.shouldReconnect = true;
    const startSpy = vi.spyOn(manager, 'start').mockResolvedValue();
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: system-presence'));

    await internals.connect(18789);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(firstSocket.terminate).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().recovery).toMatchObject({
      state: 'external-unavailable',
      escalationReason: 'deadline-probe-timeout',
    });
    expect(startSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(connectionAttempts).toBe(2);
    expect(startSpy).not.toHaveBeenCalled();
    internals.connectionMonitor.clear();
  });
});
