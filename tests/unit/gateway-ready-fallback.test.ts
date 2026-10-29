// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { removeUpgradeSnapshotMock, probePendingAgentDatabaseAdmissionsMock } = vi.hoisted(() => ({
  removeUpgradeSnapshotMock: vi.fn(async () => ({ status: 'removed' as const, snapshotDir: '/tmp/snapshot' })),
  probePendingAgentDatabaseAdmissionsMock: vi.fn(async (): Promise<string[] | null> => []),
}));

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

vi.mock('@electron/utils/config', () => ({
  PORTS: { OPENCLAW_GATEWAY: 18789 },
}));

vi.mock('@electron/utils/openclaw-upgrade-snapshot', () => ({
  removeOpenClawUpgradeSnapshot: removeUpgradeSnapshotMock,
}));

vi.mock('@electron/gateway/agent-database-admission', () => ({
  probePendingAgentDatabaseAdmissions: probePendingAgentDatabaseAdmissionsMock,
}));

vi.mock('@electron/gateway/startup-orchestrator', () => ({
  runGatewayStartupSequence: vi.fn(async () => {
    throw new Error('startup unavailable in unit test');
  }),
}));

describe('GatewayManager gatewayReady fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    probePendingAgentDatabaseAdmissionsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets gatewayReady=false when entering starting state', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'starting', gatewayReady: false });

    const startingUpdate = statusUpdates.find((u) => u.gatewayReady === false);
    expect(startingUpdate).toBeDefined();
  });

  it('emits gatewayReady=true when gateway:ready event is received', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    // Force internal state to 'running' for the test
    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean; state: string }> = [];
    manager.on('status', (status: { gatewayReady?: boolean; state: string }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady, state: status.state });
    });

    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);

    const readyUpdate = statusUpdates.find((u) => u.gatewayReady === true);
    expect(readyUpdate).toBeDefined();
  });

  it('auto-sets gatewayReady=true after fallback RPC router probe succeeds', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const rpcSpy = vi.spyOn(manager as unknown as { rpc: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown> }, 'rpc')
      .mockResolvedValue({ ok: true });

    // Force internal state to 'running' without gatewayReady
    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    // Call the private scheduleGatewayReadyFallback method
    (manager as unknown as { scheduleGatewayReadyFallback: () => void }).scheduleGatewayReadyFallback();

    // The first readiness probe happens quickly after handshake, not after 30s.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1_000);
    const readyUpdate = statusUpdates.find((u) => u.gatewayReady === true);
    expect(readyUpdate).toBeDefined();
    expect(rpcSpy).toHaveBeenCalledWith('system-presence', {}, 5_000);
    expect(removeUpgradeSnapshotMock).not.toHaveBeenCalled();
  });

  it('keeps gatewayReady=false when fallback RPC router probe fails', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    vi.spyOn(manager as unknown as { rpc: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown> }, 'rpc')
      .mockRejectedValue(new Error('RPC timeout: system-presence'));

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    (manager as unknown as { scheduleGatewayReadyFallback: () => void }).scheduleGatewayReadyFallback();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();
  });

  it('cancels fallback timer when gateway:ready event arrives first', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    // Schedule fallback
    (manager as unknown as { scheduleGatewayReadyFallback: () => void }).scheduleGatewayReadyFallback();

    // gateway:ready event arrives at 5s
    await vi.advanceTimersByTimeAsync(5_000);
    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);

    // After enough time, no duplicate gatewayReady=true
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
  });

  it('defers gatewayReady while an agent database admission is pending after an unclean restart', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    probePendingAgentDatabaseAdmissionsMock
      .mockResolvedValueOnce(['main'])
      .mockResolvedValueOnce(['main'])
      .mockResolvedValueOnce(['main'])
      .mockResolvedValue([]);

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', port: 18789, connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();

    // Duplicate ready signals while gated must not start a parallel gate.
    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(500);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
    expect(probePendingAgentDatabaseAdmissionsMock).toHaveBeenCalledTimes(4);
    expect(probePendingAgentDatabaseAdmissionsMock).toHaveBeenCalledWith(18789);
  });

  it('marks gatewayReady after the bounded admission wait even if inspection never completes', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const { GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS } = await import('@electron/gateway/recovery-budget');
    const manager = new GatewayManager();
    probePendingAgentDatabaseAdmissionsMock.mockResolvedValue(['main']);

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS - 1_000);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
  });

  it('does not block gatewayReady when the readiness probe is unavailable', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    probePendingAgentDatabaseAdmissionsMock.mockResolvedValue(null);

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: Date.now() });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
  });

  it('drops a pending admission gate when the connection changes', async () => {
    vi.resetModules();
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    probePendingAgentDatabaseAdmissionsMock.mockResolvedValue(['main']);

    const stateController = (manager as unknown as { stateController: { setStatus: (u: Record<string, unknown>) => void } }).stateController;
    stateController.setStatus({ state: 'running', connectedAt: 1 });

    const statusUpdates: Array<{ gatewayReady?: boolean }> = [];
    manager.on('status', (status: { gatewayReady?: boolean }) => {
      statusUpdates.push({ gatewayReady: status.gatewayReady });
    });

    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);

    probePendingAgentDatabaseAdmissionsMock.mockResolvedValue([]);
    stateController.setStatus({ state: 'starting', gatewayReady: false });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(statusUpdates.find((u) => u.gatewayReady === true)).toBeUndefined();

    stateController.setStatus({ state: 'running', connectedAt: 2 });
    manager.emit('gateway:ready', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
  });
});
