import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {},
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { runGatewayStartupSequence } from '@electron/gateway/startup-orchestrator';
import { GatewayLifecycleController, LifecycleSupersededError } from '@electron/gateway/lifecycle-controller';

function createMockHooks(overrides: Partial<Parameters<typeof runGatewayStartupSequence>[0]> = {}) {
  return {
    port: 18789,
    shouldWaitForPortFree: true,
    hasOwnedProcess: vi.fn().mockReturnValue(false),
    resetStartupStderrLines: vi.fn(),
    getStartupStderrLines: vi.fn().mockReturnValue([]),
    getProcessExitCode: vi.fn().mockReturnValue(null),
    assertLifecycle: vi.fn(),
    findExistingGateway: vi.fn().mockResolvedValue(null),
    connect: vi.fn().mockResolvedValue(undefined),
    onConnectedToExistingGateway: vi.fn(),
    waitForPortFree: vi.fn().mockResolvedValue(undefined),
    startProcess: vi.fn().mockResolvedValue(undefined),
    waitForReady: vi.fn().mockResolvedValue(undefined),
    terminateStaleOwnedProcess: vi.fn().mockResolvedValue(undefined),
    onConnectedToManagedGateway: vi.fn(),
    runDoctorRepair: vi.fn().mockResolvedValue(false),
    onDoctorRepairSuccess: vi.fn(),
    delay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runGatewayStartupSequence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects to existing gateway when findExistingGateway returns a result', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue({ port: 18789, externalToken: 'tok-ext' }),
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.findExistingGateway).toHaveBeenCalledWith(18789);
    expect(hooks.connect).toHaveBeenCalledWith(18789, 'tok-ext');
    expect(hooks.onConnectedToExistingGateway).toHaveBeenCalledTimes(1);
    expect(hooks.startProcess).not.toHaveBeenCalled();
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/find-existing');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/connect-existing');
  });

  it('waits for owned process when hasOwnedProcess returns true (in-process restart path)', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(true),
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.findExistingGateway).toHaveBeenCalledWith(18789);
    expect(hooks.hasOwnedProcess).toHaveBeenCalled();
    expect(hooks.waitForReady).toHaveBeenCalledWith(18789);
    expect(hooks.connect).toHaveBeenCalledWith(18789, undefined);
    expect(hooks.onConnectedToExistingGateway).toHaveBeenCalledTimes(1);

    // Must NOT start a new process or wait for port free
    expect(hooks.startProcess).not.toHaveBeenCalled();
    expect(hooks.waitForPortFree).not.toHaveBeenCalled();
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();

    // Verify lifecycle assertions for the owned-process path
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/wait-ready-owned');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/connect-owned');
  });

  it('starts new process when no existing gateway and no owned process', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      shouldWaitForPortFree: true,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.findExistingGateway).toHaveBeenCalledWith(18789);
    expect(hooks.hasOwnedProcess).toHaveBeenCalled();
    expect(hooks.waitForPortFree).toHaveBeenCalledWith(18789);
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.waitForReady).toHaveBeenCalledWith(18789);
    expect(hooks.connect).toHaveBeenCalledWith(18789, undefined);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToExistingGateway).not.toHaveBeenCalled();

    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/wait-port');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/start-process');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/wait-ready');
    expect(hooks.assertLifecycle).toHaveBeenCalledWith('start/connect');
  });

  it('skips waitForPortFree when shouldWaitForPortFree is false', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      shouldWaitForPortFree: false,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.waitForPortFree).not.toHaveBeenCalled();
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('retries on transient WebSocket errors', async () => {
    let callCount = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('WebSocket closed before handshake: unknown');
        }
      }),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    // First attempt fails with transient error, second succeeds
    expect(hooks.connect).toHaveBeenCalledTimes(2);
    expect(hooks.delay).toHaveBeenCalledWith(1000);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('runs doctor repair when packaged OpenClaw exits 1 without config diagnostics', async () => {
    let readyCalls = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      waitForReady: vi.fn().mockImplementation(async () => {
        readyCalls++;
        if (readyCalls === 1) throw new Error('Gateway process exited before becoming ready (code=1)');
      }),
      getProcessExitCode: vi.fn().mockReturnValue(1),
      runDoctorRepair: vi.fn().mockResolvedValue(true),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.onDoctorRepairSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('runs doctor repair on config-invalid stderr signal', async () => {
    let attemptNumber = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      startProcess: vi.fn().mockImplementation(async () => {
        attemptNumber++;
        if (attemptNumber === 1) {
          throw new Error('Gateway process exited before becoming ready (code=1)');
        }
      }),
      getStartupStderrLines: vi.fn().mockReturnValue([
        'Config invalid',
        'Run: openclaw doctor --fix',
      ]),
      runDoctorRepair: vi.fn().mockResolvedValue(true),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.onDoctorRepairSuccess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('migrates a main-built v25 Agent after the 10.10 code 78 refusal', async () => {
    const hooks = createMockHooks({
      waitForReady: vi.fn().mockRejectedValueOnce(new Error('Gateway process exited before becoming ready (code=78)'))
        .mockResolvedValue(undefined),
      getProcessExitCode: vi.fn().mockReturnValue(78),
      getStartupStderrLines: vi.fn().mockReturnValue([
        'Agent main (/tmp/main/openclaw-agent.sqlite): OpenClaw agent database /tmp/main/openclaw-agent.sqlite uses schema version 25; stop active agents and run openclaw doctor --fix to migrate session identities before using it.',
      ]),
      runDoctorRepair: vi.fn().mockResolvedValue(true),
    });
    await runGatewayStartupSequence(hooks);
    expect(hooks.runDoctorRepair).toHaveBeenCalledOnce();
    expect(hooks.startProcess).toHaveBeenCalledTimes(2);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledOnce();
  });

  it('does not run Doctor or repeat startup when another process owns state', async () => {
    const failure = new Error('Gateway process exited before becoming ready (code=1)');
    const hooks = createMockHooks({
      waitForReady: vi.fn().mockRejectedValue(failure),
      getProcessExitCode: vi.fn().mockReturnValue(1),
      getStartupStderrLines: vi.fn().mockReturnValue([
        'Gateway failed to start: failed to acquire gateway state ownership; waited 301732ms for Gateway state ownership: OpenClaw state database is busy at C:\\Users\\user\\.openclaw\\state\\openclaw.sqlite. The holder 4324 is alive on this host, stop it first. | file_lock_timeout',
      ]),
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toBe(failure);

    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.runDoctorRepair).not.toHaveBeenCalled();
    expect(hooks.onDoctorRepairSuccess).not.toHaveBeenCalled();
    expect(hooks.delay).not.toHaveBeenCalled();
  });

  const STATE_MIGRATION_REFUSAL = 'Gateway failed to start: OpenClaw state database schema migration required (audit-events-v2) at C:\\Users\\u\\.openclaw\\state\\openclaw.sqlite; run openclaw doctor --fix to migrate it. | gateway.maintenance_required.';
  const SESSION_STORE_REFUSAL = 'Gateway failed to start: Legacy session store requires migration: C:\\Users\\u\\.openclaw\\agents\\main\\sessions\\sessions.json. Run "openclaw doctor --fix" against the same state/config before starting OpenClaw. | gateway.maintenance_required.';

  function refusingGateway(refusals: string[]) {
    let attempt = 0;
    let stderr: string[] = [];
    return {
      waitForReady: vi.fn().mockImplementation(async () => {
        const refusal = refusals[attempt++];
        if (refusal === undefined) return;
        stderr = ['[gateway] requires migration', refusal];
        throw new Error('Gateway process exited before becoming ready (code=78)');
      }),
      getStartupStderrLines: vi.fn(() => stderr),
      getProcessExitCode: vi.fn(() => (stderr.length > 0 ? 78 : null)),
      resetStartupStderrLines: vi.fn(() => { stderr = []; }),
    };
  }

  it('retries the Gateway after a non-zero Doctor exit and repairs again when the refusal changes', async () => {
    const hooks = createMockHooks({
      ...refusingGateway([STATE_MIGRATION_REFUSAL, SESSION_STORE_REFUSAL]),
      runDoctorRepair: vi.fn().mockResolvedValue(false),
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(2);
    expect(hooks.startProcess).toHaveBeenCalledTimes(3);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });

  it('stops when the Gateway refuses for the same reason after Doctor', async () => {
    const hooks = createMockHooks({
      ...refusingGateway([STATE_MIGRATION_REFUSAL, STATE_MIGRATION_REFUSAL]),
      runDoctorRepair: vi.fn().mockResolvedValue(true),
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toThrow('code=78');

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.startProcess).toHaveBeenCalledTimes(2);
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();
  });

  it('runs Doctor at most twice even when every refusal differs', async () => {
    const hooks = createMockHooks({
      ...refusingGateway([STATE_MIGRATION_REFUSAL, SESSION_STORE_REFUSAL, `${SESSION_STORE_REFUSAL} (2)`]),
      runDoctorRepair: vi.fn().mockResolvedValue(true),
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toThrow('code=78');

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(2);
    expect(hooks.startProcess).toHaveBeenCalledTimes(3);
  });

  it('fails after max attempts with transient errors', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockRejectedValue(new Error('WebSocket closed before handshake: unknown')),
      maxStartAttempts: 3,
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toThrow(
      'WebSocket closed before handshake: unknown',
    );

    // Should have attempted 3 times total
    expect(hooks.connect).toHaveBeenCalledTimes(3);
    expect(hooks.delay).toHaveBeenCalledTimes(2); // delays between retries 1→2, 2→3
  });

  it('owned process path falls back to retry when waitForReady throws a transient error', async () => {
    let waitForReadyCalls = 0;
    let hasOwnedProcessCalls = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockImplementation(() => {
        hasOwnedProcessCalls++;
        // First attempt: owned process is still alive (in-process restart scenario)
        // Second attempt: process exited, no longer owned
        return hasOwnedProcessCalls === 1;
      }),
      waitForReady: vi.fn().mockImplementation(async () => {
        waitForReadyCalls++;
        if (waitForReadyCalls === 1) {
          throw new Error('WebSocket closed before handshake: unknown');
        }
      }),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    // First attempt: owned-process path → waitForReady throws → stale process
    // is terminated and retried. Second attempt starts a fresh process.
    expect(hasOwnedProcessCalls).toBe(2);
    expect(hooks.terminateStaleOwnedProcess).toHaveBeenCalledTimes(1);
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
    expect(hooks.delay).toHaveBeenCalledWith(1000);
  });

  it('re-throws LifecycleSupersededError without retry', async () => {
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      startProcess: vi.fn().mockRejectedValue(
        new LifecycleSupersededError('Lifecycle superseded during start'),
      ),
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toThrow(LifecycleSupersededError);

    // Should NOT retry — only one attempt
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.delay).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not recover an ordinary process exit after stop (owned=%s)', async (owned) => {
    const lifecycle = new GatewayLifecycleController();
    const startEpoch = lifecycle.bump('start');
    const hooks = createMockHooks({
      hasOwnedProcess: vi.fn().mockReturnValue(owned),
      assertLifecycle: vi.fn((phase) => lifecycle.assert(startEpoch, phase)),
      waitForReady: vi.fn().mockImplementation(async () => {
        lifecycle.bump('stop');
        throw new Error('Gateway process exited before becoming ready (code=1)');
      }),
      getProcessExitCode: vi.fn().mockReturnValue(1),
    });

    await expect(runGatewayStartupSequence(hooks)).rejects.toThrow(LifecycleSupersededError);

    expect(hooks.findExistingGateway).toHaveBeenCalledTimes(1);
    expect(hooks.terminateStaleOwnedProcess).not.toHaveBeenCalled();
    expect(hooks.runDoctorRepair).not.toHaveBeenCalled();
    expect(hooks.onDoctorRepairSuccess).not.toHaveBeenCalled();
    expect(hooks.delay).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not update or retry a cancelled startup after Doctor resolves %s', async (repaired) => {
    const lifecycle = new GatewayLifecycleController();
    const startEpoch = lifecycle.bump('start');
    let resolveDoctor!: (result: boolean) => void;
    let doctorStarted!: () => void;
    const doctorInFlight = new Promise<void>((resolve) => { doctorStarted = resolve; });
    const hooks = createMockHooks({
      assertLifecycle: vi.fn((phase) => lifecycle.assert(startEpoch, phase)),
      waitForReady: vi.fn().mockRejectedValue(new Error('Gateway process exited before becoming ready (code=1)')),
      getProcessExitCode: vi.fn().mockReturnValue(1),
      runDoctorRepair: vi.fn(() => {
        doctorStarted();
        return new Promise<boolean>((resolve) => { resolveDoctor = resolve; });
      }),
    });
    const startup = runGatewayStartupSequence(hooks);
    const rejected = expect(startup).rejects.toThrow(LifecycleSupersededError);
    await doctorInFlight;
    lifecycle.bump('stop');
    resolveDoctor(repaired);
    await rejected;

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.onDoctorRepairSuccess).not.toHaveBeenCalled();
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();
    expect(hooks.delay).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves Doctor errors only while startup remains current (stopped=%s)', async (stopped) => {
    const lifecycle = new GatewayLifecycleController();
    const startEpoch = lifecycle.bump('start');
    const doctorFailure = new Error('Unable to resolve Doctor runtime environment');
    let rejectDoctor!: (error: Error) => void;
    let doctorStarted!: () => void;
    const doctorInFlight = new Promise<void>((resolve) => { doctorStarted = resolve; });
    const hooks = createMockHooks({
      assertLifecycle: vi.fn((phase) => lifecycle.assert(startEpoch, phase)),
      waitForReady: vi.fn().mockRejectedValue(new Error('Gateway process exited before becoming ready (code=1)')),
      getProcessExitCode: vi.fn().mockReturnValue(1),
      runDoctorRepair: vi.fn(() => {
        doctorStarted();
        return new Promise<boolean>((_resolve, reject) => { rejectDoctor = reject; });
      }),
    });
    const startup = runGatewayStartupSequence(hooks);
    const rejected = stopped
      ? expect(startup).rejects.toThrow(LifecycleSupersededError)
      : expect(startup).rejects.toBe(doctorFailure);
    await doctorInFlight;
    if (stopped) lifecycle.bump('stop');
    rejectDoctor(doctorFailure);
    await rejected;

    expect(hooks.runDoctorRepair).toHaveBeenCalledTimes(1);
    expect(hooks.onDoctorRepairSuccess).not.toHaveBeenCalled();
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).not.toHaveBeenCalled();
    expect(hooks.delay).not.toHaveBeenCalled();
  });

  it('resets startup stderr lines on each attempt', async () => {
    let callCount = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('WebSocket closed before handshake: unknown');
        }
      }),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    // resetStartupStderrLines should be called once per attempt
    expect(hooks.resetStartupStderrLines).toHaveBeenCalledTimes(2);
  });

  it('retries connect in-place when gateway is still starting', async () => {
    let callCount = 0;
    const hooks = createMockHooks({
      findExistingGateway: vi.fn().mockResolvedValue(null),
      hasOwnedProcess: vi.fn().mockReturnValue(false),
      connect: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('gateway starting; retry shortly');
        }
      }),
      delay: vi.fn().mockImplementation(async (ms: number) => {
        // Speed up inner connect retry delays in the test harness.
        if (ms >= 500) {
          await Promise.resolve();
        }
      }),
      maxStartAttempts: 3,
    });

    await runGatewayStartupSequence(hooks);

    expect(hooks.connect).toHaveBeenCalledTimes(2);
    expect(hooks.startProcess).toHaveBeenCalledTimes(1);
    expect(hooks.onConnectedToManagedGateway).toHaveBeenCalledTimes(1);
  });
});
