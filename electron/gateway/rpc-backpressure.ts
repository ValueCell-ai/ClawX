type GatewayRpcRunner = (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;

type QueuedRpc = {
  run: () => Promise<void>;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(record[key])}`
  )).join(',')}}`;
}

export interface GatewayRpcBackpressureOptions {
  maxConcurrentHistory?: number;
}

/**
 * Prevents renderer fan-out from forwarding an unbounded number of expensive
 * chat.history RPCs to OpenClaw. The Gateway still owns the canonical response;
 * this class only coalesces duplicate in-flight history calls and runs distinct
 * history requests through a small FIFO queue.
 */
export class GatewayRpcBackpressure {
  private readonly maxConcurrentHistory: number;
  private readonly inFlightHistory = new Map<string, Promise<unknown>>();
  private readonly queue: QueuedRpc[] = [];
  private activeHistory = 0;

  constructor(options: GatewayRpcBackpressureOptions = {}) {
    this.maxConcurrentHistory = Math.max(1, options.maxConcurrentHistory ?? 2);
  }

  run(
    method: string,
    params: unknown,
    timeoutMs: number | undefined,
    runner: GatewayRpcRunner,
  ): Promise<unknown> {
    if (method !== 'chat.history') {
      return runner(method, params, timeoutMs);
    }

    const key = `${method}:${stableStringify(params)}:${timeoutMs ?? 'default'}`;
    const existing = this.inFlightHistory.get(key);
    if (existing) return existing;

    const promise = this.enqueueHistory(() => runner(method, params, timeoutMs))
      .finally(() => {
        if (this.inFlightHistory.get(key) === promise) {
          this.inFlightHistory.delete(key);
        }
      });
    this.inFlightHistory.set(key, promise);
    return promise;
  }

  getDiagnostics(): { activeHistory: number; queuedHistory: number; inFlightHistory: number } {
    return {
      activeHistory: this.activeHistory,
      queuedHistory: this.queue.length,
      inFlightHistory: this.inFlightHistory.size,
    };
  }

  private enqueueHistory(work: () => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const queued: QueuedRpc = {
        run: async () => {
          this.activeHistory += 1;
          try {
            resolve(await work());
          } catch (error) {
            reject(error);
          } finally {
            this.activeHistory -= 1;
            this.drain();
          }
        },
      };
      this.queue.push(queued);
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeHistory < this.maxConcurrentHistory) {
      const next = this.queue.shift();
      if (!next) return;
      void next.run();
    }
  }
}
