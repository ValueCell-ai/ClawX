import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  });

  it('terminates stale socket only after 3 consecutive heartbeat misses', async () => {
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

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(120_000);

    expect(ws.ping).toHaveBeenCalledTimes(3);
    expect(ws.terminate).toHaveBeenCalledTimes(1);

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });

  it('does not terminate when heartbeat is recovered by incoming messages', async () => {
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

    (manager as unknown as { startPing: () => void }).startPing();

    vi.advanceTimersByTime(30_000); // ping #1
    vi.advanceTimersByTime(30_000); // miss #1 + ping #2
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage('alive');

    vi.advanceTimersByTime(30_000); // recovered, ping #3
    vi.advanceTimersByTime(30_000); // miss #1 + ping #4
    vi.advanceTimersByTime(30_000); // miss #2 + ping #5

    expect(ws.terminate).not.toHaveBeenCalled();

    (manager as unknown as { connectionMonitor: { clear: () => void } }).connectionMonitor.clear();
  });
});
