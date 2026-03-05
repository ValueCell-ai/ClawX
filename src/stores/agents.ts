import { create } from 'zustand';
import type {
  AgentCreateInput,
  AgentCreateResult,
  AgentDeleteInput,
  AgentRow,
  AgentsFilesGetResult,
  AgentsFilesListResult,
  AgentsFilesSetResult,
  AgentsListResult,
  AgentUpdateInput,
  ModelChoice,
  ModelsListResult,
} from '@/types/agent';

type GatewayRpcResult<T> = {
  success: boolean;
  result?: T;
  error?: string;
};

async function invokeGatewayRpc<T>(method: string, params?: unknown): Promise<T> {
  const response = await window.electron.ipcRenderer.invoke(
    'gateway:rpc',
    method,
    params
  ) as GatewayRpcResult<T>;

  if (!response.success) {
    throw new Error(response.error || `RPC call failed: ${method}`);
  }

  return response.result as T;
}

interface AgentsState {
  agents: AgentRow[];
  defaultId: string;
  mainKey: string;
  scope: string;
  models: ModelChoice[];
  loading: boolean;
  submitting: boolean;
  deletingAgentId: string | null;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchModels: () => Promise<void>;
  createAgent: (input: AgentCreateInput) => Promise<AgentCreateResult>;
  updateAgent: (input: AgentUpdateInput) => Promise<void>;
  deleteAgent: (input: AgentDeleteInput) => Promise<void>;
  listAgentFiles: (agentId: string) => Promise<AgentsFilesListResult>;
  getAgentFile: (agentId: string, name: string) => Promise<AgentsFilesGetResult>;
  setAgentFile: (agentId: string, name: string, content: string) => Promise<AgentsFilesSetResult>;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  defaultId: 'main',
  mainKey: 'main',
  scope: 'per-sender',
  models: [],
  loading: false,
  submitting: false,
  deletingAgentId: null,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const result = await invokeGatewayRpc<AgentsListResult>('agents.list');
      set({
        agents: result.agents ?? [],
        defaultId: result.defaultId ?? 'main',
        mainKey: result.mainKey ?? 'main',
        scope: result.scope ?? 'per-sender',
        loading: false,
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchModels: async () => {
    try {
      const result = await invokeGatewayRpc<ModelsListResult>('models.list');
      set({ models: result.models ?? [] });
    } catch {
      set({ models: [] });
    }
  },

  createAgent: async (input) => {
    set({ submitting: true, error: null });
    try {
      const result = await invokeGatewayRpc<AgentCreateResult>('agents.create', {
        name: input.name,
        workspace: input.workspace,
        ...(input.emoji ? { emoji: input.emoji } : {}),
        ...(input.avatar ? { avatar: input.avatar } : {}),
      });
      await get().fetchAgents();
      set({ submitting: false });
      return result;
    } catch (error) {
      set({ submitting: false, error: String(error) });
      throw error;
    }
  },

  updateAgent: async (input) => {
    set({ submitting: true, error: null });
    try {
      await invokeGatewayRpc('agents.update', {
        agentId: input.agentId,
        ...(input.name ? { name: input.name } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
        ...(input.model ? { model: input.model } : {}),
      });
      await get().fetchAgents();
      set({ submitting: false });
    } catch (error) {
      set({ submitting: false, error: String(error) });
      throw error;
    }
  },

  deleteAgent: async (input) => {
    set({ deletingAgentId: input.agentId, error: null });
    try {
      await invokeGatewayRpc('agents.delete', {
        agentId: input.agentId,
        deleteFiles: input.deleteFiles ?? true,
      });
      await get().fetchAgents();
      set({ deletingAgentId: null });
    } catch (error) {
      set({ deletingAgentId: null, error: String(error) });
      throw error;
    }
  },

  listAgentFiles: async (agentId) => {
    return await invokeGatewayRpc<AgentsFilesListResult>('agents.files.list', { agentId });
  },

  getAgentFile: async (agentId, name) => {
    return await invokeGatewayRpc<AgentsFilesGetResult>('agents.files.get', { agentId, name });
  },

  setAgentFile: async (agentId, name, content) => {
    return await invokeGatewayRpc<AgentsFilesSetResult>('agents.files.set', {
      agentId,
      name,
      content,
    });
  },
}));
