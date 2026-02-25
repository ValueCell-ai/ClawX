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
          const phase = data.phase ?? p.phase;

          const hasChatData = (p.state ?? data.state) || (p.message ?? data.message);
          if (hasChatData) {
            const normalizedEvent: Record<string, unknown> = {
              ...data,
              runId: p.runId ?? data.runId,
              sessionKey: p.sessionKey ?? data.sessionKey,
              stream: p.stream ?? data.stream,
              seq: p.seq ?? data.seq,
              state: p.state ?? data.state,
              message: p.message ?? data.message,
            };
            import('./chat')
              .then(({ useChatStore }) => {
                useChatStore.getState().handleChatEvent(normalizedEvent);
              })
              .catch(() => {});
          }

          // When the agent run completes, reload history to get the final response.
          if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
            import('./chat')
              .then(({ useChatStore }) => {
                const state = useChatStore.getState();
                if (state.sending) {
                  state.loadHistory(true);
                }
              })
              .catch(() => {});
          }
        });

        // Listen for chat events from the gateway and forward to chat store.
        // The data arrives as { message: payload } from handleProtocolEvent.
        // The payload may be a full event wrapper ({ state, runId, message })
        // or the raw chat message itself. We need to handle both.
        window.electron.ipcRenderer.on('gateway:chat-message', (data) => {
          try {
            import('./chat').then(({ useChatStore }) => {
              const chatData = data as Record<string, unknown>;
              const payload = ('message' in chatData && typeof chatData.message === 'object')
                ? chatData.message as Record<string, unknown>
                : chatData;

              if (payload.state) {
                useChatStore.getState().handleChatEvent(payload);
                return;
              }

              // Raw message without state wrapper — treat as final
              useChatStore.getState().handleChatEvent({
                state: 'final',
                message: payload,
                runId: chatData.runId ?? payload.runId,
              });
            }).catch(() => {});
          } catch {
            // Silently ignore forwarding failures
          }
        });

        // Catch-all: handle unmatched gateway messages that fell through
        // all protocol/notification handlers in the main process.
        // This prevents events from being silently lost.
        window.electron.ipcRenderer.on('gateway:message', (data) => {
          if (!data || typeof data !== 'object') return;
          const msg = data as Record<string, unknown>;

          // Try to detect if this is a chat-related event and forward it
          if (msg.state && msg.message) {
            import('./chat').then(({ useChatStore }) => {
              useChatStore.getState().handleChatEvent(msg);
            }).catch(() => {});
          } else if (msg.role && msg.content) {
            import('./chat').then(({ useChatStore }) => {
              useChatStore.getState().handleChatEvent({
                state: 'final',
                message: msg,
              });
            }).catch(() => {});
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
