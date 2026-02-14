/**
 * Gateway State Store
 * Manages Gateway connection state and communication
 */
import { create } from 'zustand';
import type { GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;

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
    if (gatewayInitPromise) {
      await gatewayInitPromise;
      return;
    }

    gatewayInitPromise = (async () => {
      try {
        // Get initial status first
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

        // Some Gateway builds stream chat events via generic "agent" notifications.
        // Normalize and forward them to the chat store.
        // The Gateway may put event fields (state, message, etc.) either inside
        // params.data or directly on params — we must handle both layouts.
        window.electron.ipcRenderer.on('gateway:notification', (notification) => {
          const payload = notification as { method?: string; params?: Record<string, unknown> } | undefined;
          if (!payload || payload.method !== 'agent' || !payload.params || typeof payload.params !== 'object') {
            return;
          }

          const p = payload.params;
          const data = (p.data && typeof p.data === 'object') ? (p.data as Record<string, unknown>) : {};
          const normalizedEvent: Record<string, unknown> = {
            // Spread data sub-object first (nested layout)
            ...data,
            // Then override with top-level params fields (flat layout takes precedence)
            runId: p.runId ?? data.runId,
            sessionKey: p.sessionKey ?? data.sessionKey,
            stream: p.stream ?? data.stream,
            seq: p.seq ?? data.seq,
            // Critical: also pick up state and message from params (flat layout)
            state: p.state ?? data.state,
            message: p.message ?? data.message,
          };

          import('./chat')
            .then(({ useChatStore }) => {
              useChatStore.getState().handleChatEvent(normalizedEvent);
            })
            .catch((err) => {
              console.warn('Failed to forward gateway notification event:', err);
            });
        });

        // Listen for chat events from the gateway and forward to chat store.
        // The data arrives as { message: payload } from handleProtocolEvent.
        // The payload may be a full event wrapper ({ state, runId, message })
        // or the raw chat message itself. We need to handle both.
        window.electron.ipcRenderer.on('gateway:chat-message', (data) => {
          try {
            // Dynamic import to avoid circular dependency
            import('./chat').then(({ useChatStore }) => {
              const chatData = data as Record<string, unknown>;
              // Unwrap the { message: payload } wrapper from handleProtocolEvent
              const payload = ('message' in chatData && typeof chatData.message === 'object')
                ? chatData.message as Record<string, unknown>
                : chatData;

              // If payload has a 'state' field, it's already a proper event wrapper
              if (payload.state) {
                useChatStore.getState().handleChatEvent(payload);
                return;
              }

              // Otherwise, payload is the raw message — wrap it as a 'final' event
              // so handleChatEvent can process it (this happens when the Gateway
              // sends protocol events with the message directly as payload).
              const syntheticEvent: Record<string, unknown> = {
                state: 'final',
                message: payload,
                runId: chatData.runId ?? payload.runId,
              };
              useChatStore.getState().handleChatEvent(syntheticEvent);
            });
          } catch (err) {
            console.warn('Failed to forward chat event:', err);
          }
        });

      } catch (error) {
        console.error('Failed to initialize Gateway:', error);
        set({ lastError: String(error) });
      } finally {
        gatewayInitPromise = null;
      }
    })();

    await gatewayInitPromise;
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
