const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const DEFAULT_EXTERNAL_GATEWAY_URL = 'ws://127.0.0.1:4000/gateway';

function readEnvFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

export function getRequestedUserDataDir(): string | null {
  const raw = process.env.CLAWX_USER_DATA_DIR?.trim();
  return raw ? raw : null;
}

export function isLahSafeMode(): boolean {
  return readEnvFlag('LAH_SAFE_MODE', false);
}

export function getExternalGatewayUrl(): string {
  return process.env.CLAWX_EXTERNAL_GATEWAY_URL?.trim() || DEFAULT_EXTERNAL_GATEWAY_URL;
}

export function isExternalGatewayEnabled(): boolean {
  if (isLahSafeMode()) {
    return true;
  }
  if (readEnvFlag('CLAWX_EXTERNAL_GATEWAY_ENABLED', false)) {
    return true;
  }
  return Boolean(process.env.CLAWX_EXTERNAL_GATEWAY_URL?.trim());
}

export function isGatewaySpawnEnabled(): boolean {
  if (isExternalGatewayEnabled()) {
    return false;
  }
  return readEnvFlag('CLAWX_GATEWAY_SPAWN_ENABLED', true);
}

export function isGatewayKillOnConflictEnabled(): boolean {
  if (isExternalGatewayEnabled()) {
    return false;
  }
  return readEnvFlag('CLAWX_GATEWAY_KILL_ON_CONFLICT', true);
}

export function isOpenClawConfigMutationEnabled(): boolean {
  if (isLahSafeMode() || isExternalGatewayEnabled()) {
    return false;
  }
  return readEnvFlag('CLAWX_OPENCLAW_CONFIG_MUTATION', true);
}

export function isTelemetryEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_TELEMETRY_ENABLED', true);
}

export function isUpdateChecksEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_UPDATE_CHECKS_ENABLED', true);
}

export function isProviderValidationEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_PROVIDER_VALIDATION_ENABLED', true);
}

export function isOAuthEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_OAUTH_ENABLED', true);
}

export function isExternalUrlOpeningEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_EXTERNAL_URL_OPENING_ENABLED', true);
}

export function isConnectivityProbeEnabledByRuntime(): boolean {
  if (isLahSafeMode()) {
    return false;
  }
  return readEnvFlag('CLAWX_CONNECTIVITY_PROBE_ENABLED', true);
}

