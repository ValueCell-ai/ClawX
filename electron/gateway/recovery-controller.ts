import { GATEWAY_LIVENESS_DEADLINE_MS } from './recovery-budget';

export type GatewayRecoveryState =
  | 'healthy'
  | 'verifying'
  | 'restart-pending'
  | 'restart-executing'
  | 'external-unavailable';

export interface GatewayRecoverySnapshot {
  state: GatewayRecoveryState;
  lastAliveAt?: number;
  deadlineAt?: number;
  lastDeadlineProbeAt?: number;
  lastDeadlineProbeResult?: 'succeeded' | 'failed';
  lastDeadlineProbeError?: string;
  escalationReason?: string;
  externallyManaged: boolean;
}

export interface GatewayRecoveryControllerOptions {
  isExternallyManaged: () => boolean;
  isCompactionActive?: () => boolean;
  requestDeadlineProbe: () => Promise<void>;
  requestOwnedProcessEscalation: (reason: string) => void | Promise<void>;
  requestExternalTransportReconnect: (reason: string) => void | Promise<void>;
  now?: () => number;
}

function classifyDeadlineProbeFailure(error: unknown): 'deadline-probe-timeout' | 'deadline-probe-failed' {
  const message = error instanceof Error ? error.message : '';
  return /\b(?:timed? out|timeout)\b/i.test(message)
    ? 'deadline-probe-timeout'
    : 'deadline-probe-failed';
}

/**
 * Main-process liveness policy. Lifecycle and transport operations remain in
 * GatewayManager and are requested only through callbacks.
 */
export class GatewayRecoveryController {
  private deadlineTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private state: GatewayRecoveryState = 'healthy';
  private lastAliveAt: number | undefined;
  private deadlineAt: number | undefined;
  private lastDeadlineProbeAt: number | undefined;
  private lastDeadlineProbeResult: 'succeeded' | 'failed' | undefined;
  private lastDeadlineProbeError: string | undefined;
  private escalationReason: string | undefined;
  private deferredEscalationReason: string | undefined;

  constructor(private readonly options: GatewayRecoveryControllerOptions) {}

  start(lastAliveAt = this.now()): void {
    this.recordAlive(lastAliveAt);
  }

  recordAlive(aliveAt = this.now()): void {
    this.cancelDeadline();
    this.generation += 1;
    this.state = 'healthy';
    this.deferredEscalationReason = undefined;
    this.lastAliveAt = aliveAt;
    this.deadlineAt = aliveAt + GATEWAY_LIVENESS_DEADLINE_MS;
    this.escalationReason = undefined;
    this.scheduleDeadline(this.generation, this.deadlineAt);
  }

  stop(): void {
    this.cancelDeadline();
    this.generation += 1;
    this.state = 'healthy';
    this.deadlineAt = undefined;
    this.escalationReason = undefined;
    this.deferredEscalationReason = undefined;
  }

  resumeDeferredEscalation(): void {
    const reason = this.deferredEscalationReason;
    if (!reason || this.options.isCompactionActive?.()) return;
    this.deferredEscalationReason = undefined;
    this.state = 'restart-executing';
    this.requestCallback(this.options.requestOwnedProcessEscalation(reason));
  }

  getSnapshot(): GatewayRecoverySnapshot {
    return {
      state: this.state,
      lastAliveAt: this.lastAliveAt,
      deadlineAt: this.deadlineAt,
      lastDeadlineProbeAt: this.lastDeadlineProbeAt,
      lastDeadlineProbeResult: this.lastDeadlineProbeResult,
      lastDeadlineProbeError: this.lastDeadlineProbeError,
      escalationReason: this.escalationReason,
      externallyManaged: this.options.isExternallyManaged(),
    };
  }

  private scheduleDeadline(generation: number, deadlineAt: number): void {
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      void this.verifyDeadline(generation, deadlineAt);
    }, Math.max(0, deadlineAt - this.now()));
  }

  private async verifyDeadline(generation: number, deadlineAt: number): Promise<void> {
    if (generation !== this.generation || this.deadlineAt !== deadlineAt) {
      return;
    }

    this.state = 'verifying';
    this.lastDeadlineProbeAt = this.now();
    this.lastDeadlineProbeResult = undefined;
    this.lastDeadlineProbeError = undefined;

    try {
      await this.options.requestDeadlineProbe();
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.handleFailedProbe(error);
      return;
    }

    if (generation !== this.generation) {
      return;
    }

    this.lastDeadlineProbeResult = 'succeeded';
    this.recordAlive(this.now());
  }

  private handleFailedProbe(error: unknown): void {
    // Probe errors can contain transport details or credentials; diagnostics use
    // only a fixed category while retaining timeout-versus-other classification.
    const reason = classifyDeadlineProbeFailure(error);
    this.lastDeadlineProbeResult = 'failed';
    this.lastDeadlineProbeError = reason;
    this.escalationReason = reason;

    if (this.options.isExternallyManaged()) {
      this.state = 'external-unavailable';
      this.requestCallback(this.options.requestExternalTransportReconnect(reason));
      return;
    }

    this.state = 'restart-pending';
    if (this.options.isCompactionActive?.()) {
      this.deferredEscalationReason = reason;
      return;
    }
    this.state = 'restart-executing';
    this.requestCallback(this.options.requestOwnedProcessEscalation(reason));
  }

  private requestCallback(callback: void | Promise<void>): void {
    void Promise.resolve(callback).catch(() => {
      // GatewayManager owns retry/error handling for the requested operation.
    });
  }

  private cancelDeadline(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
