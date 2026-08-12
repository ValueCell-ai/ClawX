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

  it('restarts only after four consecutive heartbeat misses', async () => {
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
    vi.advanceTimersByTime(299_999);

    expect(ws.ping).toHaveBeenCalledTimes(4);
    expect(
      (manager as unknown as { connectionMonitor: { getConsecutiveMisses: () => number } })
        .connectionMonitor.getConsecutiveMisses(),
    ).toBe(3);
    expect(restartSpy).not.toHaveBeenCalled();
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(0);

    vi.advanceTimersByTime(1);

    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);
    expect(manager.getDiagnostics().lastHeartbeatTimeoutAt).toBe(Date.now());

    vi.advanceTimersByTime(180_000);
    expect(restartSpy).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not restart after four misses when auto-reconnect is disabled', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { shouldReconnect: boolean }).shouldReconnect = false;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();

    (manager as unknown as { startPing: () => void }).startPing();
    vi.advanceTimersByTime(300_000);

    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('requires four new consecutive misses after responsiveness recovers', async () => {
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
    vi.advanceTimersByTime(240_000);
    expect(
      (manager as unknown as { connectionMonitor: { getConsecutiveMisses: () => number } })
        .connectionMonitor.getConsecutiveMisses(),
    ).toBe(3);

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(0);
    expect(manager.getDiagnostics().lastAliveAt).toBe(Date.now());

    vi.advanceTimersByTime(240_000);
    expect(restartSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(ws.terminate).not.toHaveBeenCalled();
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('restarts after four consecutive heartbeat misses on windows', async () => {
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
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(manager.getDiagnostics().consecutiveHeartbeatMisses).toBe(4);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
