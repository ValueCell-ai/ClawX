import { beforeEach, describe, expect, it, vi } from 'vitest';

const telemetry = vi.hoisted(() => ({
  trackMetric: vi.fn(),
  captureTelemetryEvent: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/utils/telemetry', () => ({
  trackMetric: (...args: unknown[]) => telemetry.trackMetric(...args),
  captureTelemetryEvent: (...args: unknown[]) => telemetry.captureTelemetryEvent(...args),
}));

vi.mock('posthog-node', () => ({
  PostHog: class PostHog {},
}));

vi.mock('node-machine-id', () => ({
  machineIdSync: () => 'test-machine-id',
}));

describe('GatewayManager start result tracking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));
  });

  it('returns ignored result when start is already in progress', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const internals = manager as unknown as {
      startLock: boolean;
      start: () => Promise<{ outcome: 'started' | 'already-running' | 'ignored' }>;
    };

    internals.startLock = true;
    await expect(internals.start()).resolves.toEqual({ outcome: 'ignored' });
  });

  it('does not mark reconnect as success when auto-reconnect start is ignored', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const internals = manager as unknown as {
      reconnectAttempts: number;
      reconnectTimer: NodeJS.Timeout | null;
      isAutoReconnectStart: boolean;
      shouldReconnect: boolean;
      lastRestartAt: number;
      status: { state: string; port: number };
      start: () => Promise<{ outcome: 'started' | 'already-running' | 'ignored' }>;
      scheduleReconnect: () => void;
      reconnectSuccessTotal: number;
      reconnectAttemptsTotal: number;
    };

    internals.shouldReconnect = true;
    internals.reconnectAttempts = 0;
    internals.reconnectTimer = null;
    internals.lastRestartAt = Date.now() - 10_000;
    internals.status = { state: 'stopped', port: 18789 };

    vi.spyOn(manager, 'start').mockResolvedValueOnce({ outcome: 'ignored' });

    internals.scheduleReconnect();
    expect(internals.reconnectTimer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    expect(telemetry.trackMetric).not.toHaveBeenCalledWith(
      'gateway.reconnect',
      expect.objectContaining({ outcome: 'success' }),
    );
    expect(internals.reconnectAttemptsTotal).toBe(1);
    expect(internals.reconnectSuccessTotal).toBe(0);
  });
});
