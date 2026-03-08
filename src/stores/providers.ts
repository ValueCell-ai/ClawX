/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type { ProviderConfig, ProviderWithKeyInfo } from '@/lib/providers';
import { invokeIpc } from '@/lib/api-client';

// Re-export types for consumers that imported from here
export type { ProviderConfig, ProviderWithKeyInfo } from '@/lib/providers';

interface ProviderState {
  providers: ProviderWithKeyInfo[];
  defaultProviderId: string | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchProviders: () => Promise<void>;
  addProvider: (config: Omit<ProviderConfig, 'createdAt' | 'updatedAt'>, apiKey?: string) => Promise<void>;
  updateProvider: (providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => Promise<void>;
  deleteProvider: (providerId: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  updateProviderWithKey: (
    providerId: string,
    updates: Partial<ProviderConfig>,
    apiKey?: string
  ) => Promise<void>;
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  validateApiKey: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
  getApiKey: (providerId: string) => Promise<string | null>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  defaultProviderId: null,
  loading: false,
  error: null,
  
  fetchProviders: async () => {
    set({ loading: true, error: null });
    
    try {
      const providers = await invokeIpc<ProviderWithKeyInfo[]>('provider:list');
      const defaultId = await invokeIpc<string | null>('provider:getDefault');
      
      set({ 
        providers, 
        defaultProviderId: defaultId,
        loading: false 
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  
  addProvider: async (config, apiKey) => {
    try {
      const fullConfig: ProviderConfig = {
        ...config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:save', fullConfig, apiKey);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to save provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to add provider:', error);
      throw error;
    }
  },
  
  updateProvider: async (providerId, updates, apiKey) => {
    try {
      const existing = get().providers.find((p) => p.id === providerId);
      if (!existing) {
        throw new Error('Provider not found');
      }

      const { hasKey: _hasKey, keyMasked: _keyMasked, ...providerConfig } = existing;
      
      const updatedConfig: ProviderConfig = {
        ...providerConfig,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:save', updatedConfig, apiKey);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to update provider:', error);
      throw error;
    }
  },
  
  deleteProvider: async (providerId) => {
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:delete', providerId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete provider');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      throw error;
    }
  },
  
  setApiKey: async (providerId, apiKey) => {
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:setApiKey', providerId, apiKey);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set API key');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to set API key:', error);
      throw error;
    }
  },

  updateProviderWithKey: async (providerId, updates, apiKey) => {
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        'provider:updateWithKey',
        providerId,
        updates,
        apiKey
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to update provider');
      }

      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to update provider with key:', error);
      throw error;
    }
  },
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:deleteApiKey', providerId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete API key');
      }
      
      // Refresh the list
      await get().fetchProviders();
    } catch (error) {
      console.error('Failed to delete API key:', error);
      throw error;
    }
  },
  
  setDefaultProvider: async (providerId) => {
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>('provider:setDefault', providerId);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultProviderId: providerId });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },
  
  validateApiKey: async (providerId, apiKey, options) => {
    try {
      const result = await invokeIpc<{ valid: boolean; error?: string }>(
        'provider:validateKey',
        providerId,
        apiKey,
        options
      );
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },
  
  getApiKey: async (providerId) => {
    try {
      return await invokeIpc<string | null>('provider:getApiKey', providerId);
    } catch {
      return null;
    }
  },
}));
