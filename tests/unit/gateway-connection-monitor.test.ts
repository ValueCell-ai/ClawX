import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayConnectionMonitor } from '@electron/gateway/connection-monitor';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('GatewayConnectionMonitor heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  });

  it('terminates only after consecutive heartbeat misses reach threshold', () => {
    const monitor = new GatewayConnectionMonitor();
    const sendPing = vi.fn();
    const onHeartbeatTimeout = vi.fn();

    monitor.startPing({
      sendPing,
      onHeartbeatTimeout,
      intervalMs: 100,
      timeoutMs: 50,
      maxConsecutiveMisses: 3,
    });

    vi.advanceTimersByTime(100); // send ping #1
    vi.advanceTimersByTime(100); // miss #1, send ping #2
    vi.advanceTimersByTime(100); // miss #2, send ping #3
    expect(onHeartbeatTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100); // miss #3 -> timeout callback
    expect(onHeartbeatTimeout).toHaveBeenCalledTimes(1);
    expect(onHeartbeatTimeout).toHaveBeenCalledWith({ consecutiveMisses: 3, timeoutMs: 50 });
    expect(sendPing).toHaveBeenCalledTimes(3);
  });

  it('resets miss counter when alive signal is received', () => {
    const monitor = new GatewayConnectionMonitor();
    const sendPing = vi.fn();
    const onHeartbeatTimeout = vi.fn();

    monitor.startPing({
      sendPing,
      onHeartbeatTimeout,
      intervalMs: 100,
      timeoutMs: 50,
      maxConsecutiveMisses: 2,
    });

    vi.advanceTimersByTime(100); // send ping #1
    vi.advanceTimersByTime(100); // miss #1, send ping #2
    expect(monitor.getConsecutiveMisses()).toBe(1);

    monitor.markAlive('pong');
    expect(monitor.getConsecutiveMisses()).toBe(0);

    vi.advanceTimersByTime(100); // send ping #3
    vi.advanceTimersByTime(100); // miss #1 again (reset confirmed)
    expect(monitor.getConsecutiveMisses()).toBe(1);
    expect(onHeartbeatTimeout).not.toHaveBeenCalled();
  });
});
