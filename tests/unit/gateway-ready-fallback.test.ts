// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDatabaseAdmissionResult } from '@electron/gateway/agent-database-admission';
import type { GatewayStatus } from '@electron/gateway/manager';
import { GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS } from '@electron/gateway/recovery-budget';

const { removeUpgradeSnapshotMock, admissionProbe } = vi.hoisted(() => ({
  removeUpgradeSnapshotMock: vi.fn(async () => ({ status: 'removed' as const, snapshotDir: '/tmp/snapshot' })),
  admissionProbe: vi.fn<() => Promise<AgentDatabaseAdmissionResult>>(async () => ({ state: 'ready' })),
}));

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, utilityProcess: {} }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@electron/utils/config', () => ({ PORTS: { OPENCLAW_GATEWAY: 18789 } }));
vi.mock('@electron/utils/openclaw-upgrade-snapshot', () => ({ removeOpenClawUpgradeSnapshot: removeUpgradeSnapshotMock }));
vi.mock('@electron/gateway/agent-database-admission', () => ({ probeAgentDatabaseAdmissions: admissionProbe }));
vi.mock('@electron/gateway/startup-orchestrator', () => ({
  runGatewayStartupSequence: vi.fn(async () => { throw new Error('startup unavailable in unit test'); }),
}));

const pending: AgentDatabaseAdmissionResult = { state: 'pending', agentIds: ['main'] };
const superseded: AgentDatabaseAdmissionResult = {
  state: 'failed',
  failures: [{ agentId: 'main', code: 'agent-database-inspection-failed', reason: 'prepared model runtime publication was superseded for main' }],
  pendingAgentIds: [],
};

async function createManager(owned = false) {
  const { GatewayManager } = await import('@electron/gateway/manager');
  const manager = new GatewayManager();
  const internals = manager as unknown as {
    stateController: { setStatus: (status: Partial<GatewayStatus>) => void };
    clearGatewayReadyAdmission: () => void;
    scheduleGatewayReadyFallback: () => void;
    ownsProcess: boolean;
    shouldReconnect: boolean;
    startLock: boolean;
    restartInFlight: Promise<void> | null;
  };
  let connection = 0;
  const setRunning = () => {
    internals.ownsProcess = owned;
    internals.shouldReconnect = true;
    internals.stateController.setStatus({ state: 'running', connectedAt: ++connection, gatewayReady: false, error: undefined });
  };
  setRunning();
  const updates: GatewayStatus[] = [];
  manager.on('status', (status) => updates.push(status));
  const readyUpdates = () => updates.filter((status) => status.gatewayReady === true);
  const signalReady = async () => {
    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);
  };
  return { manager, internals, setRunning, readyUpdates, signalReady };
}

describe('GatewayManager gatewayReady fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    admissionProbe.mockReset().mockResolvedValue({ state: 'ready' });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps starting unready and admits after a ready event', async () => {
    const { manager, internals, setRunning, signalReady, readyUpdates } = await createManager();
    internals.stateController.setStatus({ state: 'starting', gatewayReady: false });
    await signalReady();
    expect(manager.getStatus().gatewayReady).toBe(false);
    expect(readyUpdates()).toHaveLength(0);
    setRunning();
    await signalReady();
    expect(readyUpdates()).toHaveLength(1);
    expect(removeUpgradeSnapshotMock).not.toHaveBeenCalled();
  });

  it('checks admission after the fallback RPC router probe succeeds', async () => {
    const { manager, internals, readyUpdates } = await createManager();
    const rpc = vi.spyOn(manager, 'rpc').mockResolvedValue({ ok: true });
    internals.scheduleGatewayReadyFallback();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyUpdates()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyUpdates()).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('system-presence', {}, 5_000);
    expect(admissionProbe).toHaveBeenCalledWith(18789);
    expect(removeUpgradeSnapshotMock).not.toHaveBeenCalled();
  });

  it('keeps unready when the fallback RPC router probe fails', async () => {
    const { manager, internals, readyUpdates } = await createManager();
    vi.spyOn(manager, 'rpc').mockRejectedValue(new Error('RPC timeout: system-presence'));
    internals.scheduleGatewayReadyFallback();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(readyUpdates()).toHaveLength(0);
    expect(admissionProbe).not.toHaveBeenCalled();
  });

  it('cancels fallback on the ready event and does not emit duplicate ready transitions', async () => {
    const { manager, internals, signalReady, readyUpdates } = await createManager();
    const rpc = vi.spyOn(manager, 'rpc');
    internals.scheduleGatewayReadyFallback();
    await signalReady();
    await signalReady();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(readyUpdates()).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('waits for admission without parallel gates on duplicate ready events', async () => {
    const { signalReady, readyUpdates } = await createManager();
    admissionProbe.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending);
    await signalReady();
    await signalReady();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyUpdates()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(readyUpdates()).toHaveLength(1);
    expect(admissionProbe).toHaveBeenCalledTimes(4);
  });

  it('does not interrupt slow upgrade preparation or publish ready at the old timeout', async () => {
    const { manager, signalReady, readyUpdates } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    admissionProbe.mockResolvedValue(pending);
    await signalReady();
    await vi.advanceTimersByTimeAsync(GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS + 10_000);
    expect(readyUpdates()).toHaveLength(0);
    expect(restart).not.toHaveBeenCalled();
    expect(manager.getStatus().error).toContain('taking longer than expected');
    admissionProbe.mockResolvedValue({ state: 'ready' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readyUpdates()).toHaveLength(1);
    expect(manager.getStatus().error).toBeUndefined();
    expect(removeUpgradeSnapshotMock).not.toHaveBeenCalled();
  });

  it('retries an unavailable probe before using the legacy fallback', async () => {
    const { signalReady, readyUpdates } = await createManager();
    admissionProbe.mockResolvedValue({ state: 'unknown' });
    await signalReady();
    expect(readyUpdates()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readyUpdates()).toHaveLength(1);
    expect(admissionProbe).toHaveBeenCalledTimes(3);
  });

  it('does not let unavailable probes erase observed pending admission, even on reconnect', async () => {
    const { manager, internals, setRunning, signalReady, readyUpdates } = await createManager();
    admissionProbe.mockResolvedValue(pending);
    await signalReady();
    admissionProbe.mockResolvedValue({ state: 'unknown' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(readyUpdates()).toHaveLength(0);
    internals.stateController.setStatus({ state: 'reconnecting', gatewayReady: false });
    setRunning();
    await signalReady();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(readyUpdates()).toHaveLength(0);
    expect(manager.getStatus().error).toContain('Unable to verify');
  });

  it('reports failed admission rather than readiness and never restarts migration failures', async () => {
    const { manager, signalReady, readyUpdates } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    admissionProbe.mockResolvedValueOnce(pending).mockResolvedValue({
      state: 'failed', failures: [{ agentId: 'main', code: 'agent-database-inspection-failed', reason: 'schema migration required', repairHint: 'Run doctor --fix' }], pendingAgentIds: [],
    });
    await signalReady();
    await vi.advanceTimersByTimeAsync(GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS + 10_000);
    expect(readyUpdates()).toHaveLength(0);
    expect(manager.getStatus().error).toContain('schema migration required\nRun doctor --fix');
    expect(restart).not.toHaveBeenCalled();
    admissionProbe.mockResolvedValue({ state: 'unknown' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(readyUpdates()).toHaveLength(0);
    expect(manager.getStatus().error).toContain('schema migration required');
  });

  it('recovers superseded publication once, retaining the budget across stop/start and duplicate events', async () => {
    const { manager, setRunning, signalReady, readyUpdates } = await createManager(true);
    admissionProbe.mockResolvedValue(superseded);
    const restart = vi.spyOn(manager, 'restart').mockImplementation(async () => {
      await manager.stop();
      setRunning();
      manager.emit('gateway:ready', {});
    });
    await signalReady();
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).toHaveBeenCalledTimes(1);
    await signalReady();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(readyUpdates()).toHaveLength(0);
    expect(manager.getStatus().error).toContain('publication was superseded');
    expect(removeUpgradeSnapshotMock).not.toHaveBeenCalled();

    admissionProbe.mockResolvedValue({ state: 'ready' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readyUpdates()).toHaveLength(1);
    expect(manager.getStatus().error).toBeUndefined();

    // A later independent startup may recover once again after confirmed health.
    setRunning();
    admissionProbe.mockResolvedValue(superseded);
    await signalReady();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it.each(['external', 'pending-peer', 'unrecognized-code', 'mixed-failure'] as const)(
    'does not auto-restart superseded admission with %s', async (scenario) => {
      const { manager, signalReady, readyUpdates } = await createManager(scenario !== 'external');
      const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
      const result = structuredClone(superseded);
      if (result.state !== 'failed') throw new Error('expected failure fixture');
      if (scenario === 'pending-peer') result.pendingAgentIds = ['other'];
      if (scenario === 'unrecognized-code') result.failures[0].code = 'future-refusal';
      if (scenario === 'mixed-failure') result.failures.push({ agentId: 'other', code: 'agent-database-inspection-failed', reason: 'database requires doctor' });
      admissionProbe.mockResolvedValue(result);
      await signalReady();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(restart).not.toHaveBeenCalled();
      expect(readyUpdates()).toHaveLength(0);
    },
  );

  it('waits for startup/restart coordination to settle before recovery', async () => {
    const { manager, internals, signalReady } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    admissionProbe.mockResolvedValue(superseded);
    internals.startLock = true;
    await signalReady();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(restart).not.toHaveBeenCalled();
    internals.startLock = false;
    internals.restartInFlight = Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(restart).not.toHaveBeenCalled();
    internals.restartInFlight = null;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled recovery on stop', async () => {
    const { manager, signalReady } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    admissionProbe.mockResolvedValue(superseded);
    await signalReady();
    await manager.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(restart).not.toHaveBeenCalled();
    expect(manager.getStatus().state).toBe('stopped');
  });

  it('drops stale admission results and recovery when the connection changes', async () => {
    const { manager, internals, setRunning, signalReady, readyUpdates } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    let resolveProbe!: (result: AgentDatabaseAdmissionResult) => void;
    admissionProbe.mockImplementationOnce(() => new Promise((resolve) => { resolveProbe = resolve; }));
    await signalReady();
    internals.stateController.setStatus({ state: 'starting', gatewayReady: false });
    setRunning();
    await signalReady();
    resolveProbe(superseded);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(restart).not.toHaveBeenCalled();
    expect(readyUpdates()).toHaveLength(1);
    expect(manager.getStatus().error).toBeUndefined();
  });

  it('rechecks admission instead of restarting after the failure clears', async () => {
    const { manager, signalReady, readyUpdates } = await createManager(true);
    const restart = vi.spyOn(manager, 'restart').mockResolvedValue();
    admissionProbe.mockResolvedValueOnce(superseded);
    await signalReady();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restart).not.toHaveBeenCalled();
    expect(readyUpdates()).toHaveLength(1);
  });
});
