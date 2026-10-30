// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { RequestError } from '@agentclientprotocol/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Gate = {
  invalidate(reason?: string): void;
  recover(recovery: () => unknown): Promise<void>;
  wait(signal?: AbortSignal, deadline?: number): Promise<void>;
  stop(): void;
};
let createGate: (timeoutMs?: number) => Gate;
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(async () => {
  vi.useFakeTimers();
  const source = await readFile(path.resolve('node_modules/openclaw/dist/server-DkfYuk25.mjs'), 'utf8');
  const start = source.indexOf('const ACP_GATEWAY_RECONNECT_TIMEOUT_MS =');
  const end = source.indexOf('const MAX_STARTUP_ACP_BUFFER_BYTES =', start);
  expect(start).toBeGreaterThan(0);
  const context = { process: { env: {} }, setTimeout, clearTimeout, RequestError, Error, Date,
    formatErrorMessage: (error: Error) => error.message, createGate: undefined as typeof createGate | undefined };
  runInNewContext(`${source.slice(start, end)}\nglobalThis.createGate = createAcpGatewayReadiness;`, context);
  createGate = context.createGate!;
});
afterEach(() => vi.useRealTimers());

describe('installed ACP connection readiness', () => {
  it('waits for authenticated reconnect and its recovery work, then clears timers', async () => {
    const gate = createGate();
    const recovery = deferred();
    const settled = vi.fn();
    const wait = gate.wait().then(settled);
    const reconnect = gate.recover(() => recovery.promise);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(settled).not.toHaveBeenCalled();
    recovery.resolve();
    await reconnect;
    await wait;
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await gate.wait();
  });

  it.each(['resolve', 'reject'] as const)('ignores stale recovery %s after a newer reconnect', async (action) => {
    const gate = createGate();
    const old = deferred();
    const stale = gate.recover(() => old.promise);
    gate.invalidate('another disconnect');
    await gate.recover(() => undefined);
    if (action === 'resolve') old.resolve(); else old.reject(new Error('old failure'));
    await stale;
    await gate.wait();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not open the gate on a stale successful reconnect', async () => {
    const gate = createGate();
    const old = deferred();
    const stale = gate.recover(() => old.promise);
    gate.invalidate();
    const settled = vi.fn();
    const wait = gate.wait().then(settled);
    old.resolve(); await stale;
    expect(settled).not.toHaveBeenCalled();
    await gate.recover(() => undefined);
    await wait;
  });

  it('uses one finite deadline across failed handshakes and retains the concrete reason', async () => {
    const gate = createGate();
    const result = gate.wait().catch((error: RequestError) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    gate.invalidate('authentication unavailable');
    await gate.recover(() => Promise.reject(new Error('Gateway authentication failed')));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ code: -32000, message: 'ACP did not reconnect to Gateway within 60s',
      data: { code: 'ACP_GATEWAY_RECONNECT_TIMEOUT', details: 'Gateway authentication failed' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes a cancelled waiter without cancelling other waiters', async () => {
    const gate = createGate();
    const controller = new AbortController();
    const cancelled = gate.wait(controller.signal).catch((error: Error) => error.message);
    const other = gate.wait();
    controller.abort();
    expect(await cancelled).toContain('cancelled');
    expect(vi.getTimerCount()).toBe(1);
    await gate.recover(() => undefined); await other;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares the original admission deadline when readiness is rechecked before send', async () => {
    const gate = createGate();
    const deadline = Date.now() + 60_000;
    const first = gate.wait(undefined, deadline);
    await vi.advanceTimersByTimeAsync(40_000);
    await gate.recover(() => undefined); await first;
    gate.invalidate('disconnected during subscription');
    const second = gate.wait(undefined, deadline).catch((error: RequestError) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await second).toMatchObject({ data: { code: 'ACP_GATEWAY_RECONNECT_TIMEOUT' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending and future waits on shutdown, including a late recovery', async () => {
    const gate = createGate();
    const wait = gate.wait().catch((error: Error) => error.message);
    gate.stop();
    expect(await wait).toContain('closed');
    await gate.recover(() => undefined);
    await expect(gate.wait()).rejects.toThrow('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
