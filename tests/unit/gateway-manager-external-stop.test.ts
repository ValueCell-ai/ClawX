import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

describe('GatewayManager external stop behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('disconnects from an external gateway without sending shutdown by default', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      terminate: vi.fn(),
    };

    Object.assign(manager as object, {
      ownsProcess: false,
      ws,
      externalShutdownSupported: null,
      status: { state: 'running', port: 18789 },
    });

    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue(undefined as never);

    await manager.stop();

    expect(rpcSpy).not.toHaveBeenCalled();
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });

  it('can explicitly request external shutdown when asked by restart flows', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();

    const ws = {
      readyState: 1,
      terminate: vi.fn(),
    };

    Object.assign(manager as object, {
      ownsProcess: false,
      ws,
      externalShutdownSupported: null,
      status: { state: 'running', port: 18789 },
    });

    const rpcSpy = vi.spyOn(manager, 'rpc').mockResolvedValue(undefined as never);

    await manager.stop({ shutdownExternal: true });

    expect(rpcSpy).toHaveBeenCalledWith('shutdown', undefined, 5000);
    expect(ws.terminate).toHaveBeenCalledTimes(1);
  });
});
