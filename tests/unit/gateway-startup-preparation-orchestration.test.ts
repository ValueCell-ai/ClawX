// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runGatewayStartupSequence, startGatewayAndSyncAuth } from '@electron/gateway/startup-orchestrator';
import { GatewayStartupPreparations, GatewayStartupPreparationError, GatewayStartupMigrationRequiredError } from '@electron/gateway/startup-preparation';
import { GatewayLifecycleController, LifecycleSupersededError } from '@electron/gateway/lifecycle-controller';

vi.mock('@electron/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function harness() {
  const preparations = new GatewayStartupPreparations();
  const lifecycle = new GatewayLifecycleController();
  const epoch = lifecycle.bump('start');
  const spawned = vi.fn();
  const hooks = {
    port: 18789, shouldWaitForPortFree: true,
    hasOwnedProcess: vi.fn(() => false), resetStartupStderrLines: vi.fn(),
    getStartupStderrLines: vi.fn((): string[] => []), getProcessExitCode: () => null,
    assertLifecycle: () => lifecycle.assert(epoch, 'test'),
    findExistingGateway: vi.fn(async (): Promise<{ port: number } | null> => null),
    connect: vi.fn(async () => {}), onConnectedToExistingGateway: vi.fn(),
    waitForPortFree: vi.fn(async () => {}),
    startProcess: vi.fn(async () => {
      await preparations.run(() => lifecycle.assert(epoch, 'preparation'));
      spawned();
    }),
    waitForReady: vi.fn(async () => {}), terminateStaleOwnedProcess: vi.fn(async () => {}),
    onConnectedToManagedGateway: vi.fn(), runDoctorRepair: vi.fn(async () => false),
    onDoctorRepairSuccess: vi.fn(), delay: vi.fn(async () => {}),
  };
  return { preparations, lifecycle, hooks, spawned };
}

describe('startup migration preparation orchestration', () => {
  it.each(['error', 'stopped', 'starting'])('does not sync auth after start returns with %s status', async (state) => {
    const syncAuth = vi.fn();
    expect(await startGatewayAndSyncAuth({ start: async () => {}, getStatus: () => ({ state }) }, syncAuth)).toBe(false);
    expect(syncAuth).not.toHaveBeenCalled();
  });

  it('waits for start to finish before checking status and synchronizing auth', async () => {
    let state = 'starting';
    const order: string[] = [];
    const gateway = {
      start: async () => { await Promise.resolve(); state = 'running'; order.push('started'); },
      getStatus: () => ({ state }),
    };
    expect(await startGatewayAndSyncAuth(gateway, async () => { order.push('sync'); })).toBe(true);
    expect(order).toEqual(['started', 'sync']);
  });

  it('does not sync auth when start rejects', async () => {
    const syncAuth = vi.fn();
    const failure = new Error('backup failed');
    await expect(startGatewayAndSyncAuth({ start: async () => { throw failure; }, getStatus: () => ({ state: 'running' }) }, syncAuth)).rejects.toBe(failure);
    expect(syncAuth).not.toHaveBeenCalled();
  });

  it('runs migration before projection and spawn even when Doctor exits non-zero', async () => {
    const h = harness();
    let migrated = false;
    const order: string[] = [];
    h.preparations.register('auth', {
      checkReady: () => migrated ? { ready: true } : { ready: false, reason: 'agent-schema:1' },
      run: async () => { order.push('projection'); },
    });
    h.hooks.runDoctorRepair.mockImplementation(async () => { order.push('doctor'); migrated = true; return false; });
    h.spawned.mockImplementation(() => order.push('spawn'));
    await runGatewayStartupSequence(h.hooks);
    expect(order).toEqual(['doctor', 'projection', 'spawn']);
    expect(h.hooks.runDoctorRepair).toHaveBeenCalledOnce();
    expect(h.hooks.onDoctorRepairSuccess).not.toHaveBeenCalled();
  });

  it('does not trust Doctor zero when the same schema refusal remains', async () => {
    const h = harness();
    const run = vi.fn();
    h.preparations.register('auth', { checkReady: () => ({ ready: false, reason: 'agent-schema:25' }), run });
    h.hooks.runDoctorRepair.mockResolvedValue(true);
    await expect(runGatewayStartupSequence(h.hooks)).rejects.toMatchObject({ name: 'GatewayStartupMigrationRequiredError' });
    expect(h.hooks.runDoctorRepair).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(h.spawned).not.toHaveBeenCalled();
  });

  it('re-enters migration when changed inputs fail a read-only recheck before projection writes', async () => {
    const h = harness();
    let migrated = false;
    const write = vi.fn();
    h.preparations.register('auth', {
      checkReady: () => ({ ready: true }), // No session at the first check.
      run: async () => {
        // A login arrived between admission and acquiring the projection lock.
        if (!migrated) throw new GatewayStartupMigrationRequiredError('shared-state:missing');
        write();
      },
    });
    h.hooks.runDoctorRepair.mockImplementation(async () => { migrated = true; return false; });
    await runGatewayStartupSequence(h.hooks);
    expect(h.hooks.runDoctorRepair).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(h.spawned).toHaveBeenCalledOnce();
  });

  it('allows a second bounded repair only when the pending migration reason changes', async () => {
    const h = harness();
    let repairs = 0;
    h.preparations.register('auth', {
      checkReady: () => repairs === 2 ? { ready: true } : { ready: false, reason: `migration-stage:${repairs}` },
      run: vi.fn(),
    });
    h.hooks.runDoctorRepair.mockImplementation(async () => { repairs++; return false; });
    await runGatewayStartupSequence(h.hooks);
    expect(repairs).toBe(2);
    expect(h.spawned).toHaveBeenCalledOnce();
  });

  it.each(['external', 'owned'] as const)('never runs offline preparations when attaching to %s Gateway', async (mode) => {
    const h = harness();
    const check = vi.fn(() => ({ ready: true as const }));
    const run = vi.fn();
    h.preparations.register('auth', { checkReady: check, run });
    if (mode === 'external') h.hooks.findExistingGateway.mockResolvedValue({ port: 18789 });
    else h.hooks.hasOwnedProcess.mockReturnValue(true);
    await runGatewayStartupSequence(h.hooks);
    expect(check).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(h.hooks.runDoctorRepair).not.toHaveBeenCalled();
    expect(h.spawned).not.toHaveBeenCalled();
  });

  it('does not run Doctor for projection or structural failure', async () => {
    const h = harness();
    h.preparations.register('auth', {
      checkReady: () => ({ ready: true }), run: async () => { throw new Error('auth projection failed'); },
    });
    await expect(runGatewayStartupSequence(h.hooks)).rejects.toBeInstanceOf(GatewayStartupPreparationError);
    expect(h.hooks.runDoctorRepair).not.toHaveBeenCalled();
    expect(h.spawned).not.toHaveBeenCalled();
  });

  it('cancels after offline migration without projecting or spawning', async () => {
    const h = harness();
    const run = vi.fn();
    h.preparations.register('auth', { checkReady: () => ({ ready: false, reason: 'agent-schema:1' }), run });
    h.hooks.runDoctorRepair.mockImplementation(async () => { h.lifecycle.bump('stop'); return false; });
    await expect(runGatewayStartupSequence(h.hooks)).rejects.toBeInstanceOf(LifecycleSupersededError);
    expect(run).not.toHaveBeenCalled();
    expect(h.spawned).not.toHaveBeenCalled();
  });
});
