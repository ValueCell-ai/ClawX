import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mutateOpenClawConfigMock,
} = vi.hoisted(() => ({
  mutateOpenClawConfigMock: vi.fn(),
}));

vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: mutateOpenClawConfigMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('syncProxyConfigToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function useCoordinatorConfig(config: Record<string, unknown>): void {
    mutateOpenClawConfigMock.mockImplementation(async (
      mutator: (snapshot: Record<string, unknown>) => void | Promise<void>,
    ) => {
      const before = JSON.stringify(config);
      await mutator(config);
      return JSON.stringify(config) !== before;
    });
  }

  it('preserves existing telegram proxy on startup-style sync when proxy is disabled', async () => {
    const config = {
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    };
    useCoordinatorConfig(config);

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(config.channels.telegram.proxy).toBe('socks5://127.0.0.1:7891');
    expect(mutateOpenClawConfigMock).toHaveBeenCalledOnce();
  });

  it('clears telegram proxy when explicitly requested while proxy is disabled', async () => {
    const config = {
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891' as string | undefined,
        },
      },
    };
    useCoordinatorConfig(config);

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    }, {
      preserveExistingWhenDisabled: false,
    });

    expect(mutateOpenClawConfigMock).toHaveBeenCalledOnce();
    expect(config.channels.telegram.proxy).toBeUndefined();
  });
});
