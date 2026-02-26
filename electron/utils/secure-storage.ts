/**
 * Provider Storage
 * Manages provider configurations and API keys.
 * Keys are stored in plain text alongside provider configs in a single electron-store.
 */

import type { ProviderType } from './provider-registry';
import { getActiveOpenClawProviders } from './openclaw-auth';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerStore: any = null;

async function getProviderStore() {
  if (!providerStore) {
    const Store = (await import('electron-store')).default;
    providerStore = new Store({
      name: 'clawx-providers',
      defaults: {
        providers: {} as Record<string, ProviderConfig>,
        apiKeys: {} as Record<string, string>,
        defaultProvider: null as string | null,
      },
    });
  }
  return providerStore;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==================== API Key Storage ====================

/**
 * Store an API key
 */
export async function storeApiKey(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    keys[providerId] = apiKey;
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to store API key:', error);
    return false;
  }
}

/**
 * Retrieve an API key
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    return keys[providerId] || null;
  } catch (error) {
    console.error('Failed to retrieve API key:', error);
    return null;
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(providerId: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    delete keys[providerId];
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return false;
  }
}

/**
 * Check if an API key exists for a provider
 */
export async function hasApiKey(providerId: string): Promise<boolean> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return providerId in keys;
}

/**
 * List all provider IDs that have stored keys
 */
export async function listStoredKeyIds(): Promise<string[]> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return Object.keys(keys);
}

// ==================== Provider Configuration ====================

/**
 * Save a provider configuration
 */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  providers[config.id] = config;
  s.set('providers', providers);
}

/**
 * Get a provider configuration
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return providers[providerId] || null;
}

/**
 * Get all provider configurations
 */
export async function getAllProviders(): Promise<ProviderConfig[]> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return Object.values(providers);
}

/**
 * Delete a provider configuration and its API key
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  try {
    // Delete the API key
    await deleteApiKey(providerId);

    // Delete the provider config
    const s = await getProviderStore();
    const providers = s.get('providers') as Record<string, ProviderConfig>;
    delete providers[providerId];
    s.set('providers', providers);

    // Clear default if this was the default
    if (s.get('defaultProvider') === providerId) {
      s.delete('defaultProvider');
    }

    return true;
  } catch (error) {
    console.error('Failed to delete provider:', error);
    return false;
  }
}

/**
 * Set the default provider
 */
export async function setDefaultProvider(providerId: string): Promise<void> {
  const s = await getProviderStore();
  s.set('defaultProvider', providerId);
}

/**
 * Get the default provider
 */
export async function getDefaultProvider(): Promise<string | undefined> {
  const s = await getProviderStore();
  return s.get('defaultProvider') as string | undefined;
}

/**
 * Get provider with masked key info (for UI display)
 */
export async function getProviderWithKeyInfo(
  providerId: string
): Promise<(ProviderConfig & { hasKey: boolean; keyMasked: string | null }) | null> {
  const provider = await getProvider(providerId);
  if (!provider) return null;

  const apiKey = await getApiKey(providerId);
  let keyMasked: string | null = null;

  if (apiKey) {
    if (apiKey.length > 12) {
      keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
    } else {
      keyMasked = '*'.repeat(apiKey.length);
    }
  }

  return {
    ...provider,
    hasKey: !!apiKey,
    keyMasked,
  };
}

/**
 * Get all providers with key info (for UI display)
 * Also synchronizes ClawX local provider list with OpenClaw's actual config.
 */
export async function getAllProvidersWithKeyInfo(): Promise<
  Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }>
> {
  const providers = await getAllProviders();
  const results: Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }> = [];
  const activeOpenClawProviders = getActiveOpenClawProviders();

  // We need to avoid deleting native ones like 'anthropic' or 'google'
  // that don't need to exist in openclaw.json models.providers
  const OpenClawBuiltinList = [
    'anthropic', 'openai', 'google', 'moonshot', 'siliconflow', 'ollama'
  ];

  for (const provider of providers) {
    // Sync check: If it's a custom/OAuth provider and it no longer exists in OpenClaw config
    // (e.g. wiped by Gateway due to missing plugin, or manually deleted by user)
    // we should remove it from ClawX UI to stay consistent.
    const isBuiltin = OpenClawBuiltinList.includes(provider.type);
    if (!isBuiltin && !activeOpenClawProviders.has(provider.type) && !activeOpenClawProviders.has(provider.id)) {
      console.log(`[Sync] Provider ${provider.id} (${provider.type}) missing from OpenClaw, dropping from ClawX UI`);
      await deleteProvider(provider.id);
      continue;
    }

    const apiKey = await getApiKey(provider.id);
    let keyMasked: string | null = null;

    if (apiKey) {
      if (apiKey.length > 12) {
        keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
      } else {
        keyMasked = '*'.repeat(apiKey.length);
      }
    }

    results.push({
      ...provider,
      hasKey: !!apiKey,
      keyMasked,
    });
  }

  return results;
}

