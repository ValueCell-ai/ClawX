// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { GatewayStatus } from '@electron/gateway/manager';
import type { AgentDatabaseAdmissionResult } from '@electron/gateway/agent-database-admission';
import type { launchGatewayProcess } from '@electron/gateway/process-launcher';

const { collectProcessDiagnostics, getDiagnosticEnvironment } = vi.hoisted(() => ({
  collectProcessDiagnostics: vi.fn((pid?: number) => ({ sampledAt: Date.now(), pid, availability: 'available', cpuPercent: 12 })),
  getDiagnosticEnvironment: vi.fn(() => ({ platform: 'win32', logicalCpuCount: 8 })),
}));

vi.mock('@electron/gateway/process-diagnostics', () => ({
  collectGatewayProcessDiagnostics: collectProcessDiagnostics,
  getGatewayDiagnosticEnvironment: getDiagnosticEnvironment,
}));

vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  cancelLocalDeviceAutoApproval: vi.fn(),
  scheduleLocalDeviceAutoApproval: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GatewayManager diagnostics', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T00:00:00.000Z'));
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  afterEach(() => {
    vi.doUnmock('@electron/gateway/config-sync');
    vi.doUnmock('@electron/gateway/process-launcher');
    vi.doUnmock('@electron/gateway/ws-client');
    vi.doUnmock('@electron/gateway/agent-database-admission');
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('updates diagnostics on gateway message, rpc success/timeout, and socket close', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'event',
      event: 'gateway.ready',
      payload: {},
    });
    expect(manager.getDiagnostics().lastAliveAt).toBe(Date.now());

    const successPromise = manager.rpc<{ ok: boolean }>('sessions.list', {}, 1000);
    const successRequestId = Array.from(
      (manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.keys(),
    )[0];
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'res',
      id: successRequestId,
      ok: true,
      payload: { ok: true },
    });
    await expect(successPromise).resolves.toEqual({ ok: true });
    expect(manager.getDiagnostics().lastRpcSuccessAt).toBe(Date.now());
    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);

    const failurePromise = manager.rpc('system-presence', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(failurePromise).rejects.toThrow('RPC timeout: system-presence');

    const diagnostics = manager.getDiagnostics();
    expect(diagnostics.lastRpcFailureAt).toBe(Date.now());
    expect(diagnostics.lastRpcFailureMethod).toBe('system-presence');
    expect(diagnostics.consecutiveRpcFailures).toBe(1);

    (manager as unknown as { recordSocketClose: (code: number) => void }).recordSocketClose(1006);
    expect(manager.getDiagnostics().lastSocketCloseAt).toBe(Date.now());
    expect(manager.getDiagnostics().lastSocketCloseCode).toBe(1006);
  });

  it('does not count gateway-declared rpc errors as transport failures', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };

    const failurePromise = manager.rpc('channels.status', {}, 1000);
    const failureRequestId = Array.from(
      (manager as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests.keys(),
    )[0];
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      type: 'res',
      id: failureRequestId,
      ok: false,
      error: { message: 'channel unavailable' },
    });
    await expect(failurePromise).rejects.toThrow('channel unavailable');

    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);

    const health = buildGatewayHealthSummary({
      status: manager.getStatus(),
      diagnostics: manager.getDiagnostics(),
    });
    expect(health.reasons).not.toContain('rpc_timeout');
  });

  it('records capability timeouts without counting them as core transport failures', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { status: { state: string; port: number } }).status = {
      state: 'running',
      port: 18789,
    };

    const memoryPromise = manager.rpc('doctor.memory.status', {}, 1000);
    vi.advanceTimersByTime(1001);
    await expect(memoryPromise).rejects.toThrow('RPC timeout: doctor.memory.status');

    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);
    expect(manager.getCapabilitySnapshot().memory.state).toBe('degraded');
    expect(manager.getCapabilitySnapshot().memory.error).toContain('doctor.memory.status');
  });

  it('does not let health polling mark core rpc degraded when OpenClaw health/status are slow', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      send: vi.fn(),
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };

    (manager as unknown as { ws: typeof ws }).ws = ws;
    (manager as unknown as { status: { state: string; port: number; gatewayReady: boolean } }).status = {
      state: 'running',
      port: 18789,
      gatewayReady: true,
    };

    const healthPromise = manager.checkHealth();
    await vi.advanceTimersByTimeAsync(3001);
    const health = await healthPromise;

    expect(health.ok).toBe(true);
    expect(manager.getDiagnostics().consecutiveRpcFailures).toBe(0);
    expect(manager.getCapabilitySnapshot().openclawHealth.state).toBe('degraded');
    expect(manager.getCapabilitySnapshot().openclawStatus.state).toBe('degraded');

    const summary = buildGatewayHealthSummary({
      status: manager.getStatus(),
      diagnostics: manager.getDiagnostics(),
    });
    expect(summary.reasons).not.toContain('rpc_timeout');
  });

  it('reports rpc router blocked when a fresh core probe fails after gateway was ready', async () => {
    const { GatewayCapabilityMonitor } = await import('@electron/gateway/capability-monitor');
    const monitor = new GatewayCapabilityMonitor();

    monitor.recordCoreProbe({
      ok: false,
      checkedAt: Date.now(),
      error: 'RPC timeout: system-presence',
    });

    const snapshot = monitor.buildSnapshot({
      status: {
        state: 'running',
        port: 18789,
        gatewayReady: true,
      },
      transportConnected: true,
      diagnostics: {
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 1,
      },
    });

    expect(snapshot.core.rpcRouter).toBe('blocked');
  });

  it('keeps missed pongs degraded diagnostic evidence before a failed deadline probe', async () => {
    const { buildGatewayHealthSummary } = await import('@electron/utils/gateway-health');

    const health = buildGatewayHealthSummary({
      status: { state: 'running', port: 18789 },
      diagnostics: {
        consecutiveHeartbeatMisses: 4,
        consecutiveRpcFailures: 0,
      },
    });
    expect(health.state).toBe('degraded');
    expect(health.reasons).toContain('gateway_degraded');
    expect(health.reasons).not.toContain('gateway_unresponsive');
  });

  type Attempt = {
    id: string;
    requestedAt: number;
    outcome?: 'ready' | 'failed' | 'stopped' | 'superseded';
  };
  type DiagnosticInternals = {
    beginGatewayDiagnostics: (kind: 'start' | 'restart') => Attempt;
    recordDiagnosticStage: (stage: string, attempt?: Attempt) => void;
    finishGatewayDiagnostics: (outcome: NonNullable<Attempt['outcome']>, attempt?: Attempt) => void;
    startDiagnosticTimer: () => void;
    recordHeartbeatTimeout: (misses: number) => void;
    startProcess: () => Promise<void>;
    connect: (port: number) => Promise<void>;
    restartDiagnosticAttempt: Attempt | null;
    process: Electron.UtilityProcess | null;
    ownsProcess: boolean;
    ws: unknown;
    stateController: { setStatus: (status: Partial<GatewayStatus>) => void };
  };

  async function createDiagnosticManager() {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { logger } = await import('@electron/utils/logger');
    const manager = new GatewayManager();
    const internals = manager as unknown as DiagnosticInternals;
    const records = (event?: string) => vi.mocked(logger.info).mock.calls
      .filter(([message]) => message === '[gateway-diagnostics]')
      .map(([, record]) => record as Record<string, unknown>)
      .filter((record) => event === undefined || record.event === event);
    return { manager, internals, records, logger };
  }

  it('samples slow progress every 30 seconds and does not reset a repeated admission stage', async () => {
    const { internals, records } = await createDiagnosticManager();
    internals.process = { pid: 42 } as Electron.UtilityProcess;
    internals.ownsProcess = true;
    const attempt = internals.beginGatewayDiagnostics('start');
    internals.recordDiagnosticStage('admission-pending');
    await vi.advanceTimersByTimeAsync(15_000);
    internals.recordDiagnosticStage('admission-pending');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(records('progress')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(records('admission-pending')).toHaveLength(1);
    expect(records('progress')).toEqual([expect.objectContaining({
      attemptId: attempt.id, elapsedMs: 30_000, stage: 'admission-pending', stageElapsedMs: 30_000,
      resources: expect.objectContaining({ pid: 42, cpuPercent: 12 }),
    })]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(records('progress')).toHaveLength(2);
    expect(collectProcessDiagnostics).toHaveBeenLastCalledWith(42);
  });

  it.each(['ready', 'failed'] as const)('stops periodic sampling after %s', async (outcome) => {
    const { internals, records } = await createDiagnosticManager();
    const attempt = internals.beginGatewayDiagnostics('start');
    await vi.advanceTimersByTimeAsync(1_000);
    internals.finishGatewayDiagnostics(outcome, attempt);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(records(outcome)).toHaveLength(1);
    expect(records('progress')).toHaveLength(0);
  });

  it('finishes diagnostic sampling when stop interrupts startup', async () => {
    const { manager, internals, records } = await createDiagnosticManager();
    internals.beginGatewayDiagnostics('start');
    await vi.advanceTimersByTimeAsync(1_000);
    await manager.stop();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(records('stopped')).toHaveLength(1);
    expect(records('stop-completed')[0]).toMatchObject({ shutdownMethod: 'no-owned-process' });
    expect(records('progress')).toHaveLength(0);
  });

  it('supersedes the old attempt without letting its late completion cancel the new sampler', async () => {
    const { internals, records } = await createDiagnosticManager();
    const oldAttempt = internals.beginGatewayDiagnostics('start');
    await vi.advanceTimersByTimeAsync(10_000);
    const newAttempt = internals.beginGatewayDiagnostics('restart');
    internals.finishGatewayDiagnostics('ready', oldAttempt);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(records('superseded')).toEqual([expect.objectContaining({ attemptId: oldAttempt.id })]);
    expect(records('progress')).toHaveLength(0);
    expect(records('ready')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(records('progress')).toEqual([expect.objectContaining({ attemptId: newAttempt.id, elapsedMs: 30_000 })]);
  });

  it('rate limits heartbeat snapshots without probing or restarting the Gateway', async () => {
    const { manager, internals, records } = await createDiagnosticManager();
    internals.process = { pid: 42 } as Electron.UtilityProcess;
    internals.ownsProcess = true;
    const rpc = vi.spyOn(manager, 'rpc');
    const restart = vi.spyOn(manager, 'restart');
    internals.recordHeartbeatTimeout(1);
    internals.recordHeartbeatTimeout(2);
    await vi.advanceTimersByTimeAsync(29_999);
    internals.recordHeartbeatTimeout(3);
    expect(records('heartbeat-missed')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    internals.recordHeartbeatTimeout(4);
    expect(records('heartbeat-missed')).toHaveLength(2);
    expect(records('heartbeat-missed')[1]).toMatchObject({
      consecutiveHeartbeatMisses: 4, resources: expect.objectContaining({ pid: 42 }),
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('coalesces native resource reads within one second but immediately samples a replacement pid', async () => {
    const { internals } = await createDiagnosticManager();
    internals.process = { pid: 42 } as Electron.UtilityProcess;
    internals.ownsProcess = true;
    internals.beginGatewayDiagnostics('start');
    internals.recordDiagnosticStage('preparing-launch');
    await vi.advanceTimersByTimeAsync(999);
    internals.recordDiagnosticStage('waiting-for-handshake');
    expect(collectProcessDiagnostics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    internals.recordDiagnosticStage('handshake-completed');
    expect(collectProcessDiagnostics).toHaveBeenCalledTimes(2);
    internals.process = { pid: 43 } as Electron.UtilityProcess;
    internals.recordDiagnosticStage('admission-pending');
    expect(collectProcessDiagnostics).toHaveBeenCalledTimes(3);
    expect(collectProcessDiagnostics).toHaveBeenLastCalledWith(43);
  });

  it('does not mix trailing output from the first child into a retry within the same attempt', async () => {
    const callbacks: Parameters<typeof launchGatewayProcess>[0][] = [];
    vi.doMock('@electron/gateway/config-sync', () => ({ prepareGatewayLaunchContext: vi.fn(async () => ({})) }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: Parameters<typeof launchGatewayProcess>[0]) => {
        callbacks.push(options);
        const pid = 41 + callbacks.length;
        options.onSpawn(pid);
        return { child: { pid }, lastSpawnSummary: 'test' };
      }),
    }));
    const { internals, records } = await createDiagnosticManager();
    const attempt = internals.beginGatewayDiagnostics('start');
    await internals.startProcess();
    callbacks[0].onStdoutLine?.('[gateway] startup trace: original.process 999ms total=1000ms');
    await internals.startProcess();
    callbacks[0].onStdoutLine?.('[gateway] startup trace: stale.stdout 9999ms total=10000ms');
    callbacks[0].onStderrLine('[gateway] startup trace: stale.stderr 9999ms total=10000ms');
    callbacks[1].onStdoutLine?.('[gateway] startup trace: retry.process 12ms total=34ms');
    internals.recordHeartbeatTimeout(1);
    expect(records('heartbeat-missed')[0]).toMatchObject({
      attemptId: attempt.id, spawnCount: 2,
      trace: { stageCount: 1, lastStage: 'retry.process', traceTotalMs: 34, slowestStageMs: 12 },
      resources: { pid: 43 },
    });
  });

  it('continues collecting the same child output under a new reconnect start attempt', async () => {
    let callbacks!: Parameters<typeof launchGatewayProcess>[0];
    vi.doMock('@electron/gateway/config-sync', () => ({ prepareGatewayLaunchContext: vi.fn(async () => ({})) }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: typeof callbacks) => {
        callbacks = options;
        options.onSpawn(42);
        return { child: { pid: 42 }, lastSpawnSummary: 'test' };
      }),
    }));
    const { internals, records, logger } = await createDiagnosticManager();
    const firstAttempt = internals.beginGatewayDiagnostics('start');
    await internals.startProcess();
    callbacks.onStdoutLine?.('[gateway] startup trace: first.start 12ms total=34ms');
    const reconnectAttempt = internals.beginGatewayDiagnostics('start');
    callbacks.onStdoutLine?.('[gateway] startup trace: retained.process 56ms total=78ms');
    internals.recordHeartbeatTimeout(1);
    expect(reconnectAttempt.id).not.toBe(firstAttempt.id);
    expect(logger.info).toHaveBeenCalledWith(
      '[gateway-startup] stage=retained.process durationMs=56 totalMs=78',
      { attemptId: reconnectAttempt.id, source: 'stdout' },
    );
    expect(records('heartbeat-missed')[0]).toMatchObject({
      attemptId: reconnectAttempt.id,
      trace: { stageCount: 1, lastStage: 'retained.process' }, resources: { pid: 42 },
    });
  });

  it('keeps arbitrary stdout private and ignores output from a superseded launch', async () => {
    let callbacks!: Parameters<typeof launchGatewayProcess>[0];
    vi.doMock('@electron/gateway/config-sync', () => ({ prepareGatewayLaunchContext: vi.fn(async () => ({})) }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: typeof callbacks) => {
        callbacks = options;
        options.onSpawn(42);
        return { child: { pid: 42 }, lastSpawnSummary: 'test' };
      }),
    }));
    const { internals, logger } = await createDiagnosticManager();
    const attempt = internals.beginGatewayDiagnostics('start');
    await internals.startProcess();
    callbacks.onStdoutLine?.('User private conversation, password=secret-value');
    callbacks.onStdoutLine?.('[gateway] startup trace: plugins.bootstrap 123.4ms total=456.7ms token=secret-value');
    const logText = JSON.stringify([
      ...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.error).mock.calls, ...vi.mocked(logger.debug).mock.calls,
    ]);
    expect(logText).not.toMatch(/private conversation|secret-value|password=/);
    expect(logger.info).toHaveBeenCalledWith(
      '[gateway-startup] stage=plugins.bootstrap durationMs=123.4 totalMs=456.7',
      { attemptId: attempt.id, source: 'stdout' },
    );
    const oldStdout = callbacks.onStdoutLine;
    internals.beginGatewayDiagnostics('start');
    await internals.startProcess();
    vi.mocked(logger.info).mockClear();
    oldStdout?.('[gateway] startup trace: stale.process 12ms total=34ms');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('includes stop and post-handshake admission in correlated request-to-ready timing', async () => {
    const admission = vi.fn<() => Promise<AgentDatabaseAdmissionResult>>().mockResolvedValue({ state: 'pending', agentIds: ['main'] });
    vi.doMock('@electron/gateway/agent-database-admission', () => ({ probeAgentDatabaseAdmissions: admission }));
    vi.doMock('@electron/gateway/config-sync', () => ({
      prepareGatewayLaunchContext: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return {};
      }),
    }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: Parameters<typeof launchGatewayProcess>[0]) => {
        options.onSpawn(43);
        return { child: { pid: 43 }, lastSpawnSummary: 'test' };
      }),
    }));
    vi.doMock('@electron/gateway/ws-client', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/ws-client')>(),
      connectGatewaySocket: vi.fn(async (options: { onHandshakeComplete: (socket: unknown) => void }) => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const socket = { readyState: 1, on: vi.fn(), ping: vi.fn(), send: vi.fn(), terminate: vi.fn() };
        options.onHandshakeComplete(socket);
        return socket;
      }),
    }));
    const { manager, internals, records } = await createDiagnosticManager();
    const child = Object.assign(new EventEmitter(), { pid: 42 });
    internals.process = child as unknown as Electron.UtilityProcess;
    internals.ownsProcess = true;
    internals.ws = { readyState: 1, terminate: vi.fn() };
    vi.spyOn(manager, 'rpc').mockImplementation(async (method) => {
      if (method === 'shutdown') setTimeout(() => child.emit('exit', 0), 500);
      return {};
    });
    const attempt = internals.beginGatewayDiagnostics('restart');
    internals.restartDiagnosticAttempt = attempt;
    const stopping = manager.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    expect(records('ready')).toHaveLength(0);
    internals.startDiagnosticTimer();
    const launching = internals.startProcess();
    await vi.advanceTimersByTimeAsync(1_000);
    await launching;
    const connecting = internals.connect(18789);
    await vi.advanceTimersByTimeAsync(2_000);
    await connecting;
    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(11_999);
    expect(records('ready')).toHaveLength(0);
    expect(manager.getStatus().gatewayReady).not.toBe(true);
    admission.mockResolvedValue({ state: 'ready' });
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.getStatus().gatewayReady).toBe(true);
    expect(records('ready')).toEqual([expect.objectContaining({
      attemptId: attempt.id, kind: 'restart', stopMs: 500, spawnCount: 1,
      spawnToHandshakeMs: 2_000, handshakeToReadyMs: 12_000, requestToReadyMs: 15_500,
    })]);
    expect(records('stop-completed')[0]).toMatchObject({ attemptId: attempt.id, shutdownMethod: 'graceful' });
    const progressCount = records('progress').length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(records('progress')).toHaveLength(progressCount);
  });
});
