/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to ~/.openclaw/agents/main/agent/auth-profiles.json
 * so the OpenClaw Gateway can load them for AI provider calls.
 *
 * All file I/O is asynchronous (fs/promises) to avoid blocking the
 * Electron main thread.  On Windows + NTFS + Defender the synchronous
 * equivalents could stall for 500 ms – 2 s+ per call, causing "Not
 * Responding" hangs.
 */
import { access, mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { constants, Dirent } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  getProviderEnvVar,
  getProviderDefaultModel,
  getProviderConfig,
} from './provider-registry';

const AUTH_STORE_VERSION = 1;
const AUTH_PROFILE_FILENAME = 'auth-profiles.json';

// ── Helpers ──────────────────────────────────────────────────────

/** Non-throwing async existence check (replaces existsSync). */
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Ensure a directory exists (replaces mkdirSync). */
async function ensureDir(dir: string): Promise<void> {
  if (!(await fileExists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

/** Read a JSON file, returning `null` on any error. */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!(await fileExists(filePath))) return null;
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a JSON file, creating parent directories if needed. */
async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(join(filePath, '..'));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Types ────────────────────────────────────────────────────────

interface AuthProfileEntry {
  type: 'api_key';
  provider: string;
  key: string;
}

interface OAuthProfileEntry {
  type: 'oauth';
  provider: string;
  access: string;
  refresh: string;
  expires: number;
}

interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry | OAuthProfileEntry>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

// ── Auth Profiles I/O ────────────────────────────────────────────

function getAuthProfilesPath(agentId = 'main'): string {
  return join(homedir(), '.openclaw', 'agents', agentId, 'agent', AUTH_PROFILE_FILENAME);
}

async function readAuthProfiles(agentId = 'main'): Promise<AuthProfilesStore> {
  const filePath = getAuthProfilesPath(agentId);
  try {
    const data = await readJsonFile<AuthProfilesStore>(filePath);
    if (data?.version && data.profiles && typeof data.profiles === 'object') {
      return data;
    }
  } catch (error) {
    console.warn('Failed to read auth-profiles.json, creating fresh store:', error);
  }
  return { version: AUTH_STORE_VERSION, profiles: {} };
}

async function writeAuthProfiles(store: AuthProfilesStore, agentId = 'main'): Promise<void> {
  await writeJsonFile(getAuthProfilesPath(agentId), store);
}

// ── Agent Discovery ──────────────────────────────────────────────

async function discoverAgentIds(): Promise<string[]> {
  const agentsDir = join(homedir(), '.openclaw', 'agents');
  try {
    if (!(await fileExists(agentsDir))) return ['main'];
    const entries: Dirent[] = await readdir(agentsDir, { withFileTypes: true });
    const ids: string[] = [];
    for (const d of entries) {
      if (d.isDirectory() && await fileExists(join(agentsDir, d.name, 'agent'))) {
        ids.push(d.name);
      }
    }
    return ids.length > 0 ? ids : ['main'];
  } catch {
    return ['main'];
  }
}

// ── OpenClaw Config Helpers ──────────────────────────────────────

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return (await readJsonFile<Record<string, unknown>>(OPENCLAW_CONFIG_PATH)) ?? {};
}

async function writeOpenClawJson(config: Record<string, unknown>): Promise<void> {
  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);
}

// ── Exported Functions (all async) ───────────────────────────────

/**
 * Save an OAuth token to OpenClaw's auth-profiles.json.
 */
export async function saveOAuthTokenToOpenClaw(
  provider: string,
  token: { access: string; refresh: string; expires: number },
  agentId?: string
): Promise<void> {
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = {
      type: 'oauth',
      provider,
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
    };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeAuthProfiles(store, id);
  }
  console.log(`Saved OAuth token for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Retrieve an OAuth token from OpenClaw's auth-profiles.json.
 * Useful when the Gateway does not natively inject the Authorization header.
 * 
 * @param provider - Provider type (e.g., 'minimax-portal')
 * @param agentId - Optional single agent ID to read from, defaults to 'main'
 * @returns The OAuth token access string or null if not found
 */
export async function getOAuthTokenFromOpenClaw(
  provider: string,
  agentId = 'main'
): Promise<string | null> {
  try {
    const store = await readAuthProfiles(agentId);
    const profileId = `${provider}:default`;
    const profile = store.profiles[profileId];

    if (profile && profile.type === 'oauth' && 'access' in profile) {
      return (profile as OAuthProfileEntry).access;
    }
  } catch (err) {
    console.warn(`[getOAuthToken] Failed to read token for ${provider}:`, err);
  }
  return null;
}

/**
 * Save a provider API key to OpenClaw's auth-profiles.json
 */
export async function saveProviderKeyToOpenClaw(
  provider: string,
  apiKey: string,
  agentId?: string
): Promise<void> {
  const OAUTH_PROVIDERS = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'];
  if (OAUTH_PROVIDERS.includes(provider) && !apiKey) {
    console.log(`Skipping auth-profiles write for OAuth provider "${provider}" (no API key provided, using OAuth)`);
    return;
  }
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    store.profiles[profileId] = { type: 'api_key', provider, key: apiKey };

    if (!store.order) store.order = {};
    if (!store.order[provider]) store.order[provider] = [];
    if (!store.order[provider].includes(profileId)) {
      store.order[provider].push(profileId);
    }

    if (!store.lastGood) store.lastGood = {};
    store.lastGood[provider] = profileId;

    await writeAuthProfiles(store, id);
  }
  console.log(`Saved API key for provider "${provider}" to OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Remove a provider API key from OpenClaw auth-profiles.json
 */
export async function removeProviderKeyFromOpenClaw(
  provider: string,
  agentId?: string
): Promise<void> {
  const OAUTH_PROVIDERS = ['qwen-portal', 'minimax-portal', 'minimax-portal-cn'];
  if (OAUTH_PROVIDERS.includes(provider)) {
    console.log(`Skipping auth-profiles removal for OAuth provider "${provider}" (managed by OpenClaw plugin)`);
    return;
  }
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;

    delete store.profiles[profileId];

    if (store.order?.[provider]) {
      store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
      if (store.order[provider].length === 0) delete store.order[provider];
    }
    if (store.lastGood?.[provider] === profileId) delete store.lastGood[provider];

    await writeAuthProfiles(store, id);
  }
  console.log(`Removed API key for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Remove a provider completely from OpenClaw (delete config, disable plugins, delete keys)
 */
export async function removeProviderFromOpenClaw(provider: string): Promise<void> {
  // 1. Remove from auth-profiles.json
  const agentIds = await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');
  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    const profileId = `${provider}:default`;
    if (store.profiles[profileId]) {
      delete store.profiles[profileId];
      if (store.order?.[provider]) {
        store.order[provider] = store.order[provider].filter((aid) => aid !== profileId);
        if (store.order[provider].length === 0) delete store.order[provider];
      }
      if (store.lastGood?.[provider] === profileId) delete store.lastGood[provider];
      await writeAuthProfiles(store, id);
    }
  }

  // 2. Remove from models.json (per-agent model registry used by pi-ai directly)
  for (const id of agentIds) {
    const modelsPath = join(homedir(), '.openclaw', 'agents', id, 'agent', 'models.json');
    try {
      if (await fileExists(modelsPath)) {
        const raw = await readFile(modelsPath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const providers = data.providers as Record<string, unknown> | undefined;
        if (providers && providers[provider]) {
          delete providers[provider];
          await writeFile(modelsPath, JSON.stringify(data, null, 2), 'utf-8');
          console.log(`Removed models.json entry for provider "${provider}" (agent "${id}")`);
        }
      }
    } catch (err) {
      console.warn(`Failed to remove provider ${provider} from models.json (agent "${id}"):`, err);
    }
  }

  // 3. Remove from openclaw.json
  try {
    const config = await readOpenClawJson();
    let modified = false;

    // Disable plugin (for OAuth like qwen-portal-auth)
    const plugins = config.plugins as Record<string, unknown> | undefined;
    const entries = (plugins?.entries ?? {}) as Record<string, Record<string, unknown>>;
    const pluginName = `${provider}-auth`;
    if (entries[pluginName]) {
      entries[pluginName].enabled = false;
      modified = true;
      console.log(`Disabled OpenClaw plugin: ${pluginName}`);
    }

    // Remove from models.providers
    const models = config.models as Record<string, unknown> | undefined;
    const providers = (models?.providers ?? {}) as Record<string, unknown>;
    if (providers[provider]) {
      delete providers[provider];
      modified = true;
      console.log(`Removed OpenClaw provider config: ${provider}`);
    }

    if (modified) {
      await writeOpenClawJson(config);
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
 */
export async function setOpenClawDefaultModel(provider: string, modelOverride?: string): Promise<void> {
  const config = await readOpenClawJson();

  const model = modelOverride || getProviderDefaultModel(provider);
  if (!model) {
    console.warn(`No default model mapping for provider "${provider}"`);
    return;
  }

  const modelId = model.startsWith(`${provider}/`)
    ? model.slice(provider.length + 1)
    : model;

  // Set the default model for the agents
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  defaults.model = { primary: model };
  agents.defaults = defaults;
  config.agents = agents;

  // Configure models.providers for providers that need explicit registration.
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

    const providerEntry: Record<string, unknown> = {
      ...existingProvider,
      baseUrl: providerCfg.baseUrl,
      api: providerCfg.api,
      apiKey: providerCfg.apiKeyEnv,
      models: mergedModels,
    };
    if (providerCfg.headers && Object.keys(providerCfg.headers).length > 0) {
      providerEntry.headers = providerCfg.headers;
    }
    providers[provider] = providerEntry;
    console.log(`Configured models.providers.${provider} with baseUrl=${providerCfg.baseUrl}, model=${modelId}`);

    models.providers = providers;
    config.models = models;
  } else {
    // Built-in provider: remove any stale models.providers entry
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
  if (!gateway.mode) gateway.mode = 'local';
  config.gateway = gateway;

  await writeOpenClawJson(config);
  console.log(`Set OpenClaw default model to "${model}" for provider "${provider}"`);
}

interface RuntimeProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

/**
 * Register or update a provider's configuration in openclaw.json
 * without changing the current default model.
 */
export async function syncProviderConfigToOpenClaw(
  provider: string,
  modelId: string | undefined,
  override: RuntimeProviderConfigOverride
): Promise<void> {
  const config = await readOpenClawJson();

  if (override.baseUrl && override.api) {
    const models = (config.models || {}) as Record<string, unknown>;
    const providers = (models.providers || {}) as Record<string, unknown>;

    const nextModels: Array<Record<string, unknown>> = [];
    if (modelId) nextModels.push({ id: modelId, name: modelId });

    const nextProvider: Record<string, unknown> = {
      baseUrl: override.baseUrl,
      api: override.api,
      models: nextModels,
    };
    if (override.apiKeyEnv) nextProvider.apiKey = override.apiKeyEnv;
    if (override.headers && Object.keys(override.headers).length > 0) {
      nextProvider.headers = override.headers;
    }

    providers[provider] = nextProvider;
    models.providers = providers;
    config.models = models;
  }

  // Ensure extension is enabled for oauth providers to prevent gateway wiping config
  if (provider === 'minimax-portal' || provider === 'qwen-portal') {
    const plugins = (config.plugins || {}) as Record<string, unknown>;
    const pEntries = (plugins.entries || {}) as Record<string, unknown>;
    pEntries[`${provider}-auth`] = { enabled: true };
    plugins.entries = pEntries;
    config.plugins = plugins;
  }

  await writeOpenClawJson(config);
}

/**
 * Update OpenClaw model + provider config using runtime config values.
 */
export async function setOpenClawDefaultModelWithOverride(
  provider: string,
  modelOverride: string | undefined,
  override: RuntimeProviderConfigOverride
): Promise<void> {
  const config = await readOpenClawJson();

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

    const nextModels: Array<Record<string, unknown>> = [];
    if (modelId) nextModels.push({ id: modelId, name: modelId });

    const nextProvider: Record<string, unknown> = {
      baseUrl: override.baseUrl,
      api: override.api,
      models: nextModels,
    };
    if (override.apiKeyEnv) nextProvider.apiKey = override.apiKeyEnv;
    if (override.headers && Object.keys(override.headers).length > 0) {
      nextProvider.headers = override.headers;
    }
    if (override.authHeader !== undefined) {
      nextProvider.authHeader = override.authHeader;
    }

    providers[provider] = nextProvider;
    models.providers = providers;
    config.models = models;
  }

  const gateway = (config.gateway || {}) as Record<string, unknown>;
  if (!gateway.mode) gateway.mode = 'local';
  config.gateway = gateway;

  // Ensure the extension plugin is marked as enabled in openclaw.json
  if (provider === 'minimax-portal' || provider === 'qwen-portal') {
    const plugins = (config.plugins || {}) as Record<string, unknown>;
    const pEntries = (plugins.entries || {}) as Record<string, unknown>;
    pEntries[`${provider}-auth`] = { enabled: true };
    plugins.entries = pEntries;
    config.plugins = plugins;
  }

  await writeOpenClawJson(config);
  console.log(
    `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
  );
}

/**
 * Get a set of all active provider IDs configured in openclaw.json.
 * Reads the file ONCE and extracts both models.providers and plugins.entries.
 */
export async function getActiveOpenClawProviders(): Promise<Set<string>> {
  const activeProviders = new Set<string>();

  try {
    const config = await readOpenClawJson();

    // 1. models.providers
    const providers = (config.models as Record<string, unknown> | undefined)?.providers;
    if (providers && typeof providers === 'object') {
      for (const key of Object.keys(providers as Record<string, unknown>)) {
        activeProviders.add(key);
      }
    }

    // 2. plugins.entries for OAuth providers
    const plugins = (config.plugins as Record<string, unknown> | undefined)?.entries;
    if (plugins && typeof plugins === 'object') {
      for (const [pluginId, meta] of Object.entries(plugins as Record<string, unknown>)) {
        if (pluginId.endsWith('-auth') && (meta as Record<string, unknown>).enabled) {
          activeProviders.add(pluginId.replace(/-auth$/, ''));
        }
      }
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active providers:', err);
  }

  return activeProviders;
}

/**
 * Write the ClawX gateway token into ~/.openclaw/openclaw.json.
 */
export async function syncGatewayTokenToConfig(token: string): Promise<void> {
  const config = await readOpenClawJson();

  const gateway = (
    config.gateway && typeof config.gateway === 'object'
      ? { ...(config.gateway as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  const auth = (
    gateway.auth && typeof gateway.auth === 'object'
      ? { ...(gateway.auth as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  auth.mode = 'token';
  auth.token = token;
  gateway.auth = auth;
  if (!gateway.mode) gateway.mode = 'local';
  config.gateway = gateway;

  await writeOpenClawJson(config);
  console.log('Synced gateway token to openclaw.json');
}

/**
 * Ensure browser automation is enabled in ~/.openclaw/openclaw.json.
 */
export async function syncBrowserConfigToOpenClaw(): Promise<void> {
  const config = await readOpenClawJson();

  const browser = (
    config.browser && typeof config.browser === 'object'
      ? { ...(config.browser as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;

  let changed = false;

  if (browser.enabled === undefined) {
    browser.enabled = true;
    changed = true;
  }

  if (browser.defaultProfile === undefined) {
    browser.defaultProfile = 'openclaw';
    changed = true;
  }

  if (!changed) return;

  config.browser = browser;
  await writeOpenClawJson(config);
  console.log('Synced browser config to openclaw.json');
}

/**
 * Update a provider entry in every discovered agent's models.json.
 */
export async function updateAgentModelProvider(
  providerType: string,
  entry: {
    baseUrl?: string;
    api?: string;
    models?: Array<{ id: string; name: string }>;
    apiKey?: string;
    /** When true, pi-ai sends Authorization: Bearer instead of x-api-key */
    authHeader?: boolean;
  }
): Promise<void> {
  const agentIds = await discoverAgentIds();
  for (const agentId of agentIds) {
    const modelsPath = join(homedir(), '.openclaw', 'agents', agentId, 'agent', 'models.json');
    let data: Record<string, unknown> = {};
    try {
      data = (await readJsonFile<Record<string, unknown>>(modelsPath)) ?? {};
    } catch {
      // corrupt / missing – start with an empty object
    }

    const providers = (
      data.providers && typeof data.providers === 'object' ? data.providers : {}
    ) as Record<string, Record<string, unknown>>;

    const existing: Record<string, unknown> =
      providers[providerType] && typeof providers[providerType] === 'object'
        ? { ...providers[providerType] }
        : {};

    const existingModels = Array.isArray(existing.models)
      ? (existing.models as Array<Record<string, unknown>>)
      : [];

    const mergedModels = (entry.models ?? []).map((m) => {
      const prev = existingModels.find((e) => e.id === m.id);
      return prev ? { ...prev, id: m.id, name: m.name } : { ...m };
    });

    if (entry.baseUrl !== undefined) existing.baseUrl = entry.baseUrl;
    if (entry.api !== undefined) existing.api = entry.api;
    if (mergedModels.length > 0) existing.models = mergedModels;
    if (entry.apiKey !== undefined) existing.apiKey = entry.apiKey;
    if (entry.authHeader !== undefined) existing.authHeader = entry.authHeader;

    providers[providerType] = existing;
    data.providers = providers;

    try {
      await writeJsonFile(modelsPath, data);
      console.log(`Updated models.json for agent "${agentId}" provider "${providerType}"`);
    } catch (err) {
      console.warn(`Failed to update models.json for agent "${agentId}":`, err);
    }
  }
}

export { getProviderEnvVar } from './provider-registry';
