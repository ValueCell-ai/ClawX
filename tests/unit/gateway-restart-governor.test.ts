import { describe, expect, it } from 'vitest';
import { GatewayRestartGovernor } from '@electron/gateway/restart-governor';

describe('GatewayRestartGovernor', () => {
  it('allows first restart unconditionally', () => {
    const governor = new GatewayRestartGovernor();
    expect(governor.decide(1000).allow).toBe(true);
  });

  it('suppresses restart during cooldown window', () => {
    const governor = new GatewayRestartGovernor({ cooldownMs: 1000 });

    expect(governor.decide(1000).allow).toBe(true);
    governor.recordExecuted(1000);

    const blocked = governor.decide(1500);
    expect(blocked.allow).toBe(false);
    expect(blocked.allow ? '' : blocked.reason).toBe('cooldown_active');
    expect(blocked.allow ? 0 : blocked.retryAfterMs).toBe(500);

    // After cooldown expires, restart is allowed again
    expect(governor.decide(2001).allow).toBe(true);
  });

  it('allows unlimited restarts as long as cooldown is respected', () => {
    const governor = new GatewayRestartGovernor({ cooldownMs: 100 });

    // 10 restarts in a row, each respecting cooldown — all should be allowed
    for (let i = 0; i < 10; i++) {
      const t = 1000 + i * 200;
      expect(governor.decide(t).allow).toBe(true);
      governor.recordExecuted(t);
    }
  });

  it('onRunning is a no-op but does not throw', () => {
    const governor = new GatewayRestartGovernor();
    expect(() => governor.onRunning(1000)).not.toThrow();
  });

  it('wraps counters safely at MAX_SAFE_INTEGER', () => {
    const governor = new GatewayRestartGovernor();
    (governor as unknown as { executedTotal: number; suppressedTotal: number }).executedTotal = Number.MAX_SAFE_INTEGER;
    (governor as unknown as { executedTotal: number; suppressedTotal: number }).suppressedTotal = Number.MAX_SAFE_INTEGER;

    governor.recordExecuted(1000);
    governor.decide(1000);

    expect(governor.getCounters()).toEqual({
      executedTotal: 0,
      suppressedTotal: 0,
    });
  });

  it('getObservability returns circuit_open_until as always 0', () => {
    const governor = new GatewayRestartGovernor();
    governor.recordExecuted(1000);
    const obs = governor.getObservability();
    expect(obs.circuit_open_until).toBe(0);
    expect(obs.executed_total).toBe(1);
  });
});
