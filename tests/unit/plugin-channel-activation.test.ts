import { describe, expect, it, vi } from 'vitest';
import { ensurePluginChannelRuntimeActivated } from '@electron/services/plugin-channel-activation';

function createGateway(options: {
  state?: string;
  gatewayReady?: boolean;
  status?: unknown;
  rpcError?: Error;
  restartError?: Error;
}) {
  const restart = vi.fn().mockImplementation(async () => {
    if (options.restartError) throw options.restartError;
  });
  const rpc = vi.fn().mockImplementation(async () => {
    if (options.rpcError) throw options.rpcError;
    return options.status ?? { channelAccounts: {} };
  });
  return {
    gateway: {
      getStatus: vi.fn(() => ({
        state: options.state ?? 'running',
        gatewayReady: options.gatewayReady ?? true,
      })),
      rpc,
      restart,
    },
    restart,
    rpc,
  };
}

function liveStatus(channelType: string, accountId: string) {
  return {
    channelAccounts: {
      [channelType]: [{ accountId, connected: true, running: true }],
    },
  };
}

describe('ensurePluginChannelRuntimeActivated', () => {
  it('returns already-live when the account is in the runtime snapshot', async () => {
    const { gateway, restart } = createGateway({
      status: liveStatus('dingtalk', 'default'),
    });

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      sleep: async () => undefined,
    })).resolves.toBe('already-live');
    expect(restart).not.toHaveBeenCalled();
  });

  it('waits for a native reload and does not restart when the account appears', async () => {
    let calls = 0;
    const restart = vi.fn().mockResolvedValue(undefined);
    const gateway = {
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
      rpc: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 3) return { channelAccounts: {} };
        return liveStatus('openclaw-weixin', 'wx-account');
      }),
      restart,
    };
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'openclaw-weixin', 'wx-account', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 2000,
      pollIntervalMs: 500,
    })).resolves.toBe('hot-activated');
    expect(restart).not.toHaveBeenCalled();
  });

  it('forces one Gateway restart when the wait window misses', async () => {
    const { gateway, restart, rpc } = createGateway({
      status: { channelAccounts: {} },
    });
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 1000,
      pollIntervalMs: 500,
      postRestartWaitMs: 500,
    })).resolves.toBe('restarted');
    expect(restart).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalled();
  });

  it('does not restart while Gateway is reconnecting', async () => {
    const restart = vi.fn().mockResolvedValue(undefined);
    const gateway = {
      getStatus: vi.fn(() => ({ state: 'reconnecting' })),
      rpc: vi.fn().mockResolvedValue({ channelAccounts: {} }),
      restart,
    };
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 1000,
      pollIntervalMs: 500,
    })).resolves.toBe('unavailable');
    expect(restart).not.toHaveBeenCalled();
  });

  it('does not restart while Gateway is running but its subsystems are not ready yet', async () => {
    const { gateway, restart } = createGateway({
      status: { channelAccounts: {} },
      gatewayReady: false,
    });
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 1000,
      pollIntervalMs: 500,
    })).resolves.toBe('unavailable');
    expect(restart).not.toHaveBeenCalled();
  });

  it('returns unavailable instead of throwing when the forced restart fails', async () => {
    const { gateway, restart } = createGateway({
      status: { channelAccounts: {} },
      restartError: new Error('Gateway start failed: port in use'),
    });
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 1000,
      pollIntervalMs: 500,
      postRestartWaitMs: 500,
    })).resolves.toBe('unavailable');
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('skips activation when Gateway is stopped', async () => {
    const { gateway, restart, rpc } = createGateway({ state: 'stopped' });

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default')).resolves.toBe('unavailable');
    expect(rpc).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('does not restart when every channels.status read fails', async () => {
    const { gateway, restart } = createGateway({
      rpcError: new Error('Gateway service restart'),
    });
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 500,
      pollIntervalMs: 250,
      postRestartWaitMs: 250,
    })).resolves.toBe('unavailable');
    expect(restart).not.toHaveBeenCalled();
  });

  it('still restarts after a successful empty status even if earlier reads failed', async () => {
    let calls = 0;
    const restart = vi.fn().mockResolvedValue(undefined);
    const gateway = {
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
      rpc: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 2) throw new Error('RPC timeout: channels.status');
        return { channelAccounts: {} };
      }),
      restart,
    };
    let now = 0;

    await expect(ensurePluginChannelRuntimeActivated(gateway, 'dingtalk', 'default', {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      hotWaitMs: 1000,
      pollIntervalMs: 500,
      postRestartWaitMs: 250,
    })).resolves.toBe('restarted');
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
