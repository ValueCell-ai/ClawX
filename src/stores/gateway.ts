/**
 * Gateway State Store
 * Manages Gateway connection state and communication
 */
import { create } from 'zustand';
import type { GatewayStatus } from '../types/gateway';

interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
}

interface GatewayState {
  status: GatewayStatus;
  health: GatewayHealth | null;
  isInitialized: boolean;
  lastError: string | null;

  // Actions
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  clearError: () => void;
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  status: {
    state: 'stopped',
    port: 18789,
  },
  health: null,
  isInitialized: false,
  lastError: null,

  init: async () => {
    if (get().isInitialized) return;

    try {
      // Get initial status
      const status = await window.electron.ipcRenderer.invoke('gateway:status') as GatewayStatus;
      set({ status, isInitialized: true });

      // Listen for status changes
      window.electron.ipcRenderer.on('gateway:status-changed', (newStatus) => {
        set({ status: newStatus as GatewayStatus });
      });

      // Listen for errors
      window.electron.ipcRenderer.on('gateway:error', (error) => {
        set({ lastError: String(error) });
      });

      // Listen for notifications
      window.electron.ipcRenderer.on('gateway:notification', (notification) => {
        console.log('Gateway notification:', notification);
      });

      // Listen for chat events from the gateway and forward to chat store
      window.electron.ipcRenderer.on('gateway:chat-message', (data) => {
        try {
          // Dynamic import to avoid circular dependency
          import('./chat').then(({ useChatStore }) => {
            const chatData = data as { message?: Record<string, unknown> } | Record<string, unknown>;
            const event = ('message' in chatData && typeof chatData.message === 'object')
              ? chatData.message as Record<string, unknown>
              : chatData as Record<string, unknown>;
            useChatStore.getState().handleChatEvent(event);
          });
        } catch (err) {
          console.warn('Failed to forward chat event:', err);
        }
      });

    } catch (error) {
      console.error('Failed to initialize Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  start: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await window.electron.ipcRenderer.invoke('gateway:start') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway'
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error)
      });
    }
  },

  stop: async () => {
    try {
      await window.electron.ipcRenderer.invoke('gateway:stop');
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await window.electron.ipcRenderer.invoke('gateway:restart') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway'
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error)
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:health') as {
        success: boolean;
        ok: boolean;
        error?: string;
        uptime?: number
      };

      const health: GatewayHealth = {
        ok: result.ok,
        error: result.error,
        uptime: result.uptime,
      };

      set({ health });
      return health;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const result = await window.electron.ipcRenderer.invoke('gateway:rpc', method, params, timeoutMs) as {
      success: boolean;
      result?: T;
      error?: string;
    };

    if (!result.success) {
      throw new Error(result.error || `RPC call failed: ${method}`);
    }

    return result.result as T;
  },

  setStatus: (status) => set({ status }),

  clearError: () => set({ lastError: null }),
}));
