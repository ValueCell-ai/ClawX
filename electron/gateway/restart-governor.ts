export type RestartDecision =
  | { allow: true }
  | {
    allow: false;
    reason: 'circuit_open' | 'budget_exceeded' | 'cooldown_active';
    retryAfterMs: number;
  };

type RestartGovernorOptions = {
  maxRestartsPerWindow: number;
  windowMs: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  circuitOpenMs: number;
  stableResetMs: number;
};

const DEFAULT_OPTIONS: RestartGovernorOptions = {
  maxRestartsPerWindow: 4,
  windowMs: 10 * 60 * 1000,
  baseCooldownMs: 2500,
  maxCooldownMs: 2 * 60 * 1000,
  circuitOpenMs: 10 * 60 * 1000,
  stableResetMs: 2 * 60 * 1000,
};

export class GatewayRestartGovernor {
  private readonly options: RestartGovernorOptions;
  private restartTimestamps: number[] = [];
  private circuitOpenUntil = 0;
  private consecutiveRestarts = 0;
  private lastRestartAt = 0;
  private lastRunningAt = 0;
  private suppressedTotal = 0;
  private executedTotal = 0;
  private static readonly MAX_COUNTER = Number.MAX_SAFE_INTEGER;

  constructor(options?: Partial<RestartGovernorOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  onRunning(now = Date.now()): void {
    this.lastRunningAt = now;
  }

  decide(now = Date.now()): RestartDecision {
    this.pruneOld(now);
    this.maybeResetConsecutive(now);

    if (now < this.circuitOpenUntil) {
      this.suppressedTotal = this.incrementCounter(this.suppressedTotal);
      return {
        allow: false,
        reason: 'circuit_open',
        retryAfterMs: this.circuitOpenUntil - now,
      };
    }

    if (this.restartTimestamps.length >= this.options.maxRestartsPerWindow) {
      this.circuitOpenUntil = now + this.options.circuitOpenMs;
      this.suppressedTotal = this.incrementCounter(this.suppressedTotal);
      return {
        allow: false,
        reason: 'budget_exceeded',
        retryAfterMs: this.options.circuitOpenMs,
      };
    }

    const requiredCooldown = this.getCooldownMs();
    if (this.lastRestartAt > 0) {
      const sinceLast = now - this.lastRestartAt;
      if (sinceLast < requiredCooldown) {
        this.suppressedTotal = this.incrementCounter(this.suppressedTotal);
        return {
          allow: false,
          reason: 'cooldown_active',
          retryAfterMs: requiredCooldown - sinceLast,
        };
      }
    }

    return { allow: true };
  }

  recordExecuted(now = Date.now()): void {
    this.executedTotal = this.incrementCounter(this.executedTotal);
    this.lastRestartAt = now;
    this.consecutiveRestarts += 1;
    this.restartTimestamps.push(now);
    this.pruneOld(now);
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
      circuit_open_until: this.circuitOpenUntil,
    };
  }

  private getCooldownMs(): number {
    const factor = Math.pow(2, Math.max(0, this.consecutiveRestarts));
    return Math.min(this.options.baseCooldownMs * factor, this.options.maxCooldownMs);
  }

  private maybeResetConsecutive(now: number): void {
    if (this.lastRunningAt <= 0) return;
    if (now - this.lastRunningAt >= this.options.stableResetMs) {
      this.consecutiveRestarts = 0;
    }
  }

  private pruneOld(now: number): void {
    // Detect time rewind (system clock moved backwards) and clear all
    // time-based guard state to avoid stale lockouts.
    if (this.restartTimestamps.length > 0 && now < this.restartTimestamps[this.restartTimestamps.length - 1]) {
      this.restartTimestamps = [];
      this.circuitOpenUntil = 0;
      this.lastRestartAt = 0;
      this.lastRunningAt = 0;
      this.consecutiveRestarts = 0;
      return;
    }
    const threshold = now - this.options.windowMs;
    while (this.restartTimestamps.length > 0 && this.restartTimestamps[0] < threshold) {
      this.restartTimestamps.shift();
    }
  }

  private incrementCounter(current: number): number {
    if (current >= GatewayRestartGovernor.MAX_COUNTER) return 0;
    return current + 1;
  }
}
