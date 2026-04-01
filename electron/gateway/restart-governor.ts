export type RestartDecision =
  | { allow: true }
  | {
    allow: false;
    reason: 'cooldown_active';
    retryAfterMs: number;
  };

type RestartGovernorOptions = {
  /** Minimum interval between consecutive restarts (ms). */
  cooldownMs: number;
};

const DEFAULT_OPTIONS: RestartGovernorOptions = {
  cooldownMs: 2500,
};

/**
 * Lightweight restart rate-limiter.
 *
 * Prevents rapid-fire restarts by enforcing a simple cooldown between
 * consecutive restart executions.  Nothing more — no circuit breakers,
 * no sliding-window budgets, no exponential back-off.  Those mechanisms
 * were previously present but removed because:
 *
 * 1. The root causes of infinite restart loops (stale ownedPid, port
 *    contention, leaked WebSocket connections) have been fixed at their
 *    source.
 * 2. A 10-minute circuit-breaker lockout actively hurt the user
 *    experience: legitimate config changes were silently dropped.
 * 3. The complexity made the restart path harder to reason about during
 *    debugging.
 */
export class GatewayRestartGovernor {
  private readonly options: RestartGovernorOptions;
  private lastRestartAt = 0;
  private suppressedTotal = 0;
  private executedTotal = 0;

  constructor(options?: Partial<RestartGovernorOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** No-op kept for interface compatibility with callers. */
  onRunning(_now = Date.now()): void {
    // Previously used to track "stable running" for exponential back-off
    // reset.  No longer needed with the simplified cooldown model.
  }

  decide(now = Date.now()): RestartDecision {
    if (this.lastRestartAt > 0) {
      const sinceLast = now - this.lastRestartAt;
      if (sinceLast < this.options.cooldownMs) {
        this.suppressedTotal = this.safeIncrement(this.suppressedTotal);
        return {
          allow: false,
          reason: 'cooldown_active',
          retryAfterMs: this.options.cooldownMs - sinceLast,
        };
      }
    }

    return { allow: true };
  }

  recordExecuted(now = Date.now()): void {
    this.executedTotal = this.safeIncrement(this.executedTotal);
    this.lastRestartAt = now;
  }

  getCounters(): { executedTotal: number; suppressedTotal: number } {
    return {
      executedTotal: this.executedTotal,
      suppressedTotal: this.suppressedTotal,
    };
  }

  getObservability(): {
    suppressed_total: number;
    executed_total: number;
    circuit_open_until: number;
  } {
    return {
      suppressed_total: this.suppressedTotal,
      executed_total: this.executedTotal,
      circuit_open_until: 0, // Always 0 — no circuit breaker
    };
  }

  private safeIncrement(current: number): number {
    if (current >= Number.MAX_SAFE_INTEGER) return 0;
    return current + 1;
  }
}
