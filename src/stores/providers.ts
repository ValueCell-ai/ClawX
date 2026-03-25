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
import { hostApiFetch } from '@/lib/host-api';
import {
  fetchProviderSnapshot,
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
  
  addProvider: async (config, apiKey) => {
    try {
      const fullConfig: ProviderConfig = {
        ...config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/providers', {
        method: 'POST',
        body: JSON.stringify({ config: fullConfig, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
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
  
  updateProvider: async (providerId, updates, apiKey) => {
    try {
      const existing = get().statuses.find((p) => p.id === providerId);
      if (!existing) {
        throw new Error('Provider not found');
      }

      const { hasKey: _hasKey, keyMasked: _keyMasked, ...providerConfig } = existing;
      
      const updatedConfig: ProviderConfig = {
        ...providerConfig,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates: updatedConfig, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
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
  
  deleteProvider: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      throw error;
    }
  },

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
  
  setApiKey: async (providerId, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates: {}, apiKey }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set API key');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to set API key:', error);
      throw error;
    }
  },

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/providers/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }

      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/providers/${encodeURIComponent(providerId)}?apiKeyOnly=1`,
        { method: 'DELETE' },
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }
      
      // Refresh the list
      await get().refreshProviderSnapshot();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },
  
  setDefaultProvider: async (providerId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/providers/default', {
        method: 'PUT',
        body: JSON.stringify({ providerId }),
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultAccountId: providerId });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },

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
      const result = await hostApiFetch<{ valid: boolean; error?: string }>('/api/providers/validate', {
        method: 'POST',
        body: JSON.stringify({ providerId, apiKey, options }),
      });
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },

  validateApiKey: async (providerId, apiKey, options) => get().validateAccountApiKey(providerId, apiKey, options),
  
  getAccountApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ apiKey: string | null }>(`/api/providers/${encodeURIComponent(providerId)}/api-key`);
      return result.apiKey;
    } catch {
      return null;
    }
  },

  getApiKey: async (providerId) => get().getAccountApiKey(providerId),
}));
