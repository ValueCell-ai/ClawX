// @vitest-environment node

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENCLAW_GATEWAY_SHUTDOWN_REQUEST, OPENCLAW_GATEWAY_SHUTDOWN_RESULT } from '@electron/utils/openclaw-utility-process';
import { GATEWAY_GRACEFUL_EXIT_TIMEOUT_MS } from '@electron/gateway/recovery-budget';

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

describe('GatewayManager restart recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.doUnmock('@electron/gateway/ws-client');
    vi.doUnmock('@electron/gateway/process-launcher');
    vi.doUnmock('@electron/gateway/config-sync');
    vi.doUnmock('@electron/gateway/supervisor');
    vi.useRealTimers();
  });

  it('gracefully shuts down an owned Gateway before terminating its process', async () => {
    const terminateOwnedGatewayProcess = vi.fn(async () => {});
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      terminateOwnedGatewayProcess,
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 42, postMessage: vi.fn() });
    const ws = {
      readyState: 1,
      terminate: vi.fn(),
    };
    const internals = manager as unknown as {
      process: Electron.UtilityProcess | null;
      ownsProcess: boolean;
      ws: typeof ws | null;
    };
    internals.process = child as unknown as Electron.UtilityProcess;
    internals.ownsProcess = true;
    internals.ws = ws;

    const rpcSpy = vi.spyOn(manager, 'rpc');
    child.postMessage.mockImplementation((request) => {
      expect(request.type).toBe(OPENCLAW_GATEWAY_SHUTDOWN_REQUEST);
      expect(child.listenerCount('exit')).toBe(1);
      child.emit('exit', 0);
    });

    await manager.stop();

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(child.postMessage).toHaveBeenCalledOnce();
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('message')).toBe(0);
    expect(terminateOwnedGatewayProcess).not.toHaveBeenCalled();
    expect(ws.terminate).toHaveBeenCalledOnce();
    expect(manager.getStatus().state).toBe('stopped');
  });

  it('force-terminates an owned Gateway only after the graceful shutdown budget expires', async () => {
    const terminateOwnedGatewayProcess = vi.fn(async () => {});
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      terminateOwnedGatewayProcess,
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 43, postMessage: vi.fn() });
    const ws = {
      readyState: 1,
      terminate: vi.fn(),
    };
    const internals = manager as unknown as {
      process: Electron.UtilityProcess | null;
      ownsProcess: boolean;
      ws: typeof ws | null;
    };
    internals.process = child as unknown as Electron.UtilityProcess;
    internals.ownsProcess = true;
    internals.ws = ws;
    child.postMessage.mockImplementation((request) => {
      child.emit('message', { type: OPENCLAW_GATEWAY_SHUTDOWN_RESULT, requestId: request.requestId, accepted: true });
    });

    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(GATEWAY_GRACEFUL_EXIT_TIMEOUT_MS - 1);
    expect(terminateOwnedGatewayProcess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await stopPromise;

    expect(terminateOwnedGatewayProcess).toHaveBeenCalledOnce();
    expect(terminateOwnedGatewayProcess).toHaveBeenCalledWith(child);
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('message')).toBe(0);
  });

  it('allows a ten-second resource cleanup to exit naturally without force termination', async () => {
    const terminateOwnedGatewayProcess = vi.fn(async () => {});
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      terminateOwnedGatewayProcess,
    }));
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 47, postMessage: vi.fn() });
    Object.assign(manager, { process: child, ownsProcess: true });
    child.postMessage.mockImplementation((request) => {
      child.emit('message', { type: OPENCLAW_GATEWAY_SHUTDOWN_RESULT, requestId: request.requestId, accepted: true });
      setTimeout(() => child.emit('exit', 0), 10_000);
    });
    let stopped = false;
    const stopPromise = manager.stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(stopped).toBe(false);
    expect(terminateOwnedGatewayProcess).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stopPromise;
    expect(stopped).toBe(true);
    expect(manager.getStatus().state).toBe('stopped');
    expect(child.listenerCount('exit')).toBe(0);
    expect(child.listenerCount('message')).toBe(0);
    await vi.advanceTimersByTimeAsync(GATEWAY_GRACEFUL_EXIT_TIMEOUT_MS);
    expect(terminateOwnedGatewayProcess).not.toHaveBeenCalled();
  });

  it('gracefully stops an owned process even without a WebSocket connection', async () => {
    const terminateOwnedGatewayProcess = vi.fn(async () => {});
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      terminateOwnedGatewayProcess,
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 44, postMessage: vi.fn() });
    const internals = manager as unknown as {
      process: Electron.UtilityProcess | null;
      ownsProcess: boolean;
      ws: null;
    };
    internals.process = child as unknown as Electron.UtilityProcess;
    internals.ownsProcess = true;
    internals.ws = null;
    const rpcSpy = vi.spyOn(manager, 'rpc');

    const stopPromise = manager.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    child.emit('exit', 0);
    await stopPromise;

    expect(terminateOwnedGatewayProcess).not.toHaveBeenCalled();
    expect(child.postMessage).toHaveBeenCalledOnce();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it.each(['unavailable-handler', 'send-failure', 'abnormal-exit'])(
    'handles %s without waiting for an impossible graceful exit', async (failure) => {
      const terminateOwnedGatewayProcess = vi.fn(async () => {});
      vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
        ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
        terminateOwnedGatewayProcess,
      }));
      const { GatewayManager } = await import('@electron/gateway/manager');
      const { logger } = await import('@electron/utils/logger');
      const manager = new GatewayManager();
      const child = Object.assign(new EventEmitter(), { pid: 45, postMessage: vi.fn() });
      Object.assign(manager, { process: child, ownsProcess: true });
      child.postMessage.mockImplementation((request) => {
        if (failure === 'send-failure') throw new Error('parent port closed');
        if (failure === 'abnormal-exit') child.emit('exit', 1);
        else child.emit('message', {
          type: OPENCLAW_GATEWAY_SHUTDOWN_RESULT, requestId: request.requestId,
          accepted: false, reason: 'SIGTERM handler is not installed',
        });
      });
      await manager.stop();
      expect(terminateOwnedGatewayProcess).toHaveBeenCalledTimes(failure === 'abnormal-exit' ? 0 : 1);
      expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('Gateway exited gracefully');
      expect(child.listenerCount('exit')).toBe(0);
      expect(child.listenerCount('message')).toBe(0);
      expect(manager.getStatus().state).toBe('stopped');
    },
  );

  it('ignores unrelated private shutdown responses until the owned process exits', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 46, postMessage: vi.fn() });
    Object.assign(manager, { process: child, ownsProcess: true });
    const stopPromise = manager.stop();
    child.emit('message', { type: OPENCLAW_GATEWAY_SHUTDOWN_RESULT, requestId: 'unrelated', accepted: false });
    await vi.advanceTimersByTimeAsync(1);
    expect(child.listenerCount('exit')).toBe(1);
    child.emit('exit', 0);
    await stopPromise;
  });

  it('re-enables auto-reconnect when start() fails during restart', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    // Expose private members for testing
    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
      stop: () => Promise<void>;
      start: () => Promise<void>;
    };

    // Set the manager into a state where restart can proceed:
    // - state must not be 'starting' or 'reconnecting' (would defer restart)
    // - startLock must be false
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to just reset flags (simulates normal stop)
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to fail (simulates the race condition where gateway
    // is reachable but not attachable after in-process restart)
    vi.spyOn(manager, 'start').mockRejectedValue(
      new Error('WebSocket closed before handshake: unknown'),
    );

    // Spy on scheduleReconnect
    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    // Perform the restart - it should throw because start() fails
    await expect(manager.restart()).rejects.toThrow(
      'WebSocket closed before handshake: unknown',
    );

    // KEY ASSERTION: After start() fails in restart(), shouldReconnect
    // must be re-enabled so the gateway can self-heal
    expect(internals.shouldReconnect).toBe(true);
    expect(scheduleReconnectSpy).toHaveBeenCalled();
  });

  it('does not schedule extra reconnect when restart succeeds', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const internals = manager as unknown as {
      shouldReconnect: boolean;
      status: { state: string; port: number };
      startLock: boolean;
      reconnectTimer: NodeJS.Timeout | null;
      restartInFlight: Promise<void> | null;
      scheduleReconnect: () => void;
    };

    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    // Mock stop to reset flags
    vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.shouldReconnect = false;
      internals.status = { state: 'stopped', port: 18789 };
    });

    // Mock start to succeed
    vi.spyOn(manager, 'start').mockImplementation(async () => {
      internals.shouldReconnect = true;
      internals.status = { state: 'running', port: 18789 };
    });

    const scheduleReconnectSpy = vi.spyOn(
      internals as unknown as { scheduleReconnect: () => void },
      'scheduleReconnect',
    );

    await manager.restart();

    // scheduleReconnect should NOT have been called by the catch block
    // (it may be called from other paths, but not the restart-recovery catch)
    expect(scheduleReconnectSpy).not.toHaveBeenCalled();
  });

  it.each([1, 2])('preserves the fatal ownership decision during restart with exit code %s', async (exitCode) => {
    const ownershipError = 'failed to acquire gateway state ownership; waited 301732ms for Gateway state ownership';
    const runDoctorRepair = vi.fn();
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      findExistingGatewayProcess: vi.fn(async () => null),
      waitForPortFree: vi.fn(async () => {}),
      warmupManagedPythonReadiness: vi.fn(),
      runOpenClawDoctorRepair: runDoctorRepair,
    }));
    vi.doMock('@electron/gateway/ws-client', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/ws-client')>(),
      waitForGatewayReady: vi.fn(async () => {
        throw new Error(`Gateway process exited before becoming ready (code=${exitCode})`);
      }),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      shouldReconnect: boolean;
      processExitCode: number | null;
      recentStartupStderrLines: string[];
      status: { state: string; port: number };
      initDeviceIdentity: () => Promise<void>;
      startProcess: () => Promise<void>;
      scheduleReconnect: () => void;
    };
    internals.status = { state: 'running', port: 18789 };
    vi.spyOn(internals, 'initDeviceIdentity').mockResolvedValue();
    const startProcessSpy = vi.spyOn(internals, 'startProcess').mockImplementation(async () => {
      internals.processExitCode = exitCode;
      internals.recentStartupStderrLines = [ownershipError];
    });
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');

    await expect(manager.restart()).rejects.toThrow('Gateway process exited before becoming ready');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(manager.getStatus().state).toBe('error');
    expect(internals.shouldReconnect).toBe(false);
    expect(startProcessSpy).toHaveBeenCalledOnce();
    expect(runDoctorRepair).not.toHaveBeenCalled();
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('does not force-terminate from a stale readiness failure while stop is awaiting graceful exit', async () => {
    let rejectReadiness!: (error: Error) => void;
    let readinessStarted!: () => void;
    const readinessStart = new Promise<void>((resolve) => { readinessStarted = resolve; });
    vi.doMock('@electron/gateway/supervisor', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/supervisor')>(),
      findExistingGatewayProcess: vi.fn(async () => null),
      waitForPortFree: vi.fn(async () => {}),
      warmupManagedPythonReadiness: vi.fn(),
    }));
    vi.doMock('@electron/gateway/ws-client', async (importOriginal) => ({
      ...await importOriginal<typeof import('@electron/gateway/ws-client')>(),
      waitForGatewayReady: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectReadiness = reject;
        readinessStarted();
      })),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const child = Object.assign(new EventEmitter(), { pid: 42, postMessage: vi.fn() });
    const ws = { readyState: 1, terminate: vi.fn() };
    const internals = manager as unknown as {
      process: Electron.UtilityProcess | null;
      processExitCode: number | null;
      ownsProcess: boolean;
      ws: typeof ws | null;
      shouldReconnect: boolean;
      initDeviceIdentity: () => Promise<void>;
      startProcess: () => Promise<void>;
      scheduleReconnect: () => void;
    };
    vi.spyOn(internals, 'initDeviceIdentity').mockResolvedValue();
    vi.spyOn(internals, 'startProcess').mockImplementation(async () => {
      internals.process = child as unknown as Electron.UtilityProcess;
      internals.ownsProcess = true;
      internals.processExitCode = null;
    });
    const forceTerminateSpy = vi.spyOn(manager, 'forceTerminateOwnedProcessForQuit').mockResolvedValue(false);
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');

    const startPromise = manager.start();
    await readinessStart;
    internals.ws = ws;
    const stopPromise = manager.stop();
    rejectReadiness(new Error('WebSocket closed before handshake'));
    await startPromise;

    expect(forceTerminateSpy).not.toHaveBeenCalled();
    expect(internals.process).toBe(child);
    expect(reconnectSpy).not.toHaveBeenCalled();
    child.emit('exit', 0);
    await stopPromise;
    expect(manager.getStatus().state).toBe('stopped');
    expect(internals.shouldReconnect).toBe(false);
  });

  it('cancels deadline recovery on a code-1012 socket reload without restarting the owned process', async () => {
    let onCloseAfterHandshake: ((code: number) => void) | undefined;
    const ws = {
      readyState: 1,
      ping: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn(),
    };
    vi.doMock('@electron/gateway/ws-client', () => ({
      connectGatewaySocket: vi.fn(async (options: {
        onHandshakeComplete: (socket: typeof ws) => void;
        onCloseAfterHandshake: (code: number) => void;
      }) => {
        onCloseAfterHandshake = options.onCloseAfterHandshake;
        options.onHandshakeComplete(ws);
        return ws;
      }),
      waitForGatewayReady: vi.fn(),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      ownsProcess: boolean;
      connect: (port: number) => Promise<void>;
      scheduleReconnect: () => void;
      connectionMonitor: { clear: () => void };
    };
    internals.ownsProcess = true;
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await internals.connect(18789);
    onCloseAfterHandshake?.(1012);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
    internals.connectionMonitor.clear();
  });

  it('cancels deadline recovery when an owned process exits', async () => {
    let onExit: ((child: unknown, code: number | null) => void) | undefined;
    const child = { pid: 42 };
    vi.doMock('@electron/gateway/config-sync', () => ({
      prepareGatewayLaunchContext: vi.fn(async () => ({})),
    }));
    vi.doMock('@electron/gateway/process-launcher', () => ({
      launchGatewayProcess: vi.fn(async (options: {
        onExit: (exitedChild: unknown, code: number | null) => void;
      }) => {
        onExit = options.onExit;
        return { child, lastSpawnSummary: 'test' };
      }),
    }));

    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      startProcess: () => Promise<void>;
      recoveryController: { start: () => void };
      scheduleReconnect: () => void;
    };
    internals.status = { state: 'running', port: 18789 };
    internals.recoveryController.start();
    const reconnectSpy = vi.spyOn(internals, 'scheduleReconnect');
    const restartSpy = vi.spyOn(manager, 'restart').mockResolvedValue();
    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue({});

    await internals.startProcess();
    onExit?.(child, 1);
    await vi.advanceTimersByTimeAsync(180_000);

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(restartSpy).not.toHaveBeenCalled();
  });
});
