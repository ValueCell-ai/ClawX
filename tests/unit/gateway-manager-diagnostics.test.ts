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

describe('GatewayManager diagnostics', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T00:00:00.000Z'));
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('updates diagnostics on gateway message, rpc success/timeout, and socket close', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    // recordRpcFailure() only counts while the gateway is running, ready,
    // and outside the 45s startup grace — mirror that in the test.
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt: Date.now() - 60_000,
      gatewayReady: true,
    };

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'event',
      event: 'gateway.ready',
      payload: {},
    });
    expect(manager.getDiagnostics().lastAliveAt).toBe(Date.now());

    const successPromise = manager.rpc<{ ok: boolean }>('chat.history', {}, 1000);
    const successRequestId = Array.from(
      (manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.keys(),
    )[0];
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'res',
      id: successRequestId,
      ok: true,
      payload: { ok: true },
    });
    await expect(successPromise).resolves.toEqual({ ok: true });
    expect(manager.getDiagnostics().lastRpcSuccessAt).toBe(Date.now());
    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);

    const failurePromise = manager.rpc('chat.history', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(failurePromise).rejects.toThrow('RPC timeout: chat.history');

    const diagnostics = manager.getDiagnostics();
    expect(diagnostics.lastRpcFailureAt).toBe(Date.now());
    expect(diagnostics.lastRpcFailureMethod).toBe('chat.history');
    expect(diagnostics.consecutiveRpcFailures).toBe(1);

    (manager as unknown as { recordSocketClose: (code: number) => void }).recordSocketClose(1006);
    expect(manager.getDiagnostics().lastSocketCloseAt).toBe(Date.now());
    expect(manager.getDiagnostics().lastSocketCloseCode).toBe(1006);
  });

  it('does not count gateway-declared rpc errors as transport failures', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt: Date.now() - 60_000,
      gatewayReady: true,
    };

    const failurePromise = manager.rpc('channels.status', {}, 1000);
    const failureRequestId = Array.from(
      (manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.keys(),
    )[0];
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'res',
      id: failureRequestId,
      ok: false,
      error: { message: 'channel unavailable' },
    });
    await expect(failurePromise).rejects.toThrow('channel unavailable');

    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);

    const health = buildGatewayHealthSummary({
      status: manager.getStatus(),
      diagnostics: manager.getDiagnostics(),
      platform: process.platform,
    });
    expect(health.reasons).not.toContain('rpc_timeout');
  });

  it('does not count RPC timeouts against health while gateway is still starting', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    // Simulate the gateway still coming up: state=starting, no gatewayReady.
    (manager as unknown as { status: { state: string; port: number; gatewayReady?: boolean } }).status = {
      state: 'starting',
      port: 18789,
      gatewayReady: false,
    };

    const failurePromise = manager.rpc('channels.status', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(failurePromise).rejects.toThrow('RPC timeout: channels.status');

    // Timeout must be recorded (lastRpcFailureAt) but NOT counted toward
    // consecutiveRpcFailures, because the gateway was not yet running.
    const diagnostics = manager.getDiagnostics();
    expect(diagnostics.lastRpcFailureAt).toBe(Date.now());
    expect(diagnostics.consecutiveRpcFailures).toBe(0);

    const health = buildGatewayHealthSummary({
      status: manager.getStatus(),
      diagnostics: manager.getDiagnostics(),
      platform: process.platform,
    });
    expect(health.reasons).not.toContain('rpc_timeout');
  });

  it('does not count RPC timeouts within the 45s post-connect grace window', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    // Freshly connected gateway — within the 45s grace window.
    (manager as unknown as { status: { state: string; port: number; gatewayReady?: boolean; connectedAt: number } }).status = {
      state: 'running',
      port: 18789,
      gatewayReady: true,
      connectedAt: Date.now() - 10_000,
    };

    const failurePromise = manager.rpc('channels.status', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(failurePromise).rejects.toThrow('RPC timeout: channels.status');

    // Within the startup grace window — counter should stay at zero.
    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);
  });

  it('infers gatewayReady=true on first successful RPC', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { status: { state: string; port: number; gatewayReady?: boolean } }).status = {
      state: 'running',
      port: 18789,
      gatewayReady: false,
    };

    const successPromise = manager.rpc<{ ok: boolean }>('sessions.list', {}, 1000);
    const id = Array.from(
      (manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.keys(),
    )[0];
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'res',
      id,
      ok: true,
      payload: { ok: true },
    });
    await expect(successPromise).resolves.toEqual({ ok: true });

    expect(manager.getStatus().gatewayReady).toBe(true);
  });

  it('defers windows heartbeat recovery during short stalls but restarts after prolonged silence', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    // Simulate a recent alive signal so the first heartbeat-timeout threshold
    // does *not* breach the 5-minute silence guard.
    (manager as unknown as { diagnostics: { lastAliveAt: number; consecutiveHeartbeatMisses: number; consecutiveRpcFailures: number } }).diagnostics = {
      lastAliveAt: Date.now(),
      consecutiveHeartbeatMisses: 0,
      consecutiveRpcFailures: 0,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();

    // First 5 misses occur over ~5 * 60s == 300s; all but the last tick still
    // land inside the 5-minute silence window so recovery should defer.
    vi.advanceTimersByTime(5 * 60_000);
    expect(restartSpy).not.toHaveBeenCalled();

    // Continue running without any inbound message: silence now clearly
    // exceeds 5 minutes, recovery must fire.
    vi.advanceTimersByTime(60_000);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    const health = buildGatewayHealthSummary({
      status: manager.getStatus(),
      diagnostics: manager.getDiagnostics(),
      platform: 'win32',
    });
    expect(health.state).not.toBe('healthy');

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
