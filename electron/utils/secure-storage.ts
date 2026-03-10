/**
 * Provider Storage
 * Manages provider configurations and API keys.
 * This file remains the legacy compatibility layer while the app migrates to
 * account-based provider storage and a dedicated secret-store abstraction.
 */

import { BUILTIN_PROVIDER_TYPES, type ProviderType } from './provider-registry';
import { getActiveOpenClawProviders } from './openclaw-auth';
import {
  deleteProviderAccount,
  getProviderAccount,
  listProviderAccounts,
  providerAccountToConfig,
  providerConfigToAccount,
  saveProviderAccount,
  setDefaultProviderAccount,
} from '../services/providers/provider-store';
import { ensureProviderStoreMigrated } from '../services/providers/provider-migration';
import { getClawXProviderStore } from '../services/providers/store-instance';
import {
  deleteProviderSecret,
  getProviderSecret,
  setProviderSecret,
} from '../services/secrets/secret-store';
import { getOpenClawProviderKeyForType } from './provider-keys';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
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
    await ensureProviderStoreMigrated();
    const s = await getClawXProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    keys[providerId] = apiKey;
    s.set('apiKeys', keys);
    await setProviderSecret({
      type: 'api_key',
      accountId: providerId,
      apiKey,
    });
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
    await ensureProviderStoreMigrated();
    const secret = await getProviderSecret(providerId);
    if (secret?.type === 'api_key') {
      return secret.apiKey;
    }
    if (secret?.type === 'local') {
      return secret.apiKey ?? null;
    }

    const s = await getClawXProviderStore();
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
    await ensureProviderStoreMigrated();
    const s = await getClawXProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    delete keys[providerId];
    s.set('apiKeys', keys);
    await deleteProviderSecret(providerId);
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
  await ensureProviderStoreMigrated();
  const secret = await getProviderSecret(providerId);
  if (secret?.type === 'api_key') {
    return true;
  }

  const s = await getClawXProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return providerId in keys;
}

/**
 * List all provider IDs that have stored keys
 */
export async function listStoredKeyIds(): Promise<string[]> {
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return Object.keys(keys);
}

// ==================== Provider Configuration ====================

/**
 * Save a provider configuration
 */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  providers[config.id] = config;
  s.set('providers', providers);

  const defaultProviderId = (s.get('defaultProvider') ?? null) as string | null;
  await saveProviderAccount(
    providerConfigToAccount(config, { isDefault: defaultProviderId === config.id }),
  );
}

/**
 * Get a provider configuration
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  if (providers[providerId]) {
    return providers[providerId];
  }

  const account = await getProviderAccount(providerId);
  return account ? providerAccountToConfig(account) : null;
}

/**
 * Get all provider configurations
 */
export async function getAllProviders(): Promise<ProviderConfig[]> {
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  const legacyProviders = Object.values(providers);
  if (legacyProviders.length > 0) {
    return legacyProviders;
  }

  const accounts = await listProviderAccounts();
  return accounts.map(providerAccountToConfig);
}

/**
 * Delete a provider configuration and its API key
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  try {
    await ensureProviderStoreMigrated();
    // Delete the API key
    await deleteApiKey(providerId);

    // Delete the provider config
    const s = await getClawXProviderStore();
    const providers = s.get('providers') as Record<string, ProviderConfig>;
    delete providers[providerId];
    s.set('providers', providers);
    await deleteProviderAccount(providerId);

    // Clear default if this was the default
    if (s.get('defaultProvider') === providerId) {
      s.delete('defaultProvider');
      s.delete('defaultProviderAccountId');
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
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  s.set('defaultProvider', providerId);
  await setDefaultProviderAccount(providerId);
}

/**
 * Get the default provider
 */
export async function getDefaultProvider(): Promise<string | undefined> {
  await ensureProviderStoreMigrated();
  const s = await getClawXProviderStore();
  return (s.get('defaultProvider') as string | undefined)
    ?? (s.get('defaultProviderAccountId') as string | undefined);
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
  const activeOpenClawProviders = await getActiveOpenClawProviders();

  for (const provider of providers) {
    // Sync check: If it's a custom/OAuth provider and it no longer exists in OpenClaw config
    // (e.g. wiped by Gateway due to missing plugin, or manually deleted by user)
    // we should remove it from ClawX UI to stay consistent.
    const isBuiltin = BUILTIN_PROVIDER_TYPES.includes(provider.type);
    // For custom/ollama providers, the OpenClaw config key is derived as
    // "<type>-<suffix>" where suffix = first 8 chars of providerId with hyphens stripped.
    // e.g. provider.id "custom-a1b2c3d4-..." → strip hyphens → "customa1b2c3d4..." → slice(0,8) → "customa1"
    // → openClawKey = "custom-customa1"
    // This must match getOpenClawProviderKey() in ipc-handlers.ts exactly.
    const openClawKey = getOpenClawProviderKeyForType(provider.type, provider.id);
    if (!isBuiltin && !activeOpenClawProviders.has(provider.type) && !activeOpenClawProviders.has(provider.id) && !activeOpenClawProviders.has(openClawKey)) {
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
