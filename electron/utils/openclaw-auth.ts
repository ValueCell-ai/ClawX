/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to ~/.openclaw/agents/main/agent/auth-profiles.json
 * so the OpenClaw Gateway can load them for AI provider calls.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
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
 * Auth profile entry for an OAuth token (matches OpenClaw plugin format)
 */
interface OAuthProfileEntry {
  type: 'oauth';
  provider: string;
  access: string;
  refresh: string;
  expires: number;
}

/**
 * Auth profiles store format
 */
interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry | OAuthProfileEntry>;
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
 * Discover all agent IDs that have an agent/ subdirectory.
 */
function discoverAgentIds(): string[] {
  const agentsDir = join(homedir(), '.openclaw', 'agents');
  try {
    if (!existsSync(agentsDir)) return ['main'];
    return readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(agentsDir, d.name, 'agent')))
      .map((d) => d.name);
  } catch {
    return ['main'];
  }
}

/**
 * Save an OAuth token to OpenClaw's auth-profiles.json.
 * Writes in OpenClaw's native OAuth credential format (type: 'oauth'),
 * matching exactly what `openclaw models auth login` (upsertAuthProfile) writes.
 *
 * @param provider - Provider type (e.g. 'minimax-portal', 'qwen-portal')
 * @param token    - OAuth token from the provider's login function
 * @param agentId  - Optional single agent ID. When omitted, writes to every agent.
 */
export function saveOAuthTokenToOpenClaw(
  provider: string,
  token: { access: string; refresh: string; expires: number },
  agentId?: string
): void {
  const agentIds = agentId ? [agentId] : discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = readAuthProfiles(id);
    const profileId = `${provider}:default`;

    const entry: OAuthProfileEntry = {
      type: 'oauth',
      provider,
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
    };

    store.profiles[profileId] = entry;

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    writeAuthProfiles(store, id);
  }

  console.log(`Saved OAuth token for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Save a provider API key to OpenClaw's auth-profiles.json
 * This writes the key in the format OpenClaw expects so the gateway
 * can use it for AI provider calls.
 *
 * Writes to ALL discovered agent directories so every agent
 * (including non-"main" agents like "dev") stays in sync.
 * 
 * @param provider - Provider type (e.g., 'anthropic', 'openrouter', 'openai', 'google')
 * @param apiKey - The API key to store
 * @param agentId - Optional single agent ID. When omitted, writes to every agent.
 */
export function saveProviderKeyToOpenClaw(

  provider: string,
  apiKey: string,
  agentId?: string
): void {
  // OAuth providers (qwen-portal, minimax-portal) typically have their credentials
  // managed by OpenClaw plugins via `openclaw models auth login`.
  // Skip only if there's no explicit API key — meaning the user is using OAuth.
  // If the user provided an actual API key, write it normally.
  const OAUTH_PROVIDERS = ['qwen-portal', 'minimax-portal'];
  if (OAUTH_PROVIDERS.includes(provider) && !apiKey) {
    console.log(`Skipping auth-profiles write for OAuth provider "${provider}" (no API key provided, using OAuth)`);
    return;
  }
  const agentIds = agentId ? [agentId] : discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = readAuthProfiles(id);

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

    writeAuthProfiles(store, id);
  }
  console.log(`Saved API key for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Remove a provider API key from OpenClaw auth-profiles.json
 */
export function removeProviderKeyFromOpenClaw(
  provider: string,
  agentId?: string
): void {
  // OAuth providers have their credentials managed by OpenClaw plugins.
  // Do NOT delete their auth-profiles entries.
  const OAUTH_PROVIDERS = ['qwen-portal', 'minimax-portal'];
  if (OAUTH_PROVIDERS.includes(provider)) {
    console.log(`Skipping auth-profiles removal for OAuth provider "${provider}" (managed by OpenClaw plugin)`);
    return;
  }
  const agentIds = agentId ? [agentId] : discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = readAuthProfiles(id);
    const profileId = `${provider}:default`;

    delete store.profiles[profileId];

    if (store.order?.[provider]) {
      store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
      if (store.order[provider].length === 0) {
        delete store.order[provider];
      }
    }

    if (store.lastGood?.[provider] === profileId) {
      delete store.lastGood[provider];
    }

    writeAuthProfiles(store, id);
  }
  console.log(`Removed API key for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Remove a provider completely from OpenClaw (delete config, disable plugins, delete keys)
 */
export function removeProviderFromOpenClaw(provider: string): void {
  // 1. Remove from auth-profiles.json
  const agentIds = discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');
  for (const id of agentIds) {
    const store = readAuthProfiles(id);
    const profileId = `${provider}:default`;
    if (store.profiles[profileId]) {
      delete store.profiles[profileId];
      if (store.order?.[provider]) {
        store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
        if (store.order[provider].length === 0) delete store.order[provider];
      }
      if (store.lastGood?.[provider] === profileId) delete store.lastGood[provider];
      writeAuthProfiles(store, id);
    }
  }

  // 2. Remove from openclaw.json
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      let modified = false;

      // Disable plugin (for OAuth like qwen-portal-auth)
      if (config.plugins?.entries) {
        const pluginName = `${provider}-auth`;
        if (config.plugins.entries[pluginName]) {
          config.plugins.entries[pluginName].enabled = false;
          modified = true;
          console.log(`Disabled OpenClaw plugin: ${pluginName}`);
        }
      }

      // Remove from models.providers
      if (config.models?.providers?.[provider]) {
        delete config.models.providers[provider];
        modified = true;
        console.log(`Removed OpenClaw provider config: ${provider}`);
      }

      if (modified) {
        writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    }
  } catch (err) {
    console.warn(`Failed to remove provider ${provider} from openclaw.json:`, err);
  }
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
      apiKey: providerCfg.apiKeyEnv,
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

    // Replace the provider entry entirely rather than merging.
    // Different custom/ollama provider instances have different baseUrls,
    // so merging models from a previous instance creates an inconsistent
    // config (models pointing at the wrong endpoint).
    const nextModels: Array<Record<string, unknown>> = [];
    if (modelId) {
      nextModels.push({ id: modelId, name: modelId });
    }

    const nextProvider: Record<string, unknown> = {
      baseUrl: override.baseUrl,
      api: override.api,
      models: nextModels,
    };
    if (override.apiKeyEnv) {
      nextProvider.apiKey = override.apiKeyEnv;
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

  // Ensure the extension plugin is marked as enabled in openclaw.json
  // Without this, the OpenClaw Gateway will silently wipe the provider config on startup
  if (provider === 'minimax-portal' || provider === 'qwen-portal') {
    const plugins = (config.plugins || {}) as Record<string, unknown>;
    const entries = (plugins.entries || {}) as Record<string, unknown>;
    entries[`${provider}-auth`] = { enabled: true };
    plugins.entries = entries;
    config.plugins = plugins;
  }

  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

/**
 * Get a set of all active provider IDs configured in openclaw.json and auth-profiles.json.
 * This is used to sync ClawX's local provider list with the actual OpenClaw engine state.
 */
export function getActiveOpenClawProviders(): Set<string> {
  const activeProviders = new Set<string>();
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');

  // 1. Read openclaw.json models.providers
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const providers = config.models?.providers;
      if (providers && typeof providers === 'object') {
        for (const key of Object.keys(providers)) {
          activeProviders.add(key);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active providers:', err);
  }

  // 2. Read openclaw.json plugins.entries for OAuth providers
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const plugins = config.plugins?.entries;
      if (plugins && typeof plugins === 'object') {
        for (const [pluginId, meta] of Object.entries(plugins)) {
          // If the plugin ends with -auth and is enabled, it's an OAuth provider
          // e.g. 'qwen-portal-auth' implies provider 'qwen-portal'
          if (pluginId.endsWith('-auth') && (meta as Record<string, unknown>).enabled) {
            const providerId = pluginId.replace(/-auth$/, '');
            activeProviders.add(providerId);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active plugins:', err);
  }

  return activeProviders;
}

// Re-export for backwards compatibility
export { getProviderEnvVar } from './provider-registry';
