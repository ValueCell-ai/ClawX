import { describe, expect, it, vi } from 'vitest';
import { GatewayRpcBackpressure } from '../../electron/gateway/rpc-backpressure';

describe('GatewayRpcBackpressure', () => {
  it('coalesces duplicate in-flight chat.history requests', async () => {
    const backpressure = new GatewayRpcBackpressure({ maxConcurrentHistory: 2 });
    let resolveRunner: ((value: unknown) => void) | null = null;
    const runner = vi.fn(() => new Promise((resolve) => {
      resolveRunner = resolve;
    }));

    const first = backpressure.run('chat.history', { sessionKey: 'agent:main:one', limit: 200 }, undefined, runner);
    const second = backpressure.run('chat.history', { limit: 200, sessionKey: 'agent:main:one' }, undefined, runner);

    expect(runner).toHaveBeenCalledTimes(1);
    resolveRunner?.({ messages: ['ok'] });
    await expect(first).resolves.toEqual({ messages: ['ok'] });
    await expect(second).resolves.toEqual({ messages: ['ok'] });
  });

  it('limits distinct chat.history requests while allowing non-history RPCs through', async () => {
    const backpressure = new GatewayRpcBackpressure({ maxConcurrentHistory: 2 });
    let activeHistory = 0;
    let maxActiveHistory = 0;
    const releaseHistory: Array<() => void> = [];
    const runner = vi.fn(async (method: string) => {
      if (method !== 'chat.history') {
        return { method };
      }
      activeHistory += 1;
      maxActiveHistory = Math.max(maxActiveHistory, activeHistory);
      await new Promise<void>((resolve) => releaseHistory.push(resolve));
      activeHistory -= 1;
      return { method };
    });

    const historyRuns = Array.from({ length: 5 }, (_, index) => (
      backpressure.run('chat.history', { sessionKey: `agent:main:${index}`, limit: 200 }, undefined, runner)
    ));
    const statusRun = backpressure.run('status', {}, undefined, runner);

    await expect(statusRun).resolves.toEqual({ method: 'status' });
    expect(maxActiveHistory).toBe(2);
    expect(backpressure.getDiagnostics()).toMatchObject({
      activeHistory: 2,
      queuedHistory: 3,
    });

    while (releaseHistory.length > 0) {
      releaseHistory.shift()?.();
      await Promise.resolve();
    }

    await Promise.all(historyRuns);
    expect(maxActiveHistory).toBeLessThanOrEqual(2);
    expect(backpressure.getDiagnostics()).toEqual({
      activeHistory: 0,
      queuedHistory: 0,
      inFlightHistory: 0,
    });
  });
});
