/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type { ProviderConfig, ProviderWithKeyInfo } from '@/lib/providers';

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
  deleteApiKey: (providerId: string) => Promise<void>;
  setDefaultProvider: (providerId: string) => Promise<void>;
  validateApiKey: (providerId: string, apiKey: string) => Promise<{ valid: boolean; error?: string }>;
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
      const providers = await window.electron.ipcRenderer.invoke('provider:list') as ProviderWithKeyInfo[];
      const defaultId = await window.electron.ipcRenderer.invoke('provider:getDefault') as string | null;
      
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
      
      const result = await window.electron.ipcRenderer.invoke('provider:save', fullConfig, apiKey) as { success: boolean; error?: string };
      
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
      
      const result = await window.electron.ipcRenderer.invoke('provider:save', updatedConfig, apiKey) as { success: boolean; error?: string };
      
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
      const result = await window.electron.ipcRenderer.invoke('provider:delete', providerId) as { success: boolean; error?: string };
      
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
      const result = await window.electron.ipcRenderer.invoke('provider:setApiKey', providerId, apiKey) as { success: boolean; error?: string };
      
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
  
  deleteApiKey: async (providerId) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('provider:deleteApiKey', providerId) as { success: boolean; error?: string };
      
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
      const result = await window.electron.ipcRenderer.invoke('provider:setDefault', providerId) as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to set default provider');
      }
      
      set({ defaultProviderId: providerId });
    } catch (error) {
      console.error('Failed to set default provider:', error);
      throw error;
    }
  },
  
  validateApiKey: async (providerId, apiKey) => {
    try {
      const result = await window.electron.ipcRenderer.invoke('provider:validateKey', providerId, apiKey) as { valid: boolean; error?: string };
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },
  
  getApiKey: async (providerId) => {
    try {
      return await window.electron.ipcRenderer.invoke('provider:getApiKey', providerId) as string | null;
    } catch {
      return null;
    }
  },
}));
