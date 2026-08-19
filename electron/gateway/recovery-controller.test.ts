// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GatewayRecoveryController,
  type GatewayRecoveryControllerOptions,
} from './recovery-controller';
import { GATEWAY_LIVENESS_DEADLINE_MS } from './recovery-budget';

function createController(overrides: Partial<GatewayRecoveryControllerOptions> = {}) {
  const requestDeadlineProbe = vi.fn().mockResolvedValue(undefined);
  const requestOwnedProcessEscalation = vi.fn();
  const requestExternalTransportReconnect = vi.fn();
  const controller = new GatewayRecoveryController({
    isExternallyManaged: () => false,
    requestDeadlineProbe,
    requestOwnedProcessEscalation,
    requestExternalTransportReconnect,
    ...overrides,
  });

  return {
    controller,
    requestDeadlineProbe,
    requestOwnedProcessEscalation,
    requestExternalTransportReconnect,
  };
}

describe('GatewayRecoveryController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules one deadline probe from the last trusted liveness signal', async () => {
    const { controller, requestDeadlineProbe } = createController();

    controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'healthy',
      lastAliveAt: Date.now(),
      deadlineAt: Date.now() + GATEWAY_LIVENESS_DEADLINE_MS,
    });

    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS - 1);
    expect(requestDeadlineProbe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(requestDeadlineProbe).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('resets the deadline for every trusted liveness signal', async () => {
    const { controller, requestDeadlineProbe } = createController();

    controller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    controller.recordAlive();

    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS - 1);
    expect(requestDeadlineProbe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(requestDeadlineProbe).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('returns to healthy after a successful deadline probe', async () => {
    const { controller } = createController();

    controller.start();
    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS);

    expect(controller.getSnapshot()).toMatchObject({
      state: 'healthy',
      lastAliveAt: Date.now(),
      lastDeadlineProbeAt: Date.now(),
      lastDeadlineProbeResult: 'succeeded',
    });
    controller.stop();
  });

  it('requests exactly one owned-process escalation after a failed deadline probe', async () => {
    const error = new Error('system-presence timed out');
    const {
      controller,
      requestOwnedProcessEscalation,
    } = createController({ requestDeadlineProbe: vi.fn().mockRejectedValue(error) });

    controller.start();
    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS);

    expect(requestOwnedProcessEscalation).toHaveBeenCalledTimes(1);
    expect(requestOwnedProcessEscalation).toHaveBeenCalledWith('deadline-probe-timeout');
    expect(controller.getSnapshot()).toMatchObject({
      state: 'restart-executing',
      lastDeadlineProbeResult: 'failed',
      lastDeadlineProbeError: 'deadline-probe-timeout',
      escalationReason: 'deadline-probe-timeout',
      externallyManaged: false,
    });

    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS);
    expect(requestOwnedProcessEscalation).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it('categorizes token-bearing probe errors without exposing them in diagnostics or callbacks', async () => {
    const secret = 'sk-live-very-secret-token-value';
    const {
      controller,
      requestOwnedProcessEscalation,
    } = createController({
      requestDeadlineProbe: vi.fn().mockRejectedValue(
        new Error(`RPC timeout: system-presence authorization=${secret}`),
      ),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS);

    const snapshot = controller.getSnapshot();
    expect(snapshot.lastDeadlineProbeError).toBe('deadline-probe-timeout');
    expect(snapshot.escalationReason).toBe('deadline-probe-timeout');
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(requestOwnedProcessEscalation).toHaveBeenCalledWith('deadline-probe-timeout');
    controller.stop();
  });

  it('requests only a transport reconnect for an external Gateway after a failed probe', async () => {
    const {
      controller,
      requestExternalTransportReconnect,
      requestOwnedProcessEscalation,
    } = createController({
      isExternallyManaged: () => true,
      requestDeadlineProbe: vi.fn().mockRejectedValue(new Error('system-presence timed out')),
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(GATEWAY_LIVENESS_DEADLINE_MS);

    expect(requestExternalTransportReconnect).toHaveBeenCalledTimes(1);
    expect(requestExternalTransportReconnect).toHaveBeenCalledWith('deadline-probe-timeout');
    expect(requestOwnedProcessEscalation).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'external-unavailable',
      externallyManaged: true,
    });
    controller.stop();
  });

  it('ignores an old deadline probe completion after newer liveness', async () => {
    let resolveProbe: (() => void) | undefined;
    const probe = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    const { controller, requestOwnedProcessEscalation } = createController({
      requestDeadlineProbe: vi.fn().mockReturnValue(probe),
    });

    controller.start();
    vi.advanceTimersByTime(GATEWAY_LIVENESS_DEADLINE_MS);
    await Promise.resolve();
    expect(controller.getSnapshot().state).toBe('verifying');

    controller.recordAlive();
    resolveProbe?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(requestOwnedProcessEscalation).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      state: 'healthy',
      lastAliveAt: Date.now(),
      lastDeadlineProbeResult: undefined,
    });
    controller.stop();
  });
});
