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

vi.mock('@electron/utils/config', () => ({
  PORTS: { OPENCLAW_GATEWAY: 18789 },
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
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);

    // After enough time, no duplicate gatewayReady=true
    await vi.advanceTimersByTimeAsync(30_000);
    expect(statusUpdates.filter((u) => u.gatewayReady === true)).toHaveLength(1);
  });
});
