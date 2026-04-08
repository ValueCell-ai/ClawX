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
import { LifecycleSupersededError } from '@electron/gateway/lifecycle-controller';

function createMockHooks(overrides: Partial<Parameters<typeof runGatewayStartupSequence>[0]> = {}) {
  return {
    port: 18789,
    shouldWaitForPortFree: true,
    hasOwnedProcess: vi.fn().mockReturnValue(false),
    resetStartupStderrLines: vi.fn(),
    getStartupStderrLines: vi.fn().mockReturnValue([]),
    assertLifecycle: vi.fn(),
    findExistingGateway: vi.fn().mockResolvedValue(null),
    connect: vi.fn().mockResolvedValue(undefined),
    onConnectedToExistingGateway: vi.fn(),
    waitForPortFree: vi.fn().mockResolvedValue(undefined),
    startProcess: vi.fn().mockResolvedValue(undefined),
    waitForReady: vi.fn().mockResolvedValue(undefined),
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
    expect(hooks.connect).toHaveBeenCalledWith(18789);
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
    expect(hooks.connect).toHaveBeenCalledWith(18789);
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

    // First attempt: owned-process path → waitForReady throws → retry
    // Second attempt: not owned → normal start path → succeeds
    expect(hasOwnedProcessCalls).toBe(2);
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
});
