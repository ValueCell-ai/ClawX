import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripSystemdSupervisorEnv } from '@electron/gateway/config-sync-env';

const { mockEnsureDingTalkDwsInstalled, mockLoggerWarn } = vi.hoisted(() => ({
  mockEnsureDingTalkDwsInstalled: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.5.7'),
    getAppPath: vi.fn(() => '/workspace'),
    getPath: vi.fn(() => '/tmp/clawx-test'),
    isPackaged: false,
  },
}));

vi.mock('@electron/utils/dingtalk-dws', () => ({
  ensureDingTalkDwsInstalled: mockEnsureDingTalkDwsInstalled,
  resolveDingTalkDwsBinDir: vi.fn(() => null),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
  },
}));

describe('DingTalk dws prelaunch provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repairs dws for an existing configured DingTalk channel without requiring a resave', async () => {
    mockEnsureDingTalkDwsInstalled.mockReturnValue({
      installed: true,
      warning: 'dingtalk_dws_auth_required',
    });
    const { provisionConfiguredDingTalkDws } = await import('@electron/gateway/config-sync');

    expect(provisionConfiguredDingTalkDws(['feishu', 'dingtalk'])).toBe(true);
    expect(mockEnsureDingTalkDwsInstalled).toHaveBeenCalledOnce();
    expect(mockEnsureDingTalkDwsInstalled).toHaveBeenCalledWith({ probeAuth: false });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('keeps a missing dws non-fatal and reports the failed repair', async () => {
    mockEnsureDingTalkDwsInstalled.mockReturnValue({
      installed: false,
      warning: 'dingtalk_dws_missing',
    });
    const { provisionConfiguredDingTalkDws } = await import('@electron/gateway/config-sync');

    expect(provisionConfiguredDingTalkDws(['dingtalk'])).toBe(false);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] DingTalk workspace CLI: dingtalk_dws_missing',
    );
  });

  it('does not provision dws when DingTalk is not configured', async () => {
    const { provisionConfiguredDingTalkDws } = await import('@electron/gateway/config-sync');

    expect(provisionConfiguredDingTalkDws(['feishu', 'wecom'])).toBe(true);
    expect(mockEnsureDingTalkDwsInstalled).not.toHaveBeenCalled();
  });
});

describe('stripSystemdSupervisorEnv', () => {
  it('removes systemd supervisor marker env vars', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      INVOCATION_ID: 'abc123',
      SYSTEMD_EXEC_PID: '777',
      JOURNAL_STREAM: '8:12345',
      OTHER: 'keep-me',
    };

    const result = stripSystemdSupervisorEnv(env);

    expect(result).toEqual({
      PATH: '/usr/bin:/bin',
      OTHER: 'keep-me',
    });
  });

  it('keeps unrelated variables unchanged', () => {
    const env = {
      NODE_ENV: 'production',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      CLAWDBOT_SKIP_CHANNELS: '0',
    };

    expect(stripSystemdSupervisorEnv(env)).toEqual(env);
  });

  it('does not mutate source env object', () => {
    const env = {
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      VALUE: '1',
    };
    const before = { ...env };

    const result = stripSystemdSupervisorEnv(env);

    expect(env).toEqual(before);
    expect(result).toEqual({ VALUE: '1' });
  });
});
