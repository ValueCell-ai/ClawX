// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GatewayLifecycleController, LifecycleSupersededError } from '@electron/gateway/lifecycle-controller';
import {
  GatewayStartupPreparations,
  GatewayStartupMigrationRequiredError,
  GatewayStartupPreparationError,
  type GatewayStartupPreparationContext,
  type CronInferenceContinuityEntry,
} from '@electron/gateway/startup-preparation';

vi.mock('@electron/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('offline Gateway startup preparations', () => {
  const continuation: CronInferenceContinuityEntry = {
    jobId: 'legacy', definition: { id: 'legacy' }, agentId: 'main', model: 'enterprise/model',
    profileId: 'enterprise:default', credentialDigest: 'a'.repeat(64),
    expectedPreviousBinding: { profileId: 'enterprise:default', authorizationId: 'old' },
  };

  it('publishes copied continuation evidence only after every preparation succeeds', async () => {
    const preparations = new GatewayStartupPreparations();
    let context!: GatewayStartupPreparationContext;
    const evidence = structuredClone(continuation);
    preparations.register('auth', {
      checkReady: () => ({ ready: true }),
      run: async (current) => { context = current; current.restoreCronInferenceContinuity!([evidence]); },
    });
    const result = await preparations.run(() => {});
    evidence.model = 'different/model';
    expect(result.cronInferenceContinuity).toEqual([continuation]);
    expect(() => context.restoreCronInferenceContinuity!([continuation])).toThrow(LifecycleSupersededError);
  });

  it('discards continuation evidence when another participant fails and starts the retry empty', async () => {
    const preparations = new GatewayStartupPreparations();
    const remove = preparations.register('auth', {
      checkReady: () => ({ ready: true }), run: async context => { context.restoreCronInferenceContinuity!([continuation]); },
    });
    const removeFailure = preparations.register('failure', {
      checkReady: () => ({ ready: true }), run: async () => { throw new Error('projection rejected'); },
    });
    await expect(preparations.run(() => {})).rejects.toThrow(GatewayStartupPreparationError);
    remove(); removeFailure();
    expect(await preparations.run(() => {})).toEqual({ cronInferenceContinuity: [] });
  });

  it('admits every participant before writing and runs again for the next managed spawn', async () => {
    const preparations = new GatewayStartupPreparations();
    const order: string[] = [];
    for (const id of ['one', 'two']) preparations.register(id, {
      checkReady: () => { order.push(`check:${id}`); return { ready: true }; },
      run: async () => { order.push(`run:${id}`); },
    });
    await preparations.run(() => {});
    expect(order).toEqual(['check:one', 'check:two', 'run:one', 'run:two']);
    await preparations.run(() => {});
    expect(order.slice(4)).toEqual(order.slice(0, 4));
  });

  it('defers all writes when another participant still requires migration', async () => {
    const preparations = new GatewayStartupPreparations();
    const write = vi.fn();
    preparations.register('ready', { checkReady: () => ({ ready: true }), run: write });
    preparations.register('auth', { checkReady: () => ({ ready: false, reason: 'agent-schema:25' }), run: write });
    await expect(preparations.run(() => {})).rejects.toMatchObject({
      name: 'GatewayStartupMigrationRequiredError', reason: 'auth: agent-schema:25',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps corruption distinct from a migration request', async () => {
    const preparations = new GatewayStartupPreparations();
    const corruption = new Error('owner mismatch');
    preparations.register('auth', { checkReady: () => { throw corruption; }, run: vi.fn() });
    const failure = preparations.run(() => {});
    await expect(failure).rejects.toBeInstanceOf(GatewayStartupPreparationError);
    await expect(failure).rejects.toMatchObject({ cause: corruption });
    await expect(failure).rejects.not.toBeInstanceOf(GatewayStartupMigrationRequiredError);
  });

  it('aborts a pending admission on stop and never invokes its writer', async () => {
    const preparations = new GatewayStartupPreparations();
    const pending = deferred();
    let context!: GatewayStartupPreparationContext;
    const write = vi.fn();
    preparations.register('auth', {
      checkReady: async (current) => { context = current; await pending.promise; return { ready: true }; },
      run: write,
    });
    const result = preparations.run(() => {});
    preparations.cancelActive();
    expect(context.signal.aborted).toBe(true);
    pending.resolve();
    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);
    expect(write).not.toHaveBeenCalled();
  });

  it('lets an asynchronous writer fence its next write after cancellation', async () => {
    const preparations = new GatewayStartupPreparations();
    const entered = deferred();
    const pending = deferred();
    const write = vi.fn();
    preparations.register('auth', {
      checkReady: () => ({ ready: true }),
      run: async (context) => {
        entered.resolve();
        await pending.promise;
        context.assertActive();
        write();
      },
    });
    const result = preparations.run(() => {});
    await entered.promise;
    preparations.cancelActive();
    pending.resolve();
    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['unregister', 'replace', 'add'] as const)('invalidates the entire admission pass on %s', async (operation) => {
    const preparations = new GatewayStartupPreparations();
    const pending = deferred();
    const oldWrite = vi.fn();
    const newWrite = vi.fn();
    const unsubscribe = preparations.register('auth', {
      checkReady: async () => { await pending.promise; return { ready: true }; }, run: oldWrite,
    });
    const result = preparations.run(() => {});
    if (operation === 'unregister') unsubscribe();
    else preparations.register(operation === 'replace' ? 'auth' : 'other', {
      checkReady: () => ({ ready: true }), run: newWrite,
    });
    pending.resolve();
    await expect(result).rejects.toBeInstanceOf(LifecycleSupersededError);
    expect(oldWrite).not.toHaveBeenCalled();
    expect(newWrite).not.toHaveBeenCalled();
    if (operation === 'replace') {
      unsubscribe(); // An old registration must not remove its replacement.
      await preparations.run(() => {});
      expect(newWrite).toHaveBeenCalledOnce();
    }
  });

  it('gives lifecycle cancellation precedence over a rejected callback', async () => {
    const preparations = new GatewayStartupPreparations();
    const lifecycle = new GatewayLifecycleController();
    const epoch = lifecycle.bump('start');
    preparations.register('auth', {
      checkReady: async () => { lifecycle.bump('stop'); throw new Error('late I/O failure'); }, run: vi.fn(),
    });
    await expect(preparations.run(() => lifecycle.assert(epoch, 'test'))).rejects.toBeInstanceOf(LifecycleSupersededError);
  });

  it('expires callback contexts after a successful pass', async () => {
    const preparations = new GatewayStartupPreparations();
    let context!: GatewayStartupPreparationContext;
    preparations.register('auth', { checkReady: () => ({ ready: true }), run: async (current) => { context = current; } });
    await preparations.run(() => {});
    expect(context.signal.aborted).toBe(true);
    expect(() => context.assertActive()).toThrow(LifecycleSupersededError);
  });
});
