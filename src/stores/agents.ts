/**
 * Agents State Store
 * Manages agent configuration state
 */
import { create } from 'zustand';
import type { Agent } from '../types/agent';

interface AgentsState {
    agents: Agent[];
    loading: boolean;
    error: string | null;
    saving: boolean;

    // Actions
    fetchAgents: () => Promise<void>;
    saveAgent: (agentId: string, updates: Partial<Omit<Agent, 'id' | 'isDefault'>>) => Promise<void>;
    deleteAgent: (agentId: string) => Promise<void>;
    toggleAgent: (agentId: string, enabled: boolean) => Promise<void>;
    clearError: () => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
    agents: [],
    loading: false,
    error: null,
    saving: false,

    fetchAgents: async () => {
        set({ loading: true, error: null });
        try {
            const result = await window.electron.ipcRenderer.invoke('agent:list') as {
                success: boolean;
                agents?: Agent[];
                error?: string;
            };

            if (result.success && result.agents) {
                set({ agents: result.agents, loading: false });
            } else {
                set({ agents: [], loading: false, error: result.error || 'Failed to load agents' });
            }
        } catch (err) {
            set({ agents: [], loading: false, error: String(err) });
        }
    },

    saveAgent: async (agentId: string, updates: Partial<Omit<Agent, 'id' | 'isDefault'>>) => {
        set({ saving: true, error: null });
        try {
            const result = await window.electron.ipcRenderer.invoke('agent:save', agentId, updates) as {
                success: boolean;
                error?: string;
            };

            if (!result.success) {
                set({ saving: false, error: result.error || 'Failed to save agent' });
                throw new Error(result.error || 'Failed to save agent');
            }

            set({ saving: false });

            // Refresh agent list
            await get().fetchAgents();
        } catch (err) {
            set({ saving: false, error: String(err) });
            throw err;
        }
    },

    deleteAgent: async (agentId: string) => {
        set({ saving: true, error: null });
        try {
            const result = await window.electron.ipcRenderer.invoke('agent:delete', agentId) as {
                success: boolean;
                error?: string;
            };

            if (!result.success) {
                set({ saving: false, error: result.error || 'Failed to delete agent' });
                throw new Error(result.error || 'Failed to delete agent');
            }

            set({ saving: false });

            // Refresh agent list
            await get().fetchAgents();
        } catch (err) {
            set({ saving: false, error: String(err) });
            throw err;
        }
    },

    toggleAgent: async (agentId: string, enabled: boolean) => {
        try {
            const result = await window.electron.ipcRenderer.invoke('agent:save', agentId, { enabled }) as {
                success: boolean;
                error?: string;
            };

            if (!result.success) {
                throw new Error(result.error || 'Failed to toggle agent');
            }

            // Refresh
            await get().fetchAgents();
        } catch (err) {
            set({ error: String(err) });
            throw err;
        }
    },

    clearError: () => set({ error: null }),
}));
