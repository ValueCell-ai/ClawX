import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const envKeys = [
  'LAH_SAFE_MODE',
  'CLAWX_EXTERNAL_GATEWAY_URL',
  'CLAWX_EXTERNAL_GATEWAY_ENABLED',
  'CLAWX_GATEWAY_SPAWN_ENABLED',
  'CLAWX_GATEWAY_KILL_ON_CONFLICT',
  'CLAWX_OPENCLAW_CONFIG_MUTATION',
  'CLAWX_TELEMETRY_ENABLED',
  'CLAWX_UPDATE_CHECKS_ENABLED',
  'CLAWX_PROVIDER_VALIDATION_ENABLED',
  'CLAWX_OAUTH_ENABLED',
  'CLAWX_EXTERNAL_URL_OPENING_ENABLED',
  'CLAWX_CONNECTIVITY_PROBE_ENABLED',
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function resetEnv(): void {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('runtime-flags', () => {
  beforeEach(() => {
    resetEnv();
    vi.resetModules();
  });

  afterEach(() => {
    resetEnv();
  });

  it('uses the LAH external gateway default when no override is present', async () => {
    delete process.env.LAH_SAFE_MODE;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_URL;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_ENABLED;

    const flags = await import('@electron/utils/runtime-flags');

    expect(flags.getExternalGatewayUrl()).toBe('ws://127.0.0.1:4000/gateway');
    expect(flags.isLahSafeMode()).toBe(false);
    expect(flags.isExternalGatewayEnabled()).toBe(false);
    expect(flags.isGatewaySpawnEnabled()).toBe(true);
    expect(flags.isGatewayKillOnConflictEnabled()).toBe(true);
    expect(flags.isOpenClawConfigMutationEnabled()).toBe(true);
    expect(flags.isTelemetryEnabledByRuntime()).toBe(true);
    expect(flags.isUpdateChecksEnabledByRuntime()).toBe(true);
    expect(flags.isProviderValidationEnabledByRuntime()).toBe(true);
    expect(flags.isOAuthEnabledByRuntime()).toBe(true);
    expect(flags.isExternalUrlOpeningEnabledByRuntime()).toBe(true);
    expect(flags.isConnectivityProbeEnabledByRuntime()).toBe(true);
  });

  it('forces safe-mode gates when LAH_SAFE_MODE=1', async () => {
    process.env.LAH_SAFE_MODE = '1';
    delete process.env.CLAWX_EXTERNAL_GATEWAY_URL;
    delete process.env.CLAWX_EXTERNAL_GATEWAY_ENABLED;

    const flags = await import('@electron/utils/runtime-flags');

    expect(flags.isLahSafeMode()).toBe(true);
    expect(flags.isExternalGatewayEnabled()).toBe(true);
    expect(flags.getExternalGatewayUrl()).toBe('ws://127.0.0.1:4000/gateway');
    expect(flags.isGatewaySpawnEnabled()).toBe(false);
    expect(flags.isGatewayKillOnConflictEnabled()).toBe(false);
    expect(flags.isOpenClawConfigMutationEnabled()).toBe(false);
    expect(flags.isTelemetryEnabledByRuntime()).toBe(false);
    expect(flags.isUpdateChecksEnabledByRuntime()).toBe(false);
    expect(flags.isProviderValidationEnabledByRuntime()).toBe(false);
    expect(flags.isOAuthEnabledByRuntime()).toBe(false);
    expect(flags.isExternalUrlOpeningEnabledByRuntime()).toBe(false);
    expect(flags.isConnectivityProbeEnabledByRuntime()).toBe(false);
  });
});
