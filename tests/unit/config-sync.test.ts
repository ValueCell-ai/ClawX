import { describe, expect, it } from 'vitest';
import { stripSystemdSupervisorEnv } from '@electron/gateway/config-sync-env';
import { buildGatewayLaunchArgs, buildGatewayLaunchEnv } from '@electron/gateway/config-sync';

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

describe('buildGatewayLaunchArgs', () => {
  it('includes allow-unconfigured when gateway mode is missing', () => {
    expect(buildGatewayLaunchArgs(18789, 'token-123', true)).toEqual([
      'gateway',
      '--port',
      '18789',
      '--token',
      'token-123',
      '--allow-unconfigured',
    ]);
  });

  it('omits allow-unconfigured when gateway.mode is already configured', () => {
    expect(buildGatewayLaunchArgs(18789, 'token-123', false)).toEqual([
      'gateway',
      '--port',
      '18789',
      '--token',
      'token-123',
    ]);
  });
});

describe('buildGatewayLaunchEnv', () => {
  it('disables Bonjour for local-only launches and preserves channel skip behavior', () => {
    expect(buildGatewayLaunchEnv({
      baseEnv: { PATH: '/usr/bin' },
      providerEnv: { OPENAI_API_KEY: 'sk-test' },
      uvEnv: { UV_INDEX_URL: 'https://mirror.test' },
      proxyEnv: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      token: 'token-123',
      skipChannels: true,
      gatewayMode: 'local',
      gatewayBind: undefined,
    })).toEqual(expect.objectContaining({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'sk-test',
      UV_INDEX_URL: 'https://mirror.test',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      OPENCLAW_GATEWAY_TOKEN: 'token-123',
      OPENCLAW_SKIP_CHANNELS: '1',
      CLAWDBOT_SKIP_CHANNELS: '1',
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_DISABLE_BONJOUR: '1',
    }));
  });

  it('keeps Bonjour enabled for non-local bind modes', () => {
    expect(buildGatewayLaunchEnv({
      baseEnv: {},
      providerEnv: {},
      uvEnv: {},
      proxyEnv: {},
      token: 'token-123',
      skipChannels: false,
      gatewayMode: 'local',
      gatewayBind: 'lan',
    }).OPENCLAW_DISABLE_BONJOUR).toBeUndefined();
  });
});
