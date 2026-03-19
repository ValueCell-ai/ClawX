import { logger } from '../utils/logger';

type HealthResult = { ok: boolean; error?: string };
type HeartbeatAliveReason = 'pong' | 'message';

type PingOptions = {
  sendPing: () => void;
  onHeartbeatTimeout: (context: { consecutiveMisses: number; timeoutMs: number }) => void;
  intervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveMisses?: number;
};

export class GatewayConnectionMonitor {
  private pingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastPingAt = 0;
  private waitingForAlive = false;
  private consecutiveMisses = 0;
  private timeoutTriggered = false;

  startPing(options: PingOptions): void {
    const intervalMs = options.intervalMs ?? 30000;
    const timeoutMs = options.timeoutMs ?? 10000;
    const maxConsecutiveMisses = Math.max(1, options.maxConsecutiveMisses ?? 3);
    this.resetHeartbeatState();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      const now = Date.now();

      if (this.waitingForAlive && now - this.lastPingAt >= timeoutMs) {
        this.waitingForAlive = false;
        this.consecutiveMisses += 1;
        logger.warn(
          `Gateway heartbeat missed (${this.consecutiveMisses}/${maxConsecutiveMisses}, timeout=${timeoutMs}ms)`,
        );
        if (this.consecutiveMisses >= maxConsecutiveMisses && !this.timeoutTriggered) {
          this.timeoutTriggered = true;
          options.onHeartbeatTimeout({
            consecutiveMisses: this.consecutiveMisses,
            timeoutMs,
          });
          return;
        }
      }

      options.sendPing();
      this.waitingForAlive = true;
      this.lastPingAt = now;
    }, intervalMs);
  }

  markAlive(reason: HeartbeatAliveReason): void {
    // Only log true recovery cases to avoid steady-state heartbeat log spam.
    if (this.consecutiveMisses > 0) {
      logger.debug(`Gateway heartbeat recovered via ${reason} (misses=${this.consecutiveMisses})`);
    }
    this.waitingForAlive = false;
    this.consecutiveMisses = 0;
    this.timeoutTriggered = false;
  }

  // Backward-compatible alias for old callers.
  handlePong(): void {
    this.markAlive('pong');
  }

  getConsecutiveMisses(): number {
    return this.consecutiveMisses;
  }

  startHealthCheck(options: {
    shouldCheck: () => boolean;
    checkHealth: () => Promise<HealthResult>;
    onUnhealthy: (errorMessage: string) => void;
    onError: (error: unknown) => void;
    intervalMs?: number;
  }): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      if (!options.shouldCheck()) {
        return;
      }

      try {
        const health = await options.checkHealth();
        if (!health.ok) {
          const errorMessage = health.error ?? 'Health check failed';
          logger.warn(`Gateway health check failed: ${errorMessage}`);
          options.onUnhealthy(errorMessage);
        }
      } catch (error) {
        logger.error('Gateway health check error:', error);
        options.onError(error);
      }
    }, options.intervalMs ?? 30000);
  }

  clear(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.resetHeartbeatState();
  }

  private resetHeartbeatState(): void {
    this.lastPingAt = 0;
    this.waitingForAlive = false;
    this.consecutiveMisses = 0;
    this.timeoutTriggered = false;
  }
}
