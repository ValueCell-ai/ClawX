/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { createHostEventSource, hostApiFetch } from '@/lib/host-api';
import { gatewayClient } from '@/lib/gateway-client';
import type { GatewayStatus } from '../types/gateway';
import { invokeIpc } from '@/lib/api-client';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventSource: EventSource | null = null;

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
  init: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  checkHealth: () => Promise<GatewayHealth>;
  rpc: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  setStatus: (status: GatewayStatus) => void;
  clearError: () => void;
}

function handleGatewayNotification(notification: { method?: string; params?: Record<string, unknown> } | undefined): void {
  const payload = notification;
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

  const runId = p.runId ?? data.runId;
  const sessionKey = p.sessionKey ?? data.sessionKey;
  if (phase === 'started' && runId != null && sessionKey != null) {
    import('./chat')
      .then(({ useChatStore }) => {
        useChatStore.getState().handleChatEvent({
          state: 'started',
          runId,
          sessionKey,
        });
      })
      .catch(() => {});
  }

  if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        state.loadHistory(true);
        if (state.sending) {
          useChatStore.setState({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
          });
        }
      })
      .catch(() => {});
  }
}

function handleGatewayChatMessage(data: unknown): void {
  import('./chat').then(({ useChatStore }) => {
    const chatData = data as Record<string, unknown>;
    const payload = ('message' in chatData && typeof chatData.message === 'object')
      ? chatData.message as Record<string, unknown>
      : chatData;

    if (payload.state) {
      useChatStore.getState().handleChatEvent(payload);
      return;
    }

    useChatStore.getState().handleChatEvent({
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
    });
  }).catch(() => {});
}

function handleGatewayMessage(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const msg = data as Record<string, unknown>;
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
}

function mapChannelStatus(status: string): 'connected' | 'connecting' | 'disconnected' | 'error' {
  switch (status) {
    case 'connected':
    case 'running':
      return 'connected';
    case 'connecting':
    case 'starting':
      return 'connecting';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'disconnected';
  }
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
        const status = await invokeIpc('gateway:status') as GatewayStatus;
        set({ status, isInitialized: true });

        if (!gatewayEventSource) {
          gatewayEventSource = createHostEventSource();
          gatewayEventSource.addEventListener('gateway:status', (event) => {
            set({ status: JSON.parse((event as MessageEvent).data) as GatewayStatus });
          });
          gatewayEventSource.addEventListener('gateway:error', (event) => {
            const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
            set({ lastError: payload.message || 'Gateway error' });
          });
        }

        gatewayClient.on('agent', (payload) => handleGatewayNotification({ method: 'agent', params: payload as Record<string, unknown> }));
        gatewayClient.on('chat', (payload) => handleGatewayChatMessage({ message: payload }));
        gatewayClient.on('message', handleGatewayMessage);
        gatewayClient.on('channel.status', (payload) => {
          import('./channels')
            .then(({ useChannelsStore }) => {
              const update = payload as { channelId?: string; status?: string };
              if (!update.channelId || !update.status) return;
              const state = useChannelsStore.getState();
              const channel = state.channels.find((item) => item.type === update.channelId);
              if (channel) {
                state.updateChannel(channel.id, { status: mapChannelStatus(update.status) });
              }
            })
            .catch(() => {});
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
      const result = await invokeIpc('gateway:start') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to start Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  stop: async () => {
    try {
      await invokeIpc('gateway:stop');
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await invokeIpc('gateway:restart') as { success: boolean; error?: string };

      if (!result.success) {
        set({
          status: { ...get().status, state: 'error', error: result.error },
          lastError: result.error || 'Failed to restart Gateway',
        });
      }
    } catch (error) {
      set({
        status: { ...get().status, state: 'error', error: String(error) },
        lastError: String(error),
      });
    }
  },

  checkHealth: async () => {
    try {
      const result = await invokeIpc('gateway:health') as {
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
    const result = await invokeIpc('gateway:rpc', method, params, timeoutMs) as {
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
