/**
 * Gateway State Store
 * Uses Host API + SSE for lifecycle/status and a direct renderer WebSocket for runtime RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayStatus } from '../types/gateway';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;
let gatewayReconcileTimer: ReturnType<typeof setInterval> | null = null;
const gatewayEventDedupe = new Map<string, number>();
const GATEWAY_EVENT_DEDUPE_TTL_MS = 30_000;
const LOAD_SESSIONS_MIN_INTERVAL_MS = 1_200;
const LOAD_HISTORY_MIN_INTERVAL_MS = 800;
let lastLoadSessionsAt = 0;
let lastLoadHistoryAt = 0;
let cronRepairTriggeredThisSession = false;

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

function pruneGatewayEventDedupe(now: number): void {
  for (const [key, ts] of gatewayEventDedupe) {
    if (now - ts > GATEWAY_EVENT_DEDUPE_TTL_MS) {
      gatewayEventDedupe.delete(key);
    }
  }
}

function buildGatewayEventDedupeKey(event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  const state = event.state != null ? String(event.state) : '';
  if (runId || sessionKey || seq || state) {
    return [runId, sessionKey, seq, state].join('|');
  }
  const message = event.message;
  if (message && typeof message === 'object') {
    const msg = message as Record<string, unknown>;
    const messageId = msg.id != null ? String(msg.id) : '';
    const stopReason = msg.stopReason ?? msg.stop_reason;
    if (messageId || stopReason) {
      return `msg|${messageId}|${String(stopReason ?? '')}`;
    }
  }
  return null;
}

function getMessageIdDedupeKey(event: Record<string, unknown>): string | null {
  const state = event.state != null ? String(event.state) : '';
  if (state !== 'final') return null;
  const message = event.message;
  if (message && typeof message === 'object') {
    const msgId = (message as Record<string, unknown>).id;
    if (msgId != null) return `final-msgid|${String(msgId)}`;
  }
  return null;
}

function shouldProcessGatewayEvent(event: Record<string, unknown>): boolean {
  const key = buildGatewayEventDedupeKey(event);
  const msgKey = getMessageIdDedupeKey(event);
  if (!key && !msgKey) return true;
  const now = Date.now();
  pruneGatewayEventDedupe(now);
  if ((key && gatewayEventDedupe.has(key)) || (msgKey && gatewayEventDedupe.has(msgKey))) {
    return false;
  }
  if (key) gatewayEventDedupe.set(key, now);
  if (msgKey) gatewayEventDedupe.set(msgKey, now);
  return true;
}

function maybeLoadSessions(
  state: { loadSessions: () => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadSessionsAt < LOAD_SESSIONS_MIN_INTERVAL_MS) return;
  lastLoadSessionsAt = now;
  void state.loadSessions();
}

function maybeLoadHistory(
  state: { loadHistory: (quiet?: boolean) => Promise<void> },
  force = false,
): void {
  const now = Date.now();
  if (!force && now - lastLoadHistoryAt < LOAD_HISTORY_MIN_INTERVAL_MS) return;
  lastLoadHistoryAt = now;
  void state.loadHistory(true);
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
    if (shouldProcessGatewayEvent(normalizedEvent)) {
      import('./chat')
        .then(({ useChatStore }) => {
          useChatStore.getState().handleChatEvent(normalizedEvent);
        })
        .catch(() => {});
    }
  }

  const runId = p.runId ?? data.runId;
  const sessionKey = p.sessionKey ?? data.sessionKey;
  if (phase === 'started' && runId != null && sessionKey != null) {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        const resolvedSessionKey = String(sessionKey);
        const shouldRefreshSessions =
          resolvedSessionKey !== state.currentSessionKey
          || !state.sessions.some((session) => session.key === resolvedSessionKey);
        if (shouldRefreshSessions) {
          maybeLoadSessions(state, true);
        }

        state.handleChatEvent({
          state: 'started',
          runId,
          sessionKey: resolvedSessionKey,
        });
      })
      .catch(() => {});
  }

  if (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end') {
    import('./chat')
      .then(({ useChatStore }) => {
        const state = useChatStore.getState();
        const resolvedSessionKey = sessionKey != null ? String(sessionKey) : null;
        const shouldRefreshSessions = resolvedSessionKey != null && (
          resolvedSessionKey !== state.currentSessionKey
          || !state.sessions.some((session) => session.key === resolvedSessionKey)
        );
        if (shouldRefreshSessions) {
          maybeLoadSessions(state);
        }

        const matchesCurrentSession = resolvedSessionKey == null || resolvedSessionKey === state.currentSessionKey;
        const matchesActiveRun = runId != null && state.activeRunId != null && String(runId) === state.activeRunId;

        if (matchesCurrentSession || matchesActiveRun) {
          maybeLoadHistory(state);
        }
        if ((matchesCurrentSession || matchesActiveRun) && state.sending) {
          useChatStore.setState({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            error: null,
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
      if (!shouldProcessGatewayEvent(payload)) return;
      useChatStore.getState().handleChatEvent(payload);
      return;
    }

    const normalized = {
      state: 'final',
      message: payload,
      runId: chatData.runId ?? payload.runId,
    };
    if (!shouldProcessGatewayEvent(normalized)) return;
    useChatStore.getState().handleChatEvent(normalized);
  }).catch(() => {});
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
        const status = await hostApiFetch<GatewayStatus>('/api/gateway/status');
        set({ status, isInitialized: true });

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
            set({ status: payload });

            // Trigger cron repair when gateway becomes ready
            if (!cronRepairTriggeredThisSession && payload.state === 'running') {
              cronRepairTriggeredThisSession = true;
              // Fire-and-forget: fetch cron jobs to trigger repair logic in background
              import('./cron')
                .then(({ useCronStore }) => {
                  useCronStore.getState().fetchJobs();
                })
                .catch(() => {});
            }
          }));
          unsubscribers.push(subscribeHostEvent<{ message?: string }>('gateway:error', (payload) => {
            set({ lastError: payload.message || 'Gateway error' });
          }));
          unsubscribers.push(subscribeHostEvent<{ method?: string; params?: Record<string, unknown> }>(
            'gateway:notification',
            (payload) => {
              handleGatewayNotification(payload);
            },
          ));
          unsubscribers.push(subscribeHostEvent('gateway:chat-message', (payload) => {
            handleGatewayChatMessage(payload);
          }));
          unsubscribers.push(subscribeHostEvent<{ channelId?: string; status?: string }>(
            'gateway:channel-status',
            (update) => {
              import('./channels')
                .then(({ useChannelsStore }) => {
                  if (!update.channelId || !update.status) return;
                  const state = useChannelsStore.getState();
                  const channel = state.channels.find((item) => item.type === update.channelId);
                  if (channel) {
                    const newStatus = mapChannelStatus(update.status);
                    state.updateChannel(channel.id, { status: newStatus });
                    
                    if (newStatus === 'disconnected' || newStatus === 'error') {
                      state.scheduleAutoReconnect(channel.id);
                    } else if (newStatus === 'connected' || newStatus === 'connecting') {
                      state.clearAutoReconnect(channel.id);
                    }
                  }
                })
                .catch(() => {});
            },
          ));
          gatewayEventUnsubscribers = unsubscribers;

          // Periodic reconciliation safety net: every 30 seconds, check if the
          // renderer's view of gateway state has drifted from main process truth.
          // This catches any future one-off IPC delivery failures without adding
          // a constant polling load (single lightweight IPC invoke per interval).
          // Clear any previous timer first to avoid leaks during HMR reloads.
          if (gatewayReconcileTimer !== null) {
            clearInterval(gatewayReconcileTimer);
          }
          gatewayReconcileTimer = setInterval(() => {
            const ipc = window.electron?.ipcRenderer;
            if (!ipc) return;
            ipc.invoke('gateway:status')
              .then((result: unknown) => {
                const latest = result as GatewayStatus;
                const current = get().status;
                if (latest.state !== current.state) {
                  console.info(
                    `[gateway-store] reconciled stale state: ${current.state} → ${latest.state}`,
                  );
                  set({ status: latest });
                }
              })
              .catch(() => { /* ignore */ });
          }, 30_000);
        }

        // Re-fetch status after IPC listeners are registered to close the race
        // window: if the gateway transitioned (e.g. starting → running) between
        // the initial fetch and the IPC listener setup, that event was lost.
        // A second fetch guarantees we pick up the latest state.
        try {
          const refreshed = await hostApiFetch<GatewayStatus>('/api/gateway/status');
          const current = get().status;
          if (refreshed.state !== current.state) {
            set({ status: refreshed });
          }
        } catch {
          // Best-effort; the IPC listener will eventually reconcile.
        }
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
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/start', {
        method: 'POST',
      });
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
      await hostApiFetch('/api/gateway/stop', { method: 'POST' });
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/gateway/restart', {
        method: 'POST',
      });
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
      const result = await hostApiFetch<GatewayHealth>('/api/gateway/health');
      set({ health: result });
      return result;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    const response = await invokeIpc<{
      success: boolean;
      result?: T;
      error?: string;
    }>('gateway:rpc', method, params, timeoutMs);
    if (!response.success) {
      throw new Error(response.error || `Gateway RPC failed: ${method}`);
    }
    return response.result as T;
  },

  setStatus: (status) => set({ status }),
  clearError: () => set({ lastError: null }),
}));
