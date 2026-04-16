/**
 * OpenClaw Auth Profiles Utility
 * Writes API keys to configured OpenClaw agent auth-profiles.json files
 * so the OpenClaw Gateway can load them for AI provider calls.
 *
 * All file I/O is asynchronous (fs/promises) to avoid blocking the
 * Electron main thread.  On Windows + NTFS + Defender the synchronous
 * equivalents could stall for 500 ms – 2 s+ per call, causing "Not
 * Responding" hangs.
 */
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants, readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { listConfiguredAgentIds } from './agent-config';
import { getOpenClawResolvedDir } from './paths';
import {
  getProviderEnvVar,
  getProviderDefaultModel,
  getProviderConfig,
} from './provider-registry';
import {
  OPENCLAW_PROVIDER_KEY_MOONSHOT,
  OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL,
  isOAuthProviderType,
  isOpenClawOAuthPluginProviderKey,
} from './provider-keys';
import { withConfigLock } from './config-mutex';

const AUTH_STORE_VERSION = 1;
const AUTH_PROFILE_FILENAME = 'auth-profiles.json';

function getOAuthPluginId(provider: string): string {
  return `${provider}-auth`;
}

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
  email?: string;
  projectId?: string;
}

interface AuthProfilesStore {
  version: number;
  profiles: Record<string, AuthProfileEntry | OAuthProfileEntry>;
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
}

function removeProfilesForProvider(store: AuthProfilesStore, provider: string): boolean {
  const removedProfileIds = new Set<string>();

  for (const [profileId, profile] of Object.entries(store.profiles)) {
    if (profile?.provider !== provider) {
      continue;
    }
    delete store.profiles[profileId];
    removedProfileIds.add(profileId);
  }

  if (removedProfileIds.size === 0) {
    return false;
  }

  if (store.order) {
    for (const [orderProvider, profileIds] of Object.entries(store.order)) {
      const nextProfileIds = profileIds.filter((profileId) => !removedProfileIds.has(profileId));
      if (nextProfileIds.length > 0) {
        store.order[orderProvider] = nextProfileIds;
      } else {
        delete store.order[orderProvider];
      }
    }
  }

  if (store.lastGood) {
    for (const [lastGoodProvider, profileId] of Object.entries(store.lastGood)) {
      if (removedProfileIds.has(profileId)) {
        delete store.lastGood[lastGoodProvider];
      }
    }
  }

  return true;
}

function removeProfileFromStore(
  store: AuthProfilesStore,
  profileId: string,
  expectedType?: AuthProfileEntry['type'] | OAuthProfileEntry['type'],
): boolean {
  const profile = store.profiles[profileId];
  let changed = false;
  const shouldCleanReferences = !profile || !expectedType || profile.type === expectedType;
  if (profile && (!expectedType || profile.type === expectedType)) {
    delete store.profiles[profileId];
    changed = true;
  }

  if (shouldCleanReferences && store.order) {
    for (const [orderProvider, profileIds] of Object.entries(store.order)) {
      const nextProfileIds = profileIds.filter((id) => id !== profileId);
      if (nextProfileIds.length !== profileIds.length) {
        changed = true;
      }
      if (nextProfileIds.length > 0) {
        store.order[orderProvider] = nextProfileIds;
      } else {
        delete store.order[orderProvider];
      }
    }
  }

  if (shouldCleanReferences && store.lastGood) {
    for (const [lastGoodProvider, lastGoodProfileId] of Object.entries(store.lastGood)) {
      if (lastGoodProfileId === profileId) {
        delete store.lastGood[lastGoodProvider];
        changed = true;
      }
    }
  }

  return changed;
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
    return await listConfiguredAgentIds();
  } catch {
    return ['main'];
  }
}

// ── OpenClaw Config Helpers ──────────────────────────────────────

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const FEISHU_PLUGIN_ID_CANDIDATES = ['openclaw-lark', 'feishu-openclaw-plugin'] as const;
const VALID_COMPACTION_MODES = new Set(['default', 'safeguard']);
const BUILTIN_CHANNEL_IDS = new Set([
  'discord',
  'telegram',
  'whatsapp',
  'slack',
  'signal',
  'imessage',
  'matrix',
  'line',
  'msteams',
  'googlechat',
  'mattermost',
  'qqbot',
]);
const AUTH_PROFILE_PROVIDER_KEY_MAP: Record<string, string> = {
  'openai-codex': 'openai',
  'google-gemini-cli': 'google',
};

/**
 * Reverse of AUTH_PROFILE_PROVIDER_KEY_MAP.
 * Maps a UI provider key (e.g. "openai") to all raw auth-profile provider
 * keys that normalise to it (e.g. ["openai-codex"]).
 */
const AUTH_PROFILE_PROVIDER_KEY_REVERSE_MAP: Record<string, string[]> = Object.entries(
  AUTH_PROFILE_PROVIDER_KEY_MAP,
).reduce<Record<string, string[]>>((acc, [raw, normalized]) => {
  if (!acc[normalized]) acc[normalized] = [];
  acc[normalized].push(raw);
  return acc;
}, {});

/**
 * Return all raw auth-profile `provider` values that should be treated as
 * equivalent to `provider` when cleaning up auth-profile entries.
 * Always includes the provider itself.
 */
function expandProviderKeysForDeletion(provider: string): string[] {
  return [provider, ...(AUTH_PROFILE_PROVIDER_KEY_REVERSE_MAP[provider] ?? [])];
}

/**
 * Scan OpenClaw's bundled extensions directory to find all plugins that have
 * `enabledByDefault: true` in their `openclaw.plugin.json` manifest.
 *
 * When `plugins.allow` is explicitly set (e.g. for third-party channel
 * plugins), OpenClaw blocks ALL plugins not in the allowlist — even bundled
 * ones with `enabledByDefault: true`.  This function discovers those plugins
 * so they can be preserved in the allowlist.
 *
 * Results are cached for the lifetime of the process since bundled
 * extensions don't change at runtime.
 */
let _bundledPluginCache: { all: Set<string>; enabledByDefault: string[] } | null = null;
function discoverBundledPlugins(): { all: Set<string>; enabledByDefault: string[] } {
  if (_bundledPluginCache) return _bundledPluginCache;
  const all = new Set<string>();
  const enabledByDefault: string[] = [];
  try {
    const extensionsDir = join(getOpenClawResolvedDir(), 'dist', 'extensions');
    if (!existsSync(extensionsDir)) {
      _bundledPluginCache = { all, enabledByDefault };
      return _bundledPluginCache;
    }
    for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(extensionsDir, entry.name, 'openclaw.plugin.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (typeof manifest.id === 'string') {
          all.add(manifest.id);
          if (manifest.enabledByDefault === true) {
            enabledByDefault.push(manifest.id);
          }
        }
      } catch {
        // Malformed manifest — skip silently
      }
    }
  } catch {
    // Extension directory not found or unreadable — return empty
  }
  _bundledPluginCache = { all, enabledByDefault };
  return _bundledPluginCache;
}


function normalizeAuthProfileProviderKey(provider: string): string {
  return AUTH_PROFILE_PROVIDER_KEY_MAP[provider] ?? provider;
}

function addProvidersFromProfileEntries(
  profiles: Record<string, unknown> | undefined,
  target: Set<string>,
): void {
  if (!profiles || typeof profiles !== 'object') {
    return;
  }

  for (const profile of Object.values(profiles)) {
    const provider = typeof (profile as Record<string, unknown>)?.provider === 'string'
      ? ((profile as Record<string, unknown>).provider as string)
      : undefined;
    if (!provider) continue;
    target.add(normalizeAuthProfileProviderKey(provider));
  }
}

async function getProvidersFromAuthProfileStores(): Promise<Set<string>> {
  const providers = new Set<string>();
  const agentIds = await discoverAgentIds();

  for (const agentId of agentIds) {
    const store = await readAuthProfiles(agentId);
    addProvidersFromProfileEntries(store.profiles, providers);
  }

  return providers;
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return (await readJsonFile<Record<string, unknown>>(OPENCLAW_CONFIG_PATH)) ?? {};
}

async function resolveInstalledFeishuPluginId(): Promise<string | null> {
  const extensionRoot = join(homedir(), '.openclaw', 'extensions');
  for (const dirName of FEISHU_PLUGIN_ID_CANDIDATES) {
    const manifestPath = join(extensionRoot, dirName, 'openclaw.plugin.json');
    const manifest = await readJsonFile<{ id?: unknown }>(manifestPath);
    if (typeof manifest?.id === 'string' && manifest.id.trim()) {
      return manifest.id.trim();
    }
  }
  return null;
}

function normalizeAgentsDefaultsCompactionMode(config: Record<string, unknown>): void {
  const agents = (config.agents && typeof config.agents === 'object'
    ? config.agents as Record<string, unknown>
    : null);
  if (!agents) return;

  const defaults = (agents.defaults && typeof agents.defaults === 'object'
    ? agents.defaults as Record<string, unknown>
    : null);
  if (!defaults) return;

  const compaction = (defaults.compaction && typeof defaults.compaction === 'object'
    ? defaults.compaction as Record<string, unknown>
    : null);
  if (!compaction) return;

  const mode = compaction.mode;
  if (typeof mode === 'string' && mode.length > 0 && !VALID_COMPACTION_MODES.has(mode)) {
    compaction.mode = 'default';
  }
}

async function writeOpenClawJson(config: Record<string, unknown>): Promise<void> {
  normalizeAgentsDefaultsCompactionMode(config);

  // Ensure SIGUSR1 graceful reload is authorized by OpenClaw config.
  const commands = (
    config.commands && typeof config.commands === 'object'
      ? { ...(config.commands as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>;
  commands.restart = true;
  config.commands = commands;

  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);
}

// ── Exported Functions (all async) ───────────────────────────────

/**
 * Save an OAuth token to OpenClaw's auth-profiles.json.
 */
export async function saveOAuthTokenToOpenClaw(
  provider: string,
  token: { access: string; refresh: string; expires: number; email?: string; projectId?: string },
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
      email: token.email,
      projectId: token.projectId,
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
  if (isOAuthProviderType(provider) && !apiKey) {
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
  const agentIds = agentId ? [agentId] : await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');

  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    if (removeProfileFromStore(store, `${provider}:default`, 'api_key')) {
      await writeAuthProfiles(store, id);
    }
  }
  console.log(`Removed API key for provider "${provider}" from OpenClaw auth-profiles (agents: ${agentIds.join(', ')})`);
}

/**
 * Remove a provider completely from OpenClaw (delete config, disable plugins, delete keys)
 */
export async function removeProviderFromOpenClaw(provider: string): Promise<void> {
  // 1. Remove from auth-profiles.json.
  // We must also remove entries whose raw `provider` field maps to this UI
  // provider key via AUTH_PROFILE_PROVIDER_KEY_MAP (e.g. "openai-codex" → "openai").
  // If those entries survive, getProvidersFromAuthProfileStores() will re-add
  // the provider and trigger a re-seed loop in listAccounts().
  const providerKeysToRemove = expandProviderKeysForDeletion(provider);
  const agentIds = await discoverAgentIds();
  if (agentIds.length === 0) agentIds.push('main');
  for (const id of agentIds) {
    const store = await readAuthProfiles(id);
    let storeModified = false;
    for (const key of providerKeysToRemove) {
      if (removeProfilesForProvider(store, key)) {
        storeModified = true;
      }
    }
    if (storeModified) {
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
    await withConfigLock(async () => {
      const config = await readOpenClawJson();
      let modified = false;

      // Disable plugin (for OAuth like minimax-portal-auth)
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

      const auth = (config.auth && typeof config.auth === 'object'
        ? config.auth as Record<string, unknown>
        : null);
      const authProfiles = (
        auth?.profiles && typeof auth.profiles === 'object'
          ? auth.profiles as Record<string, AuthProfileEntry | OAuthProfileEntry>
          : null
      );
      if (authProfiles) {
        // Also clean up raw auth-profile provider keys that map to this provider
        // (e.g. "openai-codex" is stored as-is but maps to "openai" in the UI).
        const providerKeysToClean = new Set(expandProviderKeysForDeletion(provider));
        for (const [profileId, profile] of Object.entries(authProfiles)) {
          if (!providerKeysToClean.has(profile?.provider)) {
            continue;
          }
          delete authProfiles[profileId];
          modified = true;
          console.log(`Removed OpenClaw auth profile: ${profileId}`);
        }
      }

      // Clean up agents.defaults.model references that point to the deleted provider.
      // Model refs use the format "providerType/modelId", e.g. "openai/gpt-4".
      // Leaving stale refs causes the Gateway to report "Unknown model" errors.
      const agents = config.agents as Record<string, unknown> | undefined;
      const agentDefaults = (agents?.defaults && typeof agents.defaults === 'object'
        ? agents.defaults as Record<string, unknown>
        : null);
      if (agentDefaults?.model && typeof agentDefaults.model === 'object') {
        const modelCfg = agentDefaults.model as Record<string, unknown>;
        const prefix = `${provider}/`;

        if (typeof modelCfg.primary === 'string' && modelCfg.primary.startsWith(prefix)) {
          delete modelCfg.primary;
          modified = true;
          console.log(`Removed deleted provider "${provider}" from agents.defaults.model.primary`);
        }

        if (Array.isArray(modelCfg.fallbacks)) {
          const filtered = (modelCfg.fallbacks as string[]).filter((fb) => !fb.startsWith(prefix));
          if (filtered.length !== modelCfg.fallbacks.length) {
            modelCfg.fallbacks = filtered.length > 0 ? filtered : undefined;
            modified = true;
            console.log(`Removed deleted provider "${provider}" from agents.defaults.model.fallbacks`);
          }
        }
      }

      if (modified) {
        await writeOpenClawJson(config);
      }
    });
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
export async function setOpenClawDefaultModel(
  provider: string,
  modelOverride?: string,
  fallbackModels: string[] = []
): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawJson();
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    const model = normalizeModelRef(provider, modelOverride);
    if (!model) {
      console.warn(`No default model mapping for provider "${provider}"`);
      return;
    }

    const modelId = extractModelId(provider, model);
    const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

    // Set the default model for the agents
    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    defaults.model = {
      primary: model,
      fallbacks: fallbackModels,
    };
    agents.defaults = defaults;
    config.agents = agents;

    // Configure models.providers for providers that need explicit registration.
    const providerCfg = getProviderConfig(provider);
    if (providerCfg) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: providerCfg.baseUrl,
        api: providerCfg.api,
        apiKeyEnv: providerCfg.apiKeyEnv,
        headers: providerCfg.headers,
        modelIds: [modelId, ...fallbackModelIds],
        includeRegistryModels: true,
        mergeExistingModels: true,
      });
      console.log(`Configured models.providers.${provider} with baseUrl=${providerCfg.baseUrl}, model=${modelId}`);
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
  });
}

interface RuntimeProviderConfigOverride {
  baseUrl?: string;
  api?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
}

type ProviderEntryBuildOptions = {
  baseUrl: string;
  api: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  modelIds?: string[];
  includeRegistryModels?: boolean;
  mergeExistingModels?: boolean;
};

function normalizeModelRef(provider: string, modelOverride?: string): string | undefined {
  const rawModel = modelOverride || getProviderDefaultModel(provider);
  if (!rawModel) return undefined;
  return rawModel.startsWith(`${provider}/`) ? rawModel : `${provider}/${rawModel}`;
}

function extractModelId(provider: string, modelRef: string): string {
  return modelRef.startsWith(`${provider}/`) ? modelRef.slice(provider.length + 1) : modelRef;
}

function extractFallbackModelIds(provider: string, fallbackModels: string[]): string[] {
  return fallbackModels
    .filter((fallback) => fallback.startsWith(`${provider}/`))
    .map((fallback) => fallback.slice(provider.length + 1));
}

function mergeProviderModels(
  ...groups: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const item of group) {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(item);
    }
  }
  return merged;
}

function upsertOpenClawProviderEntry(
  config: Record<string, unknown>,
  provider: string,
  options: ProviderEntryBuildOptions,
): void {
  const models = (config.models || {}) as Record<string, unknown>;
  const providers = (models.providers || {}) as Record<string, unknown>;
  const removedLegacyMoonshot = removeLegacyMoonshotProviderEntry(provider, providers);
  const existingProvider = (
    providers[provider] && typeof providers[provider] === 'object'
      ? (providers[provider] as Record<string, unknown>)
      : {}
  );

  const existingModels = options.mergeExistingModels && Array.isArray(existingProvider.models)
    ? (existingProvider.models as Array<Record<string, unknown>>)
    : [];
  const registryModels = options.includeRegistryModels
    ? ((getProviderConfig(provider)?.models ?? []).map((m) => ({ ...m })) as Array<Record<string, unknown>>)
    : [];
  const runtimeModels = (options.modelIds ?? []).map((id) => ({ id, name: id }));

  const nextProvider: Record<string, unknown> = {
    ...existingProvider,
    baseUrl: options.baseUrl,
    api: options.api,
    models: mergeProviderModels(registryModels, existingModels, runtimeModels),
  };
  if (options.apiKeyEnv) nextProvider.apiKey = options.apiKeyEnv;
  if (options.headers !== undefined) {
    if (Object.keys(options.headers).length > 0) {
      nextProvider.headers = options.headers;
    } else {
      delete nextProvider.headers;
    }
  }
  if (options.authHeader !== undefined) {
    nextProvider.authHeader = options.authHeader;
  } else {
    delete nextProvider.authHeader;
  }

  providers[provider] = nextProvider;
  models.providers = providers;
  config.models = models;

  if (removedLegacyMoonshot) {
    console.log('Removed legacy models.providers.moonshot alias entry');
  }
}

function removeLegacyMoonshotProviderEntry(
  _provider: string,
  _providers: Record<string, unknown>
): boolean {
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeLegacyMoonshotKimiSearchConfig(config: Record<string, unknown>): boolean {
  const tools = isPlainRecord(config.tools) ? config.tools : null;
  const web = tools && isPlainRecord(tools.web) ? tools.web : null;
  const search = web && isPlainRecord(web.search) ? web.search : null;
  if (!search || !('kimi' in search)) return false;

  delete search.kimi;
  if (Object.keys(search).length === 0) {
    delete web.search;
  }
  if (Object.keys(web).length === 0) {
    delete tools.web;
  }
  if (Object.keys(tools).length === 0) {
    delete config.tools;
  }
  return true;
}

function upsertMoonshotWebSearchConfig(
  config: Record<string, unknown>,
  providerKey: string,
  baseUrl: string,
  legacyKimi?: Record<string, unknown>,
): void {
  const plugins = isPlainRecord(config.plugins)
    ? config.plugins
    : (Array.isArray(config.plugins) ? { load: [...config.plugins] } : {});
  const entries = isPlainRecord(plugins.entries) ? plugins.entries : {};
  const moonshot = isPlainRecord(entries[providerKey])
    ? entries[providerKey] as Record<string, unknown>
    : {};
  const moonshotConfig = isPlainRecord(moonshot.config) ? moonshot.config as Record<string, unknown> : {};
  const currentWebSearch = isPlainRecord(moonshotConfig.webSearch)
    ? moonshotConfig.webSearch as Record<string, unknown>
    : {};

  const nextWebSearch = { ...(legacyKimi || {}), ...currentWebSearch };
  delete nextWebSearch.apiKey;
  nextWebSearch.baseUrl = baseUrl;

  moonshotConfig.webSearch = nextWebSearch;
  moonshot.config = moonshotConfig;
  entries[providerKey] = moonshot;
  plugins.entries = entries;
  config.plugins = plugins;
}

function ensureMoonshotKimiWebSearchCnBaseUrl(config: Record<string, unknown>, provider: string): void {
  if (provider === OPENCLAW_PROVIDER_KEY_MOONSHOT) {
    const tools = isPlainRecord(config.tools) ? config.tools : null;
    const web = tools && isPlainRecord(tools.web) ? tools.web : null;
    const search = web && isPlainRecord(web.search) ? web.search : null;
    const legacyKimi = search && isPlainRecord(search.kimi) ? search.kimi : undefined;

    upsertMoonshotWebSearchConfig(config, OPENCLAW_PROVIDER_KEY_MOONSHOT, 'https://api.moonshot.cn/v1', legacyKimi);
    removeLegacyMoonshotKimiSearchConfig(config);
  } else if (provider === OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL) {
    upsertMoonshotWebSearchConfig(config, OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL, 'https://api.moonshot.ai/v1');
  }
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
  return withConfigLock(async () => {
    const config = await readOpenClawJson();
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    if (override.baseUrl && override.api) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: override.baseUrl,
        api: override.api,
        apiKeyEnv: override.apiKeyEnv,
        headers: override.headers,
        modelIds: modelId ? [modelId] : [],
      });
    }

    // Ensure extension is enabled for oauth providers to prevent gateway wiping config
    if (isOpenClawOAuthPluginProviderKey(provider)) {
      const plugins = (config.plugins || {}) as Record<string, unknown>;
      const allow = Array.isArray(plugins.allow) ? [...plugins.allow as string[]] : [];
      const pEntries = (plugins.entries || {}) as Record<string, unknown>;
      const pluginId = getOAuthPluginId(provider);
      if (!allow.includes(pluginId)) {
        allow.push(pluginId);
      }
      pEntries[pluginId] = { enabled: true };
      plugins.allow = allow;
      plugins.entries = pEntries;
      config.plugins = plugins;
    }

    await writeOpenClawJson(config);
  });
}

/**
 * Update OpenClaw model + provider config using runtime config values.
 */
export async function setOpenClawDefaultModelWithOverride(
  provider: string,
  modelOverride: string | undefined,
  override: RuntimeProviderConfigOverride,
  fallbackModels: string[] = []
): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawJson();
    ensureMoonshotKimiWebSearchCnBaseUrl(config, provider);

    const model = normalizeModelRef(provider, modelOverride);
    if (!model) {
      console.warn(`No default model mapping for provider "${provider}"`);
      return;
    }

    const modelId = extractModelId(provider, model);
    const fallbackModelIds = extractFallbackModelIds(provider, fallbackModels);

    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    defaults.model = {
      primary: model,
      fallbacks: fallbackModels,
    };
    agents.defaults = defaults;
    config.agents = agents;

    if (override.baseUrl && override.api) {
      upsertOpenClawProviderEntry(config, provider, {
        baseUrl: override.baseUrl,
        api: override.api,
        apiKeyEnv: override.apiKeyEnv,
        headers: override.headers,
        authHeader: override.authHeader,
        modelIds: [modelId, ...fallbackModelIds],
      });
    }

    const gateway = (config.gateway || {}) as Record<string, unknown>;
    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    // Ensure the extension plugin is marked as enabled in openclaw.json
    if (isOpenClawOAuthPluginProviderKey(provider)) {
      const plugins = (config.plugins || {}) as Record<string, unknown>;
      const allow = Array.isArray(plugins.allow) ? [...plugins.allow as string[]] : [];
      const pEntries = (plugins.entries || {}) as Record<string, unknown>;
      const pluginId = getOAuthPluginId(provider);
      if (!allow.includes(pluginId)) {
        allow.push(pluginId);
      }
      pEntries[pluginId] = { enabled: true };
      plugins.allow = allow;
      plugins.entries = pEntries;
      config.plugins = plugins;
    }

    await writeOpenClawJson(config);
    console.log(
      `Set OpenClaw default model to "${model}" for provider "${provider}" (runtime override)`
    );
  });
}

/**
 * Get a set of all active provider IDs configured in openclaw.json.
 * Reads the file ONCE and extracts both models.providers and plugins.entries.
 */
// Provider IDs that have been deprecated and should never appear as active.
// These may still linger in openclaw.json from older versions.
const DEPRECATED_PROVIDER_IDS = new Set(['qwen-portal']);

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

    // 3. agents.defaults.model.primary — the default model reference encodes
    //    the provider prefix (e.g. "modelstudio/qwen3.5-plus" → "modelstudio").
    //    This covers providers that are active via OAuth or env-key but don't
    //    have an explicit models.providers entry.
    const agents = config.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const modelConfig = defaults?.model as Record<string, unknown> | undefined;
    const primaryModel = typeof modelConfig?.primary === 'string' ? modelConfig.primary : undefined;
    if (primaryModel?.includes('/')) {
      activeProviders.add(primaryModel.split('/')[0]);
    }

    // 4. auth.profiles — OAuth/device-token based providers may exist only in
    //    auth-profiles without explicit models.providers entries yet.
    const auth = config.auth as Record<string, unknown> | undefined;
    addProvidersFromProfileEntries(auth?.profiles as Record<string, unknown> | undefined, activeProviders);

    const authProfileProviders = await getProvidersFromAuthProfileStores();
    for (const provider of authProfileProviders) {
      activeProviders.add(provider);
    }
  } catch (err) {
    console.warn('Failed to read openclaw.json for active providers:', err);
  }

  // Remove deprecated providers that may still linger in config/auth files.
  for (const deprecated of DEPRECATED_PROVIDER_IDS) {
    activeProviders.delete(deprecated);
  }

  return activeProviders;
}

/**
 * Read models.providers entries and agents.defaults.model from openclaw.json.
 * Used by ClawX to seed the provider store when it's empty but providers are
 * configured externally (e.g. via CLI or by editing openclaw.json directly).
 */
export async function getOpenClawProvidersConfig(): Promise<{
  providers: Record<string, Record<string, unknown>>;
  defaultModel: string | undefined;
}> {
  try {
    const config = await readOpenClawJson();

    const models = config.models as Record<string, unknown> | undefined;
    const providers =
      models?.providers && typeof models.providers === 'object'
        ? (models.providers as Record<string, Record<string, unknown>>)
        : {};

    const agents = config.agents as Record<string, unknown> | undefined;
    const defaults =
      agents?.defaults && typeof agents.defaults === 'object'
        ? (agents.defaults as Record<string, unknown>)
        : undefined;
    const modelConfig =
      defaults?.model && typeof defaults.model === 'object'
        ? (defaults.model as Record<string, unknown>)
        : undefined;
    const defaultModel =
      typeof modelConfig?.primary === 'string' ? modelConfig.primary : undefined;

    const authProviders = new Set<string>();
    const auth = config.auth as Record<string, unknown> | undefined;
    addProvidersFromProfileEntries(auth?.profiles as Record<string, unknown> | undefined, authProviders);

    const authProfileProviders = await getProvidersFromAuthProfileStores();
    for (const provider of authProfileProviders) {
      authProviders.add(provider);
    }

    for (const provider of authProviders) {
      if (!providers[provider]) {
        providers[provider] = {};
      }
    }

    return { providers, defaultModel };
  } catch {
    return { providers: {}, defaultModel: undefined };
  }
}

/**
 * Write the ClawX gateway token into ~/.openclaw/openclaw.json.
 */
export async function syncGatewayTokenToConfig(token: string): Promise<void> {
  return withConfigLock(async () => {
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

    // Packaged ClawX loads the renderer from file://, so the gateway must allow
    // that origin for the chat WebSocket handshake.
    const controlUi = (
      gateway.controlUi && typeof gateway.controlUi === 'object'
        ? { ...(gateway.controlUi as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const allowedOrigins = Array.isArray(controlUi.allowedOrigins)
      ? (controlUi.allowedOrigins as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    if (!allowedOrigins.includes('file://')) {
      controlUi.allowedOrigins = [...allowedOrigins, 'file://'];
    }
    gateway.controlUi = controlUi;

    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    await writeOpenClawJson(config);
    console.log('Synced gateway token to openclaw.json');
  });
}

/**
 * Ensure browser automation is enabled in ~/.openclaw/openclaw.json.
 */
export async function syncBrowserConfigToOpenClaw(): Promise<void> {
  return withConfigLock(async () => {
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

    // Default ssrfPolicy to allow private network access for enterprise/internal use
    if (browser.ssrfPolicy == null) {
      browser.ssrfPolicy = { dangerouslyAllowPrivateNetwork: true };
      changed = true;
    } else if (
      typeof browser.ssrfPolicy === 'object' &&
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork === undefined
    ) {
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork = true;
      changed = true;
    }

    if (!changed) return;

    config.browser = browser;
    await writeOpenClawJson(config);
    console.log('Synced browser config to openclaw.json');
  });
}

/**
 * Ensure session idle-reset is configured in ~/.openclaw/openclaw.json.
 *
 * By default OpenClaw resets the "main" session daily at 04:00 local time,
 * which means conversations disappear after roughly one day.  ClawX sets
 * `session.idleMinutes` to 10 080 (7 days) so that conversations are
 * preserved for a week unless the user has explicitly configured their own
 * value.  When `idleMinutes` is set without `session.reset` /
 * `session.resetByType`, OpenClaw stays in idle-only mode (no daily reset).
 */
export async function syncSessionIdleMinutesToOpenClaw(): Promise<void> {
  const DEFAULT_IDLE_MINUTES = 10_080; // 7 days

  return withConfigLock(async () => {
    const config = await readOpenClawJson();

    const session = (
      config.session && typeof config.session === 'object'
        ? { ...(config.session as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;

    // Only set idleMinutes if the user has not configured it yet.
    if (session.idleMinutes !== undefined) return;

    // If the user has explicit reset / resetByType / resetByChannel config,
    // they are actively managing session lifecycle — don't interfere.
    if (session.reset !== undefined
      || session.resetByType !== undefined
      || session.resetByChannel !== undefined) return;

    session.idleMinutes = DEFAULT_IDLE_MINUTES;
    config.session = session;

    await writeOpenClawJson(config);
    console.log(`Synced session.idleMinutes=${DEFAULT_IDLE_MINUTES} (7d) to openclaw.json`);
  });
}

/**
 * Batch-apply gateway token, browser config, and session idle minutes in a
 * single config lock + read + write cycle.  Replaces three separate
 * withConfigLock calls during pre-launch sync.
 */
export async function batchSyncConfigFields(token: string): Promise<void> {
  const DEFAULT_IDLE_MINUTES = 10_080; // 7 days

  return withConfigLock(async () => {
    const config = await readOpenClawJson();
    let modified = true;

    // ── Gateway token + controlUi ──
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

    const controlUi = (
      gateway.controlUi && typeof gateway.controlUi === 'object'
        ? { ...(gateway.controlUi as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const allowedOrigins = Array.isArray(controlUi.allowedOrigins)
      ? (controlUi.allowedOrigins as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    if (!allowedOrigins.includes('file://')) {
      controlUi.allowedOrigins = [...allowedOrigins, 'file://'];
    }
    gateway.controlUi = controlUi;
    if (!gateway.mode) gateway.mode = 'local';
    config.gateway = gateway;

    // ── Browser config ──
    const browser = (
      config.browser && typeof config.browser === 'object'
        ? { ...(config.browser as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (browser.enabled === undefined) {
      browser.enabled = true;
      config.browser = browser;
      modified = true;
    }
    if (browser.defaultProfile === undefined) {
      browser.defaultProfile = 'openclaw';
      config.browser = browser;
      modified = true;
    }
    // Default ssrfPolicy to allow private network access for enterprise/internal use
    if (browser.ssrfPolicy == null) {
      browser.ssrfPolicy = { dangerouslyAllowPrivateNetwork: true };
      config.browser = browser;
      modified = true;
    } else if (
      typeof browser.ssrfPolicy === 'object' &&
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork === undefined
    ) {
      (browser.ssrfPolicy as Record<string, unknown>).dangerouslyAllowPrivateNetwork = true;
      config.browser = browser;
      modified = true;
    }

    // ── Session idle minutes ──
    const session = (
      config.session && typeof config.session === 'object'
        ? { ...(config.session as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    const hasExplicitSessionConfig = session.idleMinutes !== undefined
      || session.reset !== undefined
      || session.resetByType !== undefined
      || session.resetByChannel !== undefined;
    if (!hasExplicitSessionConfig) {
      session.idleMinutes = DEFAULT_IDLE_MINUTES;
      config.session = session;
      modified = true;
    }

    if (modified) {
      await writeOpenClawJson(config);
      console.log('Synced gateway token, browser config, and session idle to openclaw.json');
    }
  });
}

/**
 * Update a provider entry in every discovered agent's models.json.
 */
type AgentModelProviderEntry = {
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name: string }>;
  apiKey?: string;
  /** When true, pi-ai sends Authorization: Bearer instead of x-api-key */
  authHeader?: boolean;
};

async function updateModelsJsonProviderEntriesForAgents(
  agentIds: string[],
  providerType: string,
  entry: AgentModelProviderEntry,
): Promise<void> {
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

export async function updateAgentModelProvider(
  providerType: string,
  entry: AgentModelProviderEntry,
): Promise<void> {
  const agentIds = await discoverAgentIds();
  await updateModelsJsonProviderEntriesForAgents(agentIds, providerType, entry);
}

export async function updateSingleAgentModelProvider(
  agentId: string,
  providerType: string,
  entry: AgentModelProviderEntry,
): Promise<void> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    throw new Error('agentId is required');
  }
  await updateModelsJsonProviderEntriesForAgents([normalizedAgentId], providerType, entry);
}

/**
 * Sanitize ~/.openclaw/openclaw.json before Gateway start.
 *
 * Removes known-invalid keys that cause OpenClaw's strict Zod validation
 * to reject the entire config on startup.  Uses a conservative **blocklist**
 * approach: only strips keys that are KNOWN to be misplaced by older
 * OpenClaw/ClawX versions or external tools.
 *
 * Why blocklist instead of allowlist?
 *   • Allowlist (e.g. `VALID_SKILLS_KEYS`) would strip any NEW valid keys
 *     added by future OpenClaw releases — a forward-compatibility hazard.
 *   • Blocklist only removes keys we positively know are wrong, so new
 *     valid keys are never touched.
 *
 * This is a fast, file-based pre-check.  For comprehensive repair of
 * unknown or future config issues, the reactive auto-repair mechanism
 * (`runOpenClawDoctorRepair`) runs `openclaw doctor --fix` as a fallback.
 */
export async function sanitizeOpenClawConfig(): Promise<void> {
  return withConfigLock(async () => {
    // Skip sanitization if the config file does not exist yet.
    // Creating a skeleton config here would overwrite any data written
    // by the Gateway on its first run.
    if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
      console.log('[sanitize] openclaw.json does not exist yet, skipping sanitization');
      return;
    }

    // Read the raw file directly instead of going through readOpenClawJson()
    // which coalesces null → {}.  We need to distinguish a genuinely empty
    // file (valid, proceed normally) from a corrupt/unreadable file (null,
    // bail out to avoid overwriting the user's data with a skeleton config).
    const rawConfig = await readJsonFile<Record<string, unknown>>(OPENCLAW_CONFIG_PATH);
    if (rawConfig === null) {
      console.log('[sanitize] openclaw.json could not be parsed, skipping sanitization to preserve data');
      return;
    }
    const config: Record<string, unknown> = rawConfig;
    let modified = false;

    // ── skills section ──────────────────────────────────────────────
    // OpenClaw's Zod schema uses .strict() on the skills object, accepting
    // only: allowBundled, load, install, limits, entries.
    // The key "enabled" belongs inside skills.entries[key].enabled, NOT at
    // the skills root level.  Older versions may have placed it there.
    const skills = config.skills;
    if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
      const skillsObj = skills as Record<string, unknown>;
      // Keys that are known to be invalid at the skills root level.
      const KNOWN_INVALID_SKILLS_ROOT_KEYS = ['enabled', 'disabled'];
      for (const key of KNOWN_INVALID_SKILLS_ROOT_KEYS) {
        if (key in skillsObj) {
          console.log(`[sanitize] Removing misplaced key "skills.${key}" from openclaw.json`);
          delete skillsObj[key];
          modified = true;
        }
      }
    }

    // ── plugins section ──────────────────────────────────────────────
    // Remove absolute paths in plugins that no longer exist or are bundled (preventing hardlink validation errors)
    const plugins = config.plugins;
    if (plugins) {
      if (Array.isArray(plugins)) {
        const validPlugins: unknown[] = [];
        for (const p of plugins) {
          if (typeof p === 'string' && p.startsWith('/')) {
            if (p.includes('node_modules/openclaw/extensions') || !(await fileExists(p))) {
              console.log(`[sanitize] Removing stale/bundled plugin path "${p}" from openclaw.json`);
              modified = true;
            } else {
              validPlugins.push(p);
            }
          } else {
            validPlugins.push(p);
          }
        }
        if (modified) config.plugins = validPlugins;
      } else if (typeof plugins === 'object') {
        const pluginsObj = plugins as Record<string, unknown>;
        if (Array.isArray(pluginsObj.load)) {
          const validLoad: unknown[] = [];
          for (const p of pluginsObj.load) {
            if (typeof p === 'string' && p.startsWith('/')) {
              if (p.includes('node_modules/openclaw/extensions') || !(await fileExists(p))) {
                console.log(`[sanitize] Removing stale/bundled plugin path "${p}" from openclaw.json`);
                modified = true;
              } else {
                validLoad.push(p);
              }
            } else {
              validLoad.push(p);
            }
          }
          if (modified) pluginsObj.load = validLoad;
        } else if (pluginsObj.load && typeof pluginsObj.load === 'object' && !Array.isArray(pluginsObj.load)) {
          // Handle nested shape: plugins.load.paths (array of absolute paths)
          const loadObj = pluginsObj.load as Record<string, unknown>;
          if (Array.isArray(loadObj.paths)) {
            const validPaths: unknown[] = [];
            const countBefore = loadObj.paths.length;
            for (const p of loadObj.paths) {
              if (typeof p === 'string' && p.startsWith('/')) {
                if (p.includes('node_modules/openclaw/extensions') || !(await fileExists(p))) {
                  console.log(`[sanitize] Removing stale/bundled plugin path "${p}" from plugins.load.paths`);
                  modified = true;
                } else {
                  validPaths.push(p);
                }
              } else {
                validPaths.push(p);
              }
            }
            if (validPaths.length !== countBefore) {
              loadObj.paths = validPaths;
            }
          }
        }
      }
    }

    // ── commands section ───────────────────────────────────────────
    // Required for SIGUSR1 in-process reload authorization.
    const commands = (
      config.commands && typeof config.commands === 'object'
        ? { ...(config.commands as Record<string, unknown>) }
        : {}
    ) as Record<string, unknown>;
    if (commands.restart !== true) {
      commands.restart = true;
      config.commands = commands;
      modified = true;
      console.log('[sanitize] Enabling commands.restart for graceful reload support');
    }

    // ── tools.web.search.kimi ─────────────────────────────────────
    // OpenClaw moved moonshot web search config under
    // plugins.entries.moonshot.config.webSearch. Migrate the old key and strip
    // any inline apiKey so auth-profiles/env remain the single source of truth.
    const providers = ((config.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined) || {};
    if (providers[OPENCLAW_PROVIDER_KEY_MOONSHOT]) {
      const tools = isPlainRecord(config.tools) ? config.tools : null;
      const web = tools && isPlainRecord(tools.web) ? tools.web : null;
      const search = web && isPlainRecord(web.search) ? web.search : null;
      const legacyKimi = search && isPlainRecord(search.kimi) ? search.kimi : undefined;
      const hadInlineApiKey = Boolean(legacyKimi && 'apiKey' in legacyKimi);
      const hadLegacyKimi = Boolean(legacyKimi);

      if (legacyKimi) {
        upsertMoonshotWebSearchConfig(config, OPENCLAW_PROVIDER_KEY_MOONSHOT, 'https://api.moonshot.cn/v1', legacyKimi);
        removeLegacyMoonshotKimiSearchConfig(config);
        modified = true;
        console.log('[sanitize] Migrated legacy "tools.web.search.kimi" to "plugins.entries.moonshot.config.webSearch"');
      } else {
        const plugins = isPlainRecord(config.plugins) ? config.plugins : null;
        const entries = plugins && isPlainRecord(plugins.entries) ? plugins.entries : null;
        const moonshot = entries && isPlainRecord(entries[OPENCLAW_PROVIDER_KEY_MOONSHOT])
          ? entries[OPENCLAW_PROVIDER_KEY_MOONSHOT] as Record<string, unknown>
          : null;
        const moonshotConfig = moonshot && isPlainRecord(moonshot.config) ? moonshot.config as Record<string, unknown> : null;
        const webSearch = moonshotConfig && isPlainRecord(moonshotConfig.webSearch)
          ? moonshotConfig.webSearch as Record<string, unknown>
          : null;
        if (webSearch && 'apiKey' in webSearch) {
          delete webSearch.apiKey;
          moonshotConfig!.webSearch = webSearch;
          modified = true;
        }
      }
      if (hadInlineApiKey) {
        console.log('[sanitize] Removing stale key "tools.web.search.kimi.apiKey" from openclaw.json');
      } else if (hadLegacyKimi) {
        console.log('[sanitize] Removing legacy key "tools.web.search.kimi" from openclaw.json');
      }
    }

    // ── tools.profile & sessions.visibility ───────────────────────
    // OpenClaw 3.8+ requires tools.profile = 'full' and tools.sessions.visibility = 'all'
    // for ClawX to properly integrate with its updated tool system.
    const toolsConfig = (config.tools as Record<string, unknown> | undefined) || {};
    let toolsModified = false;

    if (toolsConfig.profile !== 'full') {
      toolsConfig.profile = 'full';
      toolsModified = true;
    }

    const sessions = (toolsConfig.sessions as Record<string, unknown> | undefined) || {};
    if (sessions.visibility !== 'all') {
      sessions.visibility = 'all';
      toolsConfig.sessions = sessions;
      toolsModified = true;
    }

    // ── tools.exec approvals (OpenClaw 3.28+) ──────────────────────
    // ClawX is a local desktop app where the user is the trusted operator.
    // Exec approval prompts add unnecessary friction in this context, so we
    // set security="full" (allow all commands) and ask="off" (never prompt).
    // If a user has manually configured a stricter ~/.openclaw/exec-approvals.json,
    // OpenClaw's minSecurity/maxAsk merge will still respect their intent.
    const execConfig = (toolsConfig.exec as Record<string, unknown> | undefined) || {};
    if (execConfig.security !== 'full' || execConfig.ask !== 'off') {
      execConfig.security = 'full';
      execConfig.ask = 'off';
      toolsConfig.exec = execConfig;
      toolsModified = true;
      console.log('[sanitize] Set tools.exec.security="full" and tools.exec.ask="off" to disable exec approvals for ClawX desktop');
    }

    if (toolsModified) {
      config.tools = toolsConfig;
      modified = true;
    }

    // ── plugins.entries.feishu cleanup ──────────────────────────────
    // Normalize feishu plugin ids dynamically based on installed manifest.
    // Different environments may report either "openclaw-lark" or
    // "feishu-openclaw-plugin" as the runtime plugin id.
    if (typeof plugins === 'object' && !Array.isArray(plugins)) {
      const pluginsObj = plugins as Record<string, unknown>;
      const pEntries = (
        pluginsObj.entries && typeof pluginsObj.entries === 'object' && !Array.isArray(pluginsObj.entries)
          ? pluginsObj.entries
          : {}
      ) as Record<string, Record<string, unknown>>;
      if (!pluginsObj.entries || typeof pluginsObj.entries !== 'object' || Array.isArray(pluginsObj.entries)) {
        pluginsObj.entries = pEntries;
      }

      const allowArr = Array.isArray(pluginsObj.allow) ? pluginsObj.allow as string[] : [];
      if (!Array.isArray(pluginsObj.allow)) {
        pluginsObj.allow = allowArr;
      }

      // ── acpx legacy config/install cleanup ─────────────────────
      // Older OpenClaw releases allowed plugins.entries.acpx.config.command
      // and expectedVersion overrides. Current bundled acpx schema rejects
      // them, which causes the Gateway to fail validation before startup.
      // Strip those keys and drop stale installs metadata that still points
      // at an older bundled OpenClaw tree so the current bundled plugin can
      // be re-registered cleanly.
      const acpxEntry = isPlainRecord(pEntries.acpx) ? pEntries.acpx as Record<string, unknown> : null;
      const acpxConfig = acpxEntry && isPlainRecord(acpxEntry.config)
        ? acpxEntry.config as Record<string, unknown>
        : null;
      if (acpxConfig) {
        for (const legacyKey of ['command', 'expectedVersion'] as const) {
          if (legacyKey in acpxConfig) {
            delete acpxConfig[legacyKey];
            modified = true;
            console.log(`[sanitize] Removed legacy plugins.entries.acpx.config.${legacyKey}`);
          }
        }
      }

      const installs = isPlainRecord(pluginsObj.installs) ? pluginsObj.installs as Record<string, unknown> : null;
      const acpxInstall = installs && isPlainRecord(installs.acpx) ? installs.acpx as Record<string, unknown> : null;
      if (acpxInstall) {
        const currentBundledAcpxDir = join(getOpenClawResolvedDir(), 'dist', 'extensions', 'acpx').replace(/\\/g, '/');
        const sourcePath = typeof acpxInstall.sourcePath === 'string' ? acpxInstall.sourcePath : '';
        const installPath = typeof acpxInstall.installPath === 'string' ? acpxInstall.installPath : '';
        const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
        const normalizedInstallPath = installPath.replace(/\\/g, '/');
        const pointsAtDifferentBundledTree = [normalizedSourcePath, normalizedInstallPath].some(
          (candidate) => candidate.includes('/node_modules/.pnpm/openclaw@') && candidate !== currentBundledAcpxDir,
        );
        const pointsAtMissingPath = (sourcePath && !(await fileExists(sourcePath)))
          || (installPath && !(await fileExists(installPath)));

        if (pointsAtDifferentBundledTree || pointsAtMissingPath) {
          delete installs.acpx;
          if (Object.keys(installs).length === 0) {
            delete pluginsObj.installs;
          }
          modified = true;
          console.log('[sanitize] Removed stale plugins.installs.acpx metadata');
        }
      }

      const installedFeishuId = await resolveInstalledFeishuPluginId();
      const configuredFeishuId =
        FEISHU_PLUGIN_ID_CANDIDATES.find((id) => allowArr.includes(id))
        || FEISHU_PLUGIN_ID_CANDIDATES.find((id) => Boolean(pEntries[id]));
      const canonicalFeishuId = installedFeishuId || configuredFeishuId || FEISHU_PLUGIN_ID_CANDIDATES[0];

      const existingFeishuEntry =
        FEISHU_PLUGIN_ID_CANDIDATES.map((id) => pEntries[id]).find(Boolean)
        || pEntries.feishu;

      const normalizedAllow = allowArr.filter(
        (id) => id !== 'feishu' && !FEISHU_PLUGIN_ID_CANDIDATES.includes(id as typeof FEISHU_PLUGIN_ID_CANDIDATES[number]),
      );
      normalizedAllow.push(canonicalFeishuId);
      if (JSON.stringify(normalizedAllow) !== JSON.stringify(allowArr)) {
        pluginsObj.allow = normalizedAllow;
        modified = true;
        console.log(`[sanitize] Normalized plugins.allow for feishu -> ${canonicalFeishuId}`);
      }

      if (existingFeishuEntry || !pEntries[canonicalFeishuId]) {
        pEntries[canonicalFeishuId] = {
          ...(existingFeishuEntry || {}),
          ...(pEntries[canonicalFeishuId] || {}),
          enabled: true,
        };
        modified = true;
      }
      for (const id of FEISHU_PLUGIN_ID_CANDIDATES) {
        if (id !== canonicalFeishuId && pEntries[id]) {
          delete pEntries[id];
          modified = true;
        }
      }

      // ── wecom-openclaw-plugin → wecom migration ────────────────
      const LEGACY_WECOM_ID = 'wecom-openclaw-plugin';
      const NEW_WECOM_ID = 'wecom';
      if (Array.isArray(pluginsObj.allow)) {
        const allowArr = pluginsObj.allow as string[];
        const legacyIdx = allowArr.indexOf(LEGACY_WECOM_ID);
        if (legacyIdx !== -1) {
          if (!allowArr.includes(NEW_WECOM_ID)) {
            allowArr[legacyIdx] = NEW_WECOM_ID;
          } else {
            allowArr.splice(legacyIdx, 1);
          }
          console.log(`[sanitize] Migrated plugins.allow: ${LEGACY_WECOM_ID} → ${NEW_WECOM_ID}`);
          modified = true;
        }
      }
      if (pEntries?.[LEGACY_WECOM_ID]) {
        if (!pEntries[NEW_WECOM_ID]) {
          pEntries[NEW_WECOM_ID] = pEntries[LEGACY_WECOM_ID];
        }
        delete pEntries[LEGACY_WECOM_ID];
        console.log(`[sanitize] Migrated plugins.entries: ${LEGACY_WECOM_ID} → ${NEW_WECOM_ID}`);
        modified = true;
      }

      // ── qqbot built-in channel cleanup ──────────────────────────
      // OpenClaw 3.31 moved qqbot from a third-party plugin to a built-in
      // channel.  Clean up legacy plugin entries (both bare "qqbot" and
      // manifest-declared "openclaw-qqbot") from plugins.entries.
      // plugins.allow is left untouched — having openclaw-qqbot there is harmless.
      // The channel config under channels.qqbot is preserved and works
      // identically with the built-in channel.
      const QQBOT_PLUGIN_IDS = ['qqbot', 'openclaw-qqbot'] as const;
      for (const qqbotId of QQBOT_PLUGIN_IDS) {
        if (pEntries?.[qqbotId]) {
          delete pEntries[qqbotId];
          console.log(`[sanitize] Removed built-in channel plugin from plugins.entries: ${qqbotId}`);
          modified = true;
        }
      }

      // ── qwen-portal → modelstudio migration ────────────────────
      // OpenClaw 2026.3.28 deprecated qwen-portal OAuth (portal.qwen.ai)
      // in favor of Model Studio (DashScope API key).  Clean up legacy
      // qwen-portal-auth plugin entries and qwen-portal provider config.
      const LEGACY_QWEN_PLUGIN_ID = 'qwen-portal-auth';
      if (Array.isArray(pluginsObj.allow)) {
        const allowArr = pluginsObj.allow as string[];
        const legacyIdx = allowArr.indexOf(LEGACY_QWEN_PLUGIN_ID);
        if (legacyIdx !== -1) {
          allowArr.splice(legacyIdx, 1);
          console.log(`[sanitize] Removed deprecated plugin from plugins.allow: ${LEGACY_QWEN_PLUGIN_ID}`);
          modified = true;
        }
      }
      if (pEntries?.[LEGACY_QWEN_PLUGIN_ID]) {
        delete pEntries[LEGACY_QWEN_PLUGIN_ID];
        console.log(`[sanitize] Removed deprecated plugin from plugins.entries: ${LEGACY_QWEN_PLUGIN_ID}`);
        modified = true;
      }

      // Remove deprecated models.providers.qwen-portal
      const LEGACY_QWEN_PROVIDER = 'qwen-portal';
      if (providers[LEGACY_QWEN_PROVIDER]) {
        delete providers[LEGACY_QWEN_PROVIDER];
        console.log(`[sanitize] Removed deprecated provider: ${LEGACY_QWEN_PROVIDER}`);
        modified = true;
      }

      // Clean up qwen-portal OAuth auth profile (no longer functional)
      const authConfig = config.auth as Record<string, unknown> | undefined;
      const authProfiles = authConfig?.profiles as Record<string, unknown> | undefined;
      if (authProfiles?.[LEGACY_QWEN_PROVIDER]) {
        delete authProfiles[LEGACY_QWEN_PROVIDER];
        console.log(`[sanitize] Removed deprecated auth profile: ${LEGACY_QWEN_PROVIDER}`);
        modified = true;
      }


      // ── Disable built-in 'feishu' when official openclaw-lark plugin is active ──
      // OpenClaw ships a built-in 'feishu' extension in dist/extensions/feishu/
      // that conflicts with the official @larksuite/openclaw-lark plugin
      // (id: 'openclaw-lark').  When the canonical feishu plugin is NOT the
      // built-in 'feishu' itself, we must:
      //   1. Remove bare 'feishu' from plugins.allow (already done above at line ~1648)
      //   2. Delete plugins.entries.feishu entirely — keeping it with enabled:false
      //      causes the Gateway to report the feishu channel as "disabled".
      //      Since 'feishu' is not in plugins.allow, the built-in won't load.
      const allowArr2 = Array.isArray(pluginsObj.allow) ? pluginsObj.allow as string[] : [];
      const hasCanonicalFeishu = allowArr2.includes(canonicalFeishuId) || !!pEntries[canonicalFeishuId];
      if (hasCanonicalFeishu && canonicalFeishuId !== 'feishu') {
        // Remove bare 'feishu' from plugins.allow
        const bareFeishuIdx = allowArr2.indexOf('feishu');
        if (bareFeishuIdx !== -1) {
          allowArr2.splice(bareFeishuIdx, 1);
          console.log('[sanitize] Removed bare "feishu" from plugins.allow (openclaw-lark plugin is configured)');
          modified = true;
        }
        // Explicitly disable the built-in feishu extension so it doesn't
        // conflict with the official openclaw-lark plugin at runtime.
        // Simply deleting the entry is NOT sufficient — the built-in
        // extension in dist/extensions/feishu/ (enabledByDefault: true) will
        // still load unless explicitly marked as disabled.
        if (!pEntries.feishu || (pEntries.feishu as Record<string, unknown>).enabled !== false) {
          pEntries.feishu = { enabled: false };
          console.log('[sanitize] Disabled built-in feishu plugin (openclaw-lark plugin is configured)');
          modified = true;
        }
      }

      // ── Reconcile built-in channels with restrictive plugin allowlists ──
      // If plugins.allow is active because an external plugin is configured,
      // configured built-in channels must also be present or they will be
      // blocked on restart. If the allowlist only contains built-ins, drop it.
      const configuredBuiltIns = new Set<string>();
      const channelsObj = config.channels as Record<string, Record<string, unknown>> | undefined;
      if (channelsObj && typeof channelsObj === 'object') {
        for (const [channelId, section] of Object.entries(channelsObj)) {
          if (!BUILTIN_CHANNEL_IDS.has(channelId)) continue;
          if (!section || section.enabled === false) continue;
          if (Object.keys(section).length > 0) {
            configuredBuiltIns.add(channelId);
          }
        }
      }

      if (pEntries.whatsapp) {
        delete pEntries.whatsapp;
        console.log('[sanitize] Removed legacy plugins.entries.whatsapp for built-in channel');
        modified = true;
      }

      // Discover all bundled extension IDs and which ones are enabledByDefault
      // so we can (a) exclude them from the "external" set (prevents stale
      // entries surviving across OpenClaw upgrades) and (b) re-add the
      // enabledByDefault ones to prevent the allowlist from blocking them.
      const bundled = discoverBundledPlugins();

      const externalPluginIds = allowArr2.filter(
        (pluginId) => !BUILTIN_CHANNEL_IDS.has(pluginId) && !bundled.all.has(pluginId),
      );
      let nextAllow = [...externalPluginIds];
      if (externalPluginIds.length > 0) {
        for (const channelId of configuredBuiltIns) {
          if (!nextAllow.includes(channelId)) {
            nextAllow.push(channelId);
            modified = true;
            console.log(`[sanitize] Added configured built-in channel "${channelId}" to plugins.allow`);
          }
        }
      }

      // ── Ensure enabledByDefault built-in plugins survive restrictive allowlists ──
      // OpenClaw's plugin enable logic checks the allowlist BEFORE enabledByDefault,
      // so any bundled plugin with enabledByDefault: true (e.g. browser, diffs, etc.)
      // gets blocked when plugins.allow is non-empty.  We add them back here.
      // On upgrade, plugins removed from enabledByDefault are also removed from the
      // allowlist because they were excluded from externalPluginIds above.
      if (nextAllow.length > 0) {
        for (const pluginId of bundled.enabledByDefault) {
          // When the official openclaw-lark (or similar) plugin replaces the
          // built-in 'feishu' extension, skip re-adding 'feishu' here —
          // otherwise the enabledByDefault logic undoes the conflict
          // resolution performed above and the built-in extension keeps
          // reappearing in plugins.allow on every gateway restart.
          if (pluginId === 'feishu' && canonicalFeishuId !== 'feishu') {
            continue;
          }
          if (!nextAllow.includes(pluginId)) {
            nextAllow.push(pluginId);
          }
        }
      }

      if (JSON.stringify(nextAllow) !== JSON.stringify(allowArr2)) {
        if (nextAllow.length > 0) {
          pluginsObj.allow = nextAllow;
        } else {
          delete pluginsObj.allow;
        }
        modified = true;
      }

      if (Array.isArray(pluginsObj.allow) && pluginsObj.allow.length === 0) {
        delete pluginsObj.allow;
        modified = true;
      }
      if (pluginsObj.entries && Object.keys(pEntries).length === 0) {
        delete pluginsObj.entries;
        modified = true;
      }
      const pluginKeysExcludingEnabled = Object.keys(pluginsObj).filter((key) => key !== 'enabled');
      if (pluginsObj.enabled === true && pluginKeysExcludingEnabled.length === 0) {
        delete pluginsObj.enabled;
        modified = true;
      }
      if (Object.keys(pluginsObj).length === 0) {
        delete config.plugins;
        modified = true;
      }
    }

    // ── channels default-account migration and cleanup ─────────────
    // Most OpenClaw channel plugins/built-ins read the default account's
    // credentials from the top level of `channels.<type>`.  Mirror them
    // there so the runtime can discover them.
    //
    // Strict-schema channels (e.g. dingtalk, additionalProperties:false)
    // reject the `accounts` / `defaultAccount` keys entirely — strip them
    // so the Gateway doesn't crash on startup.
    const channelsObj = config.channels as Record<string, Record<string, unknown>> | undefined;
    const CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR = new Set(['dingtalk']);

    if (channelsObj && typeof channelsObj === 'object') {
      for (const [channelType, section] of Object.entries(channelsObj)) {
        if (!section || typeof section !== 'object') continue;

        if (CHANNELS_EXCLUDING_TOP_LEVEL_MIRROR.has(channelType)) {
          // Strict-schema channel: strip `accounts` and `defaultAccount`.
          // Credentials should live flat at the channel root.
          if ('accounts' in section) {
            delete section['accounts'];
            modified = true;
            console.log(`[sanitize] Removed incompatible 'accounts' from channels.${channelType}`);
          }
          if ('defaultAccount' in section) {
            delete section['defaultAccount'];
            modified = true;
            console.log(`[sanitize] Removed incompatible 'defaultAccount' from channels.${channelType}`);
          }
        } else {
          // Normal channel: mirror missing keys from default account to top level.
          const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
          const defaultAccountId =
            typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
                ? section.defaultAccount
                : 'default';
          const defaultAccountData = accounts?.[defaultAccountId] ?? accounts?.['default'];
          if (!defaultAccountData || typeof defaultAccountData !== 'object') continue;
          let mirrored = false;
          for (const [key, value] of Object.entries(defaultAccountData)) {
            if (!(key in section)) {
              section[key] = value;
              mirrored = true;
            }
          }
          if (mirrored) {
            modified = true;
            console.log(`[sanitize] Mirrored ${channelType} default account credentials to top-level channels.${channelType}`);
          }
        }
      }
    }

    if (modified) {
      await writeOpenClawJson(config);
      console.log('[sanitize] openclaw.json sanitized successfully');
    }
  });
}

export { getProviderEnvVar } from './provider-registry';
