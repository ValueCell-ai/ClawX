import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readOpenClawConfigMock,
  writeOpenClawConfigMock,
  withConfigLockMock,
} = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(),
  writeOpenClawConfigMock: vi.fn(),
  withConfigLockMock: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: readOpenClawConfigMock,
  writeOpenClawConfig: writeOpenClawConfigMock,
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: withConfigLockMock,
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
    delete process.env.LAH_SAFE_MODE;
    delete process.env.CLAWX_OPENCLAW_CONFIG_MUTATION;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_URL;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_ENABLED;
  });

  afterEach(() => {
    delete process.env.LAH_SAFE_MODE;
    delete process.env.CLAWX_OPENCLAW_CONFIG_MUTATION;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_URL;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_ENABLED;
  });

  it('preserves existing telegram proxy on startup-style sync when proxy is disabled', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
  });

  it('clears telegram proxy when explicitly requested while proxy is disabled', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });

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

    expect(writeOpenClawConfigMock).toHaveBeenCalledTimes(1);
    const updatedConfig = writeOpenClawConfigMock.mock.calls[0][0] as {
      channels: { telegram: Record<string, unknown> };
    };
    expect(updatedConfig.channels.telegram.proxy).toBeUndefined();
  });

  it('skips Telegram proxy sync when OpenClaw config mutation is disabled', async () => {
    process.env.LAH_SAFE_MODE = '1';
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });

    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: true,
      proxyServer: '127.0.0.1:7891',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(readOpenClawConfigMock).not.toHaveBeenCalled();
    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
    expect(withConfigLockMock).not.toHaveBeenCalled();
  });
});
