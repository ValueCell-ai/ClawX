/**
 * Backend compatibility layer around the shared provider registry.
 */

export {
  BUILTIN_PROVIDER_TYPES,
  type BuiltinProviderType,
  type ProviderType,
} from '../shared/providers/types';
import {
  type ProviderBackendConfig,
  type ProviderModelEntry,
} from '../shared/providers/types';
import {
  getKeyableProviderTypes as getSharedKeyableProviderTypes,
  getProviderBackendConfig,
  getProviderDefaultModel as getSharedProviderDefaultModel,
  getProviderEnvVar as getSharedProviderEnvVar,
} from '../shared/providers/registry';

 // Additional env-backed providers that are not yet exposed in the UI.
const EXTRA_ENV_ONLY_PROVIDERS: Record<string, { envVar: string }> = {
  groq: { envVar: 'GROQ_API_KEY' },
  deepgram: { envVar: 'DEEPGRAM_API_KEY' },
  cerebras: { envVar: 'CEREBRAS_API_KEY' },
  xai: { envVar: 'XAI_API_KEY' },
  mistral: { envVar: 'MISTRAL_API_KEY' },
  novita: { envVar: 'NOVITA_API_KEY' },
};

/** Get the environment variable name for a provider type */
export function getProviderEnvVar(type: string): string | undefined {
  return getSharedProviderEnvVar(type) ?? EXTRA_ENV_ONLY_PROVIDERS[type]?.envVar;
}

/** Get all environment variable names for a provider type (primary first). */
export function getProviderEnvVars(type: string): string[] {
  const envVar = getProviderEnvVar(type);
  return envVar ? [envVar] : [];
}

/** Get the default model string for a provider type */
export function getProviderDefaultModel(type: string): string | undefined {
  return getSharedProviderDefaultModel(type);
}

/** Get the OpenClaw provider config (baseUrl, api, apiKeyEnv, models, headers) */
export function getProviderConfig(
  type: string
): { baseUrl: string; api: string; apiKeyEnv: string; models?: ProviderModelEntry[]; headers?: Record<string, string> } | undefined {
  return getProviderBackendConfig(type) as ProviderBackendConfig | undefined;
}

/**
 * All provider types that have env var mappings.
 * Used by GatewayManager to inject API keys as env vars.
 */
export function getKeyableProviderTypes(): string[] {
  return [...getSharedKeyableProviderTypes(), ...Object.keys(EXTRA_ENV_ONLY_PROVIDERS)];
}
