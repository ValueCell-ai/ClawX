import { create } from 'zustand';
import type { AgentCreateInput, AgentRow, AgentsListResult } from '@/types/agent';

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
  loading: boolean;
  creating: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  createAgent: (input: AgentCreateInput) => Promise<void>;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  defaultId: 'main',
  mainKey: 'main',
  scope: 'per-sender',
  loading: false,
  creating: false,
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

  createAgent: async (input) => {
    set({ creating: true, error: null });
    try {
      await invokeGatewayRpc('agents.create', {
        name: input.name,
        workspace: input.workspace,
        ...(input.emoji ? { emoji: input.emoji } : {}),
      });
      await get().fetchAgents();
      set({ creating: false });
    } catch (error) {
      set({ creating: false, error: String(error) });
      throw error;
    }
  },
}));
