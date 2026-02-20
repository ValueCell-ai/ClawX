/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to ~/.openclaw/agents/main/agent/auth-profiles.json
 * so the OpenClaw Gateway can load them for AI provider calls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  getProviderEnvVar,
  getProviderDefaultModel,
  getProviderConfig,
} from './provider-registry';

const AUTH_STORE_VERSION = 1;
const AUTH_PROFILE_FILENAME = 'auth-profiles.json';

/**
 * Auth profile entry for an API key
 */
interface AuthProfileEntry {
  type: 'api_key';
  provider: string;
  key: string;
}

/**
 * Auth profiles store format
 */
interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

/**
 * Get the path to the auth-profiles.json for a given agent
 */
function getAuthProfilesPath(agentId = 'main'): string {
  return join(homedir(), '.openclaw', 'agents', agentId, 'agent', AUTH_PROFILE_FILENAME);
}

/**
 * Read existing auth profiles store, or create an empty one
 */
function readAuthProfiles(agentId = 'main'): AuthProfilesStore {
  const filePath = getAuthProfilesPath(agentId);
  
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as AuthProfilesStore;
      // Validate basic structure
      if (data.version && data.profiles && typeof data.profiles === 'object') {
        return data;
      }
    }
  } catch (error) {
    console.warn('Failed to read auth-profiles.json, creating fresh store:', error);
  }
  
  return {
    version: AUTH_STORE_VERSION,
    profiles: {},
  };
}

/**
 * Write auth profiles store to disk
 */
function writeAuthProfiles(store: AuthProfilesStore, agentId = 'main'): void {
  const filePath = getAuthProfilesPath(agentId);
  const dir = join(filePath, '..');
  
  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Save a provider API key to OpenClaw's auth-profiles.json
 * This writes the key in the format OpenClaw expects so the gateway
 * can use it for AI provider calls.
 * 
 * @param provider - Provider type (e.g., 'anthropic', 'openrouter', 'openai', 'google')
 * @param apiKey - The API key to store
 * @param agentId - Agent ID (defaults to 'main')
 */
export function saveProviderKeyToOpenClaw(
  provider: string,
  apiKey: string,
  agentId = 'main'
): void {
  const store = readAuthProfiles(agentId);
  
  // Profile ID follows OpenClaw convention: <provider>:default
  const profileId = `${provider}:default`;
  
  // Upsert the profile entry
  store.profiles[profileId] = {
    type: 'api_key',
    provider,
    key: apiKey,
  };
  
  // Update order to include this profile
  if (!store.order) {
    store.order = {};
  }
  if (!store.order[provider]) {
    store.order[provider] = [];
  }
  if (!store.order[provider].includes(profileId)) {
    store.order[provider].push(profileId);
  }
  
  // Set as last good
  if (!store.lastGood) {
    store.lastGood = {};
  }
  store.lastGood[provider] = profileId;
  
  writeAuthProfiles(store, agentId);
  console.log(`Saved API key for provider "${provider}" to OpenClaw auth-profiles (agent: ${agentId})`);
}

/**
 * Remove a provider API key from OpenClaw auth-profiles.json
 */
export function removeProviderKeyFromOpenClaw(
  provider: string,
  agentId = 'main'
): void {
  const store = readAuthProfiles(agentId);
  const profileId = `${provider}:default`;

  delete store.profiles[profileId];

  if (store.order?.[provider]) {
    store.order[provider] = store.order[provider].filter((id) => id !== profileId);
    if (store.order[provider].length === 0) {
      delete store.order[provider];
    }
  }

  if (store.lastGood?.[provider] === profileId) {
    delete store.lastGood[provider];
  }

  writeAuthProfiles(store, agentId);
  console.log(`Removed API key for provider "${provider}" from OpenClaw auth-profiles (agent: ${agentId})`);
}

/**
 * Build environment variables object with all stored API keys
 * for passing to the Gateway process
 */
export function buildProviderEnvVars(providers: Array<{ type: string; apiKey: string }>): Record<string, string> {
  const env: Record<string, string> = {};
  
  for (const { type, apiKey } of providers) {
    const envVar = getProviderEnvVar(type);
    if (envVar && apiKey) {
      env[envVar] = apiKey;
    }
  }
  
  return env;
}

/**
 * Update the OpenClaw config to use the given provider and model
 * Writes to ~/.openclaw/openclaw.json
 *
 * @param provider - Provider type (e.g. 'anthropic', 'siliconflow')
 * @param modelOverride - Optional model string to use instead of the registry default.
 *   For siliconflow this is the user-supplied model ID prefixed with "siliconflow/".
 */
export function setOpenClawDefaultModel(provider: string, modelOverride?: string): void {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  
  let config: Record<string, unknown> = {};
  
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json, creating fresh config:', err);
  }
  
  const model = modelOverride || getProviderDefaultModel(provider);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = model.startsWith(`${provider}/`)
    ? model.slice(provider.length + 1)
    : model;
  
  // Set the default model for the agents
  // model must be an object: { primary: "provider/model", fallbacks?: [] }
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  defaults.model = { primary: model };
  agents.defaults = defaults;
  config.agents = agents;
  
  // Configure models.providers for providers that need explicit registration.
  // Built-in providers (anthropic, google) are part of OpenClaw's pi-ai catalog
  // and must NOT have a models.providers entry — it would override the built-in.
  const providerCfg = getProviderConfig(provider);
  if (providerCfg) {
    const models = (config.models || {}) as Record<string, unknown>;
    const providers = (models.providers || {}) as Record<string, unknown>;

    const existingProvider =
      providers[provider] && typeof providers[provider] === 'object'
        ? (providers[provider] as Record<string, unknown>)
        : {};

    const existingModels = Array.isArray(existingProvider.models)
      ? (existingProvider.models as Array<Record<string, unknown>>)
      : [];
    const registryModels = (providerCfg.models ?? []).map((m) => ({ ...m })) as Array<Record<string, unknown>>;

    const mergedModels = [...registryModels];
    for (const item of existingModels) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (id && !mergedModels.some((m) => m.id === id)) {
        mergedModels.push(item);
      }
    }
    if (modelId && !mergedModels.some((m) => m.id === modelId)) {
      mergedModels.push({ id: modelId, name: modelId });
    }

    providers[provider] = {
      ...existingProvider,
      baseUrl: providerCfg.baseUrl,
      api: providerCfg.api,
      apiKey: `\${${providerCfg.apiKeyEnv}}`,
      models: mergedModels,
    };
    console.log(`Configured models.providers.${provider} with baseUrl=${providerCfg.baseUrl}, model=${modelId}`);
    
    models.providers = providers;
    config.models = models;
  } else {
    // Built-in provider: remove any stale models.providers entry that may
    // have been written by an earlier version. Leaving it in place would
    // override the native pi-ai catalog and can break streaming/auth.
    const models = (config.models || {}) as Record<string, unknown>;
    const providers = (models.providers || {}) as Record<string, unknown>;
    if (providers[provider]) {
      delete providers[provider];
      console.log(`Removed stale models.providers.${provider} (built-in provider)`);
      models.providers = providers;
      config.models = models;
    }
  }
  
  // Ensure gateway mode is set
  const gateway = (config.gateway || {}) as Record<string, unknown>;
  if (!gateway.mode) {
    gateway.mode = 'local';
  }
  config.gateway = gateway;
  
  // Ensure directory exists
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`Set OpenClaw default model to "${model}" for provider "${provider}"`);
}

interface RuntimeProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
}

/**
 * Update OpenClaw model + provider config using runtime config values.
 * Useful for user-configurable providers (custom/ollama-like) where
 * baseUrl/model are not in the static registry.
 */
export function setOpenClawDefaultModelWithOverride(
  provider: string,
  modelOverride: string | undefined,
  override: RuntimeProviderConfigOverride
): void {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');

  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json, creating fresh config:', err);
  }

  const model = modelOverride || getProviderDefaultModel(provider);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = model.startsWith(`${provider}/`)
    ? model.slice(provider.length + 1)
    : model;

  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  defaults.model = { primary: model };
  agents.defaults = defaults;
  config.agents = agents;

  if (override.baseUrl && override.api) {
    const models = (config.models || {}) as Record<string, unknown>;
    const providers = (models.providers || {}) as Record<string, unknown>;

    const existingProvider =
      providers[provider] && typeof providers[provider] === 'object'
        ? (providers[provider] as Record<string, unknown>)
        : {};

    const existingModels = Array.isArray(existingProvider.models)
      ? (existingProvider.models as Array<Record<string, unknown>>)
      : [];
    const mergedModels = [...existingModels];
    if (modelId && !mergedModels.some((m) => m.id === modelId)) {
      mergedModels.push({ id: modelId, name: modelId });
    }

    const nextProvider: Record<string, unknown> = {
      ...existingProvider,
      baseUrl: override.baseUrl,
      api: override.api,
      models: mergedModels,
    };
    if (override.apiKeyEnv) {
      nextProvider.apiKey = `\${${override.apiKeyEnv}}`;
    }

    providers[provider] = nextProvider;
    models.providers = providers;
    config.models = models;
  }

  const gateway = (config.gateway || {}) as Record<string, unknown>;
  if (!gateway.mode) {
    gateway.mode = 'local';
  }
  config.gateway = gateway;

  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

// Re-export for backwards compatibility
export { getProviderEnvVar } from './provider-registry';
