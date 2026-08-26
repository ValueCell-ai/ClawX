import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import type { ChannelType } from '@/types/channel';
import type { AgentSummary, AgentsSnapshot } from '@/types/agent';

interface AgentsState {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (name: string, options?: { inheritWorkspace?: boolean }) => Promise<void>;
  updateAgent: (agentId: string, name: string) => Promise<void>;
  updateAgentModel: (agentId: string, modelRef: string | null) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  assignChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  removeChannel: (agentId: string, channelType: ChannelType) => Promise<void>;
  clearError: () => void;
}

function applySnapshot(snapshot: AgentsSnapshot | undefined) {
  return snapshot ? {
    agents: snapshot.agents ?? [],
    defaultAgentId: snapshot.defaultAgentId ?? 'main',
    defaultModelRef: snapshot.defaultModelRef ?? null,
    configuredChannelTypes: snapshot.configuredChannelTypes ?? [],
    channelOwners: snapshot.channelOwners ?? {},
    channelAccountOwners: snapshot.channelAccountOwners ?? {},
  } : {};
}

function reconcileChatAgentSnapshot(snapshot: AgentsSnapshot | undefined): void {
  if (!snapshot) return;
  useChatStore.getState().reconcileAgentSessionTombstones(
    (snapshot.agents ?? []).map((agent) => agent.id),
  );
}

// A list response is publishable only if no newer list started and no Agent mutation
// was confirmed while that request was in flight.
let authoritativeMutationGeneration = 0;
let latestListRequestId = 0;

function commitMutationSnapshot(
  set: (state: Partial<AgentsState>) => void,
  snapshot: AgentsSnapshot | undefined,
): void {
  authoritativeMutationGeneration += 1;
  set({
    ...applySnapshot(snapshot),
    loading: false,
    error: null,
  });
  reconcileChatAgentSnapshot(snapshot);
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  defaultAgentId: 'main',
  defaultModelRef: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
  loading: false,
  error: null,

  fetchAgents: async () => {
    const requestId = ++latestListRequestId;
    const mutationGeneration = authoritativeMutationGeneration;
    set({ loading: true, error: null });
    try {
      const snapshot = await hostApi.agents.list();
      if (
        requestId !== latestListRequestId
        || mutationGeneration !== authoritativeMutationGeneration
      ) return;
      set({
        ...applySnapshot(snapshot),
        loading: false,
      });
      reconcileChatAgentSnapshot(snapshot);
    } catch (error) {
      if (
        requestId !== latestListRequestId
        || mutationGeneration !== authoritativeMutationGeneration
      ) return;
      set({ loading: false, error: String(error) });
    }
  },

  createAgent: async (name: string, options?: { inheritWorkspace?: boolean }) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.create({
        name,
        inheritWorkspace: options?.inheritWorkspace,
      });
      commitMutationSnapshot(set, snapshot);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgent: async (agentId: string, name: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.update(agentId, { name });
      commitMutationSnapshot(set, snapshot);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  updateAgentModel: async (agentId: string, modelRef: string | null) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.updateModel(agentId, modelRef);
      commitMutationSnapshot(set, snapshot);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (agentId: string) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.delete(agentId);
      commitMutationSnapshot(set, snapshot);
      useChatStore.getState().removeAgentSessions(agentId);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  assignChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.assignChannel(agentId, channelType);
      commitMutationSnapshot(set, snapshot);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeChannel: async (agentId: string, channelType: ChannelType) => {
    set({ error: null });
    try {
      const snapshot = await hostApi.agents.removeChannel(agentId, channelType);
      commitMutationSnapshot(set, snapshot);
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
