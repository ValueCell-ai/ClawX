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

  it('keeps missed pongs diagnostic and notifies liveness only at the silence deadline', () => {
    const monitor = new GatewayConnectionMonitor();
    const sendPing = vi.fn();
    const onLivenessDeadline = vi.fn();

    monitor.startPing({
      sendPing,
      onLivenessDeadline,
      intervalMs: 100,
      timeoutMs: 50,
      silenceDeadlineMs: 500,
    });

    vi.advanceTimersByTime(100); // send ping #1
    vi.advanceTimersByTime(100); // miss #1, send ping #2
    vi.advanceTimersByTime(100); // miss #2, send ping #3
    vi.advanceTimersByTime(100); // miss #3, send ping #4
    expect(monitor.getConsecutiveMisses()).toBe(3);
    expect(onLivenessDeadline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onLivenessDeadline).toHaveBeenCalledTimes(1);
    expect(sendPing).toHaveBeenCalledTimes(5);
    monitor.clear();
  });

  it('reports each missed pong as diagnostic evidence without escalating', () => {
    const monitor = new GatewayConnectionMonitor();
    const onHeartbeatMiss = vi.fn();
    const onLivenessDeadline = vi.fn();

    monitor.startPing({
      sendPing: vi.fn(),
      onHeartbeatMiss,
      onLivenessDeadline,
      intervalMs: 100,
      timeoutMs: 50,
      silenceDeadlineMs: 500,
    });

    vi.advanceTimersByTime(1_000);

    expect(onHeartbeatMiss).toHaveBeenCalledTimes(9);
    expect(onLivenessDeadline).toHaveBeenCalledTimes(1);
    monitor.clear();
  });

  it.each(['pong', 'message'] as const)('resets the silence deadline after a %s signal', (reason) => {
    const monitor = new GatewayConnectionMonitor();
    const sendPing = vi.fn();
    const onLivenessDeadline = vi.fn();

    monitor.startPing({
      sendPing,
      onLivenessDeadline,
      intervalMs: 100,
      timeoutMs: 50,
      silenceDeadlineMs: 500,
    });

    vi.advanceTimersByTime(250);
    monitor.markAlive(reason);
    expect(monitor.getConsecutiveMisses()).toBe(0);

    vi.advanceTimersByTime(499);
    expect(onLivenessDeadline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLivenessDeadline).toHaveBeenCalledTimes(1);
    monitor.clear();
  });
});
