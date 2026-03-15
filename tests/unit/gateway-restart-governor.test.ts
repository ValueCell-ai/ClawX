import { describe, expect, it } from 'vitest';
import { GatewayRestartGovernor } from '@electron/gateway/restart-governor';

describe('GatewayRestartGovernor', () => {
  it('suppresses restart during exponential cooldown window', () => {
    const governor = new GatewayRestartGovernor({
      baseCooldownMs: 1000,
      maxCooldownMs: 8000,
      maxRestartsPerWindow: 10,
      windowMs: 60000,
      stableResetMs: 60000,
      circuitOpenMs: 60000,
    });

    expect(governor.decide(1000).allow).toBe(true);
    governor.recordExecuted(1000);

    const blocked = governor.decide(1500);
    expect(blocked.allow).toBe(false);
    expect(blocked.allow ? '' : blocked.reason).toBe('cooldown_active');
    expect(blocked.allow ? 0 : blocked.retryAfterMs).toBeGreaterThan(0);

    expect(governor.decide(3000).allow).toBe(true);
  });

  it('opens circuit after restart budget is exceeded', () => {
    const governor = new GatewayRestartGovernor({
      maxRestartsPerWindow: 2,
      windowMs: 60000,
      baseCooldownMs: 0,
      maxCooldownMs: 0,
      stableResetMs: 120000,
      circuitOpenMs: 30000,
    });

    expect(governor.decide(1000).allow).toBe(true);
    governor.recordExecuted(1000);
    expect(governor.decide(2000).allow).toBe(true);
    governor.recordExecuted(2000);

    const budgetBlocked = governor.decide(3000);
    expect(budgetBlocked.allow).toBe(false);
    expect(budgetBlocked.allow ? '' : budgetBlocked.reason).toBe('budget_exceeded');

    const circuitBlocked = governor.decide(4000);
    expect(circuitBlocked.allow).toBe(false);
    expect(circuitBlocked.allow ? '' : circuitBlocked.reason).toBe('circuit_open');

    expect(governor.decide(62001).allow).toBe(true);
  });

  it('resets consecutive backoff after stable running period', () => {
    const governor = new GatewayRestartGovernor({
      baseCooldownMs: 1000,
      maxCooldownMs: 8000,
      maxRestartsPerWindow: 10,
      windowMs: 600000,
      stableResetMs: 5000,
      circuitOpenMs: 60000,
    });

    governor.recordExecuted(0);
    governor.recordExecuted(1000);
    const blockedBeforeStable = governor.decide(2500);
    expect(blockedBeforeStable.allow).toBe(false);
    expect(blockedBeforeStable.allow ? '' : blockedBeforeStable.reason).toBe('cooldown_active');

    governor.onRunning(3000);
    const allowedAfterStable = governor.decide(9000);
    expect(allowedAfterStable.allow).toBe(true);
  });

  it('resets time-based state when clock moves backwards', () => {
    const governor = new GatewayRestartGovernor({
      maxRestartsPerWindow: 2,
      windowMs: 60000,
      baseCooldownMs: 1000,
      maxCooldownMs: 8000,
      stableResetMs: 60000,
      circuitOpenMs: 30000,
    });

    governor.recordExecuted(10_000);
    governor.recordExecuted(11_000);
    const blocked = governor.decide(11_500);
    expect(blocked.allow).toBe(false);

    // Simulate clock rewind and verify stale guard state does not lock out restarts.
    const afterRewind = governor.decide(9_000);
    expect(afterRewind.allow).toBe(true);
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
});
