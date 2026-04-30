/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
import { normalizeProviderApiKeyInput } from '@/lib/providers';
import { hostApiFetch } from '@/lib/host-api';
import {
  fetchProviderSnapshot,
  isHostApiRouteMissing,
} from '@/lib/provider-accounts';

// Re-export types for consumers that imported from here
export type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
export type { ProviderSnapshot } from '@/lib/provider-accounts';

interface ProviderState {
  statuses: ProviderWithKeyInfo[];
  accounts: ProviderAccount[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  refreshProviderSnapshot: () => Promise<void>;
  createAccount: (account: ProviderAccount, apiKey?: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  validateAccountApiKey: (
    accountId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getAccountApiKey: (accountId: string) => Promise<string | null>;

  // Legacy compatibility aliases
  fetchProviders: () => Promise<void>;
  addProvider: (config: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>, apiKey?: string) => Promise<void>;
  addAccount: (account: ProviderAccount, apiKey?: string) => Promise<void>;
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => Promise<void>;
  updateAccount: (accountId: string, updates: Partial<ProviderAccount>, apiKey?: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  updateProviderWithKey: (
    providerId: string,
    updates: Partial<ProviderConfig>,
    apiKey?: string
  ) => Promise<void>;
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  setDefaultAccount: (accountId: string) => Promise<void>;
  validateApiKey: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<{ valid: boolean; error?: string }>;
  getApiKey: (providerId: string) => Promise<string | null>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  statuses: [],
  accounts: [],
  vendors: [],
  defaultAccountId: null,
  loading: false,
  error: null,

  init: async () => {
    await get().refreshProviderSnapshot();
  },

  refreshProviderSnapshot: async () => {
    set({ loading: true, error: null });
    
    try {
      const snapshot = await fetchProviderSnapshot();
      
      set({ 
        statuses: snapshot.statuses ?? [],
        accounts: snapshot.accounts ?? [],
        vendors: snapshot.vendors ?? [],
        defaultAccountId: snapshot.defaultAccountId ?? null,
        loading: false 
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchProviders: async () => get().refreshProviderSnapshot(),

  // Legacy ProviderConfig-shaped alias kept for backward compatibility
  // with any stale caller. Internally projects the legacy config payload
  // onto the new ProviderAccount surface and delegates to createAccount,
  // so we hit /api/provider-accounts instead of the deprecated
  // /api/providers POST route.
  addProvider: async (config, apiKey) => {
    try {
      const now = new Date().toISOString();
      const account: ProviderAccount = {
        id: config.id,
        vendorId: config.type,
        label: config.name,
        authMode: config.type === 'ollama' ? 'local' : 'api_key',
        baseUrl: config.baseUrl,
        apiProtocol: config.apiProtocol,
        headers: config.headers,
        model: config.model,
        fallbackModels: config.fallbackModels,
        fallbackAccountIds: config.fallbackProviderIds,
        enabled: config.enabled,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };
      await get().createAccount(account, apiKey);
    } catch (error) {
      console.error('Failed to add provider:', error);
      throw error;
    }
  },

  createAccount: async (account, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({ account, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  },

  addAccount: async (account, apiKey) => get().createAccount(account, apiKey),

  // Legacy ProviderConfig-shaped alias. Translates the partial ProviderConfig
  // patch into a ProviderAccount patch and routes through updateAccount so we
  // never hit the deprecated /api/providers/:id PUT route from the renderer.
  updateProvider: async (providerId, updates, apiKey) => {
    try {
      const accountUpdates: Partial<ProviderAccount> = {};
      if (updates.name !== undefined) accountUpdates.label = updates.name;
      if (updates.type !== undefined) accountUpdates.vendorId = updates.type;
      if (updates.baseUrl !== undefined) accountUpdates.baseUrl = updates.baseUrl;
      if (updates.apiProtocol !== undefined) accountUpdates.apiProtocol = updates.apiProtocol;
      if (updates.headers !== undefined) accountUpdates.headers = updates.headers;
      if (updates.model !== undefined) accountUpdates.model = updates.model;
      if (updates.fallbackModels !== undefined) accountUpdates.fallbackModels = updates.fallbackModels;
      if (updates.fallbackProviderIds !== undefined) accountUpdates.fallbackAccountIds = updates.fallbackProviderIds;
      if (updates.enabled !== undefined) accountUpdates.enabled = updates.enabled;
      await get().updateAccount(providerId, accountUpdates, apiKey);
    } catch (error) {
      console.error('Failed to update provider:', error);
      throw error;
    }
  },

  updateAccount: async (accountId, updates, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    }
  },

  deleteProvider: async (providerId) => get().removeAccount(providerId),

  removeAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider account');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  },

  deleteAccount: async (accountId) => get().removeAccount(accountId),

  // Legacy alias kept for in-flight callers; routes the call to the new
  // /api/provider-accounts/:id PUT endpoint via updateAccount, which is
  // semantically equivalent to "set API key without other changes".
  setApiKey: async (providerId, apiKey) => get().updateAccount(providerId, {}, apiKey),

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    try {
      const accountUpdates: Partial<ProviderAccount> = {};
      if (updates.name !== undefined) accountUpdates.label = updates.name;
      if (updates.type !== undefined) accountUpdates.vendorId = updates.type;
      if (updates.baseUrl !== undefined) accountUpdates.baseUrl = updates.baseUrl;
      if (updates.apiProtocol !== undefined) accountUpdates.apiProtocol = updates.apiProtocol;
      if (updates.headers !== undefined) accountUpdates.headers = updates.headers;
      if (updates.model !== undefined) accountUpdates.model = updates.model;
      if (updates.fallbackModels !== undefined) accountUpdates.fallbackModels = updates.fallbackModels;
      if (updates.fallbackProviderIds !== undefined) accountUpdates.fallbackAccountIds = updates.fallbackProviderIds;
      if (updates.enabled !== undefined) accountUpdates.enabled = updates.enabled;
      await get().updateAccount(providerId, accountUpdates, apiKey);
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },

  // Legacy alias — the new account API exposes the same `apiKeyOnly=1`
  // contract, so we just route through it.
  deleteApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/provider-accounts/${encodeURIComponent(providerId)}?apiKeyOnly=1`,
        { method: 'DELETE' },
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },

  setDefaultProvider: async (providerId) => get().setDefaultAccount(providerId),

  setDefaultAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
        method: 'PUT',
        body: JSON.stringify({ accountId }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider account');
      }

      set({ defaultAccountId: accountId });
    } catch (error) {
      console.error('Failed to set default account:', error);
      throw error;
    }
  },
  
  validateAccountApiKey: async (providerId, apiKey, options) => {
    try {
      const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
      // The new endpoint accepts both `accountId` (preferred) and a bare
      // `vendorId` (used during the Add-Provider flow when no account
      // exists yet). We always send `providerId` too so older Host API
      // builds that still own the legacy contract keep working when we
      // fall back to /api/providers/validate below.
      const fetchNew = async () => hostApiFetch<{ valid: boolean; error?: string }>('/api/provider-accounts/validate', {
        method: 'POST',
        body: JSON.stringify({
          accountId: providerId,
          vendorId: providerId,
          providerId,
          apiKey: normalizedApiKey,
          options,
        }),
      });
      const fetchLegacy = async () => hostApiFetch<{ valid: boolean; error?: string }>('/api/providers/validate', {
        method: 'POST',
        body: JSON.stringify({ providerId, apiKey: normalizedApiKey, options }),
      });

      let result: { valid: boolean; error?: string } | { success: false; error: string };
      try {
        result = await fetchNew();
      } catch (error) {
        if (error instanceof Error && /404|not\s+found/i.test(error.message)) {
          result = await fetchLegacy();
        } else {
          throw error;
        }
      }
      // hostApiFetch returns the body even for non-2xx (e.g. 404), so a
      // missing route surfaces as { success: false, error: "No route ..." }.
      // Detect that and fall back to the legacy endpoint before reporting
      // back to the caller.
      if (isHostApiRouteMissing(result)) {
        result = await fetchLegacy();
      }
      return result as { valid: boolean; error?: string };
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },

  validateApiKey: async (providerId, apiKey, options) => get().validateAccountApiKey(providerId, apiKey, options),

  getAccountApiKey: async (providerId) => {
    try {
      const fetchNew = async () => hostApiFetch<{ apiKey: string | null } | { success: false; error: string }>(
        `/api/provider-accounts/${encodeURIComponent(providerId)}/api-key`,
      );
      const fetchLegacy = async () => hostApiFetch<{ apiKey: string | null }>(
        `/api/providers/${encodeURIComponent(providerId)}/api-key`,
      );

      let result: { apiKey: string | null } | { success: false; error: string };
      try {
        result = await fetchNew();
      } catch (error) {
        if (error instanceof Error && /404|not\s+found/i.test(error.message)) {
          result = await fetchLegacy();
        } else {
          throw error;
        }
      }
      if (isHostApiRouteMissing(result)) {
        result = await fetchLegacy();
      }
      return (result as { apiKey: string | null }).apiKey ?? null;
    } catch {
      return null;
    }
  },

  getApiKey: async (providerId) => get().getAccountApiKey(providerId),
}));
