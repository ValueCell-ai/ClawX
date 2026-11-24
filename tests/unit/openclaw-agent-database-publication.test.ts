// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const bundle = (file: string) => readFileSync(path.join(dist, file), 'utf8');
const gateway = bundle('gateway-prewarm.js');
const start = gateway.indexOf('const assertPreparationCurrent', gateway.indexOf('publishAgent:'));
const end = gateway.indexOf('\n\t\t})\n\t});', start);
const models = gateway.slice(start, end).replace('import("./prepared-model-runtime.errors-MeOTZhu4.mjs")', 'loadErrors()');
const admission = bundle('agent-database-startup-AXJFrv8D.mjs');
const retry = admission.slice(admission.indexOf('for (let attempt = 1;; attempt++) try'), admission.indexOf('phase("publication");'));
const errors = bundle('prepared-model-runtime.errors-MeOTZhu4.mjs');
const errorModule = runInNewContext(
  errors.slice(errors.indexOf('//#region'), errors.indexOf('//#endregion')) +
  '\n({ c: isPreparedModelRuntimePluginLifecycleFailure, superseded: PreparedModelRuntimePublicationSupersededError })',
  { PluginInstanceUnavailableError: class extends Error {} },
);

function fixture() {
  const agentId = 'qa-second';
  const input = { agentId };
  const cfg = {};
  const refresh = vi.fn(async () => {});
  const snapshot = vi.fn(() => true);
  const pending = vi.fn<() => Promise<void> | undefined>(() => undefined);
  const assertNotDeleted = vi.fn();
  const isCurrent = vi.fn(() => true);
  const owners = vi.fn(() => [input]);
  const scope = {
    agentId, input, cfg, assertNotDeleted, getPreparedModelRuntimeSnapshot: snapshot,
    params: { isCurrent, getConfig: () => cfg, getPluginMetadataSnapshot: vi.fn(), getPluginRegistry: vi.fn() },
    signal: new AbortController().signal, assertCurrent: vi.fn(), phase: vi.fn(),
    getActiveSecretsRuntimeSnapshotRevision: () => 1, secretsRevision: 1,
    withPluginRuntimeRegistryScope: (_registry: unknown, run: () => unknown) => run(),
    refreshPreparedModelRuntimeSnapshots: refresh, listConfiguredOwnerInputs: owners,
    getPendingPreparedModelRuntimeReplacement: pending, loadErrors: () => errorModule, log: { warn: vi.fn() },
  };
  const run: () => Promise<void> = runInNewContext([
    admission.match(/const STARTUP_PUBLICATION_ATTEMPTS = \d+;/)![0],
    admission.match(/var AgentDatabaseStartupSupersededError = class extends Error \{[\s\S]+?\n\};/)![0],
    `const activation = { publishAgent: async () => { ${models} } };`,
    `(async () => { ${retry} })`,
  ].join('\n'), scope);
  return { run, refresh, snapshot, pending, assertNotDeleted, owners, isCurrent };
}

describe('deferred agent database model publication', () => {
  it.each(['superseded', 'missing snapshot'] as const)('joins the replacing publication before retrying %s', async (collision) => {
    const f = fixture();
    const waiting = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    f.pending.mockImplementation(() => { waiting.resolve(); return release.promise; });
    if (collision === 'superseded') f.refresh.mockRejectedValueOnce(new errorModule.superseded('main owner was replaced'));
    else f.snapshot.mockReturnValueOnce(false);
    const result = f.run();
    await waiting.promise;
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(f.assertNotDeleted).not.toHaveBeenCalled();
    release.resolve();
    await result;
    expect(f.assertNotDeleted).toHaveBeenCalledOnce();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.snapshot).toHaveBeenLastCalledWith({ agentId: 'qa-second' });
  });

  it('retains the four-attempt cap and rechecks deletion between attempts', async () => {
    const f = fixture();
    f.refresh.mockRejectedValue(new errorModule.superseded('overlapping startup'));
    await expect(f.run()).rejects.toThrow('qa-second startup preparation was superseded');
    expect(f.refresh).toHaveBeenCalledTimes(4);
    expect(f.assertNotDeleted).toHaveBeenCalledTimes(3);
  });

  it('keeps a deleted agent unavailable when its replacement settles', async () => {
    const f = fixture();
    const deleted = new Error('agent was deleted during preparation');
    f.refresh.mockRejectedValueOnce(new errorModule.superseded());
    f.pending.mockResolvedValue(undefined);
    f.assertNotDeleted.mockRejectedValueOnce(deleted);
    await expect(f.run()).rejects.toBe(deleted);
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(f.snapshot).not.toHaveBeenCalled();
  });

  it('passes genuine model and replacement failures to the admission owner', async () => {
    const failure = new Error('auth store is unavailable');
    const f = fixture();
    f.refresh.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(f.pending).not.toHaveBeenCalled();
    f.refresh.mockRejectedValue(new errorModule.superseded());
    f.pending.mockImplementation(() => Promise.reject(failure));
    await expect(f.run()).rejects.toBe(failure);
    expect(f.assertNotDeleted).not.toHaveBeenCalled();
  });

  it('requires the configured agent and its actual published snapshot', async () => {
    const f = fixture();
    f.snapshot.mockReturnValue(false);
    await expect(f.run()).rejects.toThrow('qa-second model preparation has not published');
    f.owners.mockReturnValue([{ agentId: 'main' }]);
    await expect(f.run()).rejects.toThrow('qa-second model preparation is no longer configured');
    expect(f.assertNotDeleted).not.toHaveBeenCalled();
  });

  it('returns a valid snapshot directly and rejects a retired configuration', async () => {
    const f = fixture();
    await f.run();
    expect(f.pending).not.toHaveBeenCalled();
    f.isCurrent.mockReturnValue(false);
    await expect(f.run()).rejects.toThrow('qa-second startup preparation was superseded');
    expect(f.refresh).toHaveBeenCalledOnce();
  });
});
