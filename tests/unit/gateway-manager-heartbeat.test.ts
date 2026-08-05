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

describe('GatewayManager heartbeat observability', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('records consecutive heartbeat misses without terminating or restarting Gateway', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      gatewayReady: true,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();
    vi.advanceTimersByTime(300_000);

    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);
    expect(manager.getDiagnostics().lastHeartbeatTimeoutAt).toBe(Date.now());

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not schedule a delayed restart while initial gateway.ready is pending', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = true;
    (manager as unknown as { status: { state: string; port: number; connectedAt: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      connectedAt: Date.now(),
      gatewayReady: false,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();
    vi.advanceTimersByTime(600_000);

    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('resets heartbeat diagnostics when responsiveness recovers through an incoming message', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1, // WebSocket.OPEN
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
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();
    vi.advanceTimersByTime(300_000);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(0);
    expect(manager.getDiagnostics().lastAliveAt).toBe(Date.now());
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('keeps heartbeat misses observability-only on windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
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
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();
    vi.advanceTimersByTime(300_000);

    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
