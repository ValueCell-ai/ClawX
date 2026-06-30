/**
 * Gateway State Store
 * Uses typed Host API IPC for lifecycle/status and runtime RPC.
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { GatewayNotification, GatewayHealth, GatewayStatus } from '../types/gateway';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import { getCronSessionBaseKey, sessionKeysAreEquivalent } from './chat/cron-session-utils';

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

function stableGatewayEventFingerprint(value: unknown): string {
  let hash = 2166136261;
  let length = 0;

  const add = (part: string): void => {
    length += part.length;
    for (let i = 0; i < part.length; i += 1) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };

  const visit = (entry: unknown): void => {
    if (entry === undefined) {
      add('u:');
      return;
    }
    if (entry === null || typeof entry !== 'object') {
      add(`${typeof entry}:${JSON.stringify(entry)};`);
      return;
    }
    if (Array.isArray(entry)) {
      add('[');
      for (const item of entry) visit(item);
      add(']');
      return;
    }

    add('{');
    for (const [key, child] of Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
      add(`${JSON.stringify(key)}:`);
      visit(child);
    }
    add('}');
  };

  visit(value);
  return `${hash.toString(36)}:${length.toString(36)}`;
}

function buildGatewayEventDedupeKey(event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  const state = event.state != null ? String(event.state) : '';
  if (state === 'delta' && !seq) {
    return ['delta-nosq', runId, sessionKey, stableGatewayEventFingerprint(event.message ?? event)].join('|');
  }
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
  const { status } = useGatewayStore.getState();
  if (status.gatewayReady === false) return;

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

/** Bump sidebar ordering when any session receives gateway traffic (e.g. Feishu DM). */
function touchSessionActivity(sessionKey: string | null | undefined, activityMs = Date.now()): void {
  if (!sessionKey) return;
  // Cron runs stream under the run-scoped key; the sidebar only carries the
  // base cron entry, so normalize before bumping activity.
  const activityKey = getCronSessionBaseKey(sessionKey);
  import('./chat')
    .then(({ useChatStore }) => {
      useChatStore.setState((state) => ({
        sessionLastActivity: {
          ...state.sessionLastActivity,
          [activityKey]: Math.max(state.sessionLastActivity[activityKey] ?? 0, activityMs),
        },
      }));
    })
    .catch(() => {});
}

function getGatewayErrorMessage(payload: string | { message?: string }): string {
  if (typeof payload === 'string') return payload || 'Gateway error';
  return payload.message || 'Gateway error';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function handleGatewayNotification(notification: GatewayNotification | undefined): void {
  const payload = notification;
  if (!payload || payload.method === 'agent') {
    return;
  }

  const p = asRecord(payload.params);
  const data = asRecord(p.data);
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

  if (phase === 'run.started' || phase === 'run.ended') {
    const sessionKey = typeof (p.sessionKey ?? data.sessionKey) === 'string'
      ? String(p.sessionKey ?? data.sessionKey)
      : undefined;
    touchSessionActivity(sessionKey);
  }
}

function handleChatRuntimeEvent(event: ChatRuntimeEvent): void {
  const resolvedSessionKey = event.sessionKey ?? null;
  if (resolvedSessionKey) {
    touchSessionActivity(resolvedSessionKey, typeof event.ts === 'number' ? event.ts : Date.now());
  }

  import('./chat')
    .then(({ useChatStore, syncCachedSessionRunIdle }) => {
      const state = useChatStore.getState();
      state.handleRuntimeEvent(event);

      // Cron runs stream under the run-scoped key; treat it as the equivalent
      // base cron session the user is viewing instead of an unknown session.
      const matchesCurrentSession = resolvedSessionKey != null
        && sessionKeysAreEquivalent(resolvedSessionKey, state.currentSessionKey);
      const matchesActiveRun = state.activeRunId != null && event.runId === state.activeRunId;
      const isKnownSession = resolvedSessionKey != null && state.sessions.some(
        (session) => sessionKeysAreEquivalent(session.key, resolvedSessionKey),
      );
      const shouldRefreshSessions = resolvedSessionKey != null
        && !matchesCurrentSession
        && !isKnownSession;

      if (event.type === 'run.started') {
        if (shouldRefreshSessions) {
          maybeLoadSessions(state, true);
        }
        // Surface the freshly-written cron trigger message so the Execution
        // Graph has a run segment to anchor its live steps to.
        if (matchesCurrentSession) {
          maybeLoadHistory(state, true);
        }
        return;
      }

      if (event.type !== 'run.ended') {
        return;
      }

      if (shouldRefreshSessions) {
        maybeLoadSessions(state, true);
      }

      if (matchesCurrentSession || matchesActiveRun) {
        maybeLoadHistory(state, true);
      }
      if (resolvedSessionKey && !matchesCurrentSession) {
        syncCachedSessionRunIdle(resolvedSessionKey);
      }
    })
    .catch(() => {});
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
        const status = await hostApi.gateway.status();
        set({ status, isInitialized: true });

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(hostEvents.onGatewayStatus((payload) => {
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
          unsubscribers.push(hostEvents.onGatewayError((payload) => {
            set({ lastError: getGatewayErrorMessage(payload) });
          }));
          unsubscribers.push(hostEvents.onGatewayNotification(
            (payload) => {
              handleGatewayNotification(payload);
            },
          ));
          unsubscribers.push(hostEvents.onGatewayHealth((payload) => {
            const current = get().health;
            set({ health: { ...(current ?? { ok: true }), ok: true, openclawHealth: payload } });
          }));
          unsubscribers.push(hostEvents.onGatewayPresence((payload) => {
            const current = get().health;
            set({ health: { ...(current ?? { ok: true }), presence: payload } });
          }));
          unsubscribers.push(hostEvents.onGatewayChatMessage((payload) => {
            handleGatewayChatMessage(payload);
          }));
          unsubscribers.push(hostEvents.onChatRuntimeEvent((payload) => {
            handleChatRuntimeEvent(payload);
          }));
          unsubscribers.push(hostEvents.onGatewayChannelStatus(
            (update) => {
              import('./channels')
                .then(({ useChannelsStore }) => {
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
          // This catches any future one-off event delivery failures without adding
          // a constant polling load (single lightweight Host API status call per interval).
          // Clear any previous timer first to avoid leaks during HMR reloads.
          if (gatewayReconcileTimer !== null) {
            clearInterval(gatewayReconcileTimer);
          }
          gatewayReconcileTimer = setInterval(() => {
            hostApi.gateway.status()
              .then((latest) => {
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
          const refreshed = await hostApi.gateway.status();
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
      const result = await hostApi.gateway.start();
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
      await hostApi.gateway.stop();
      set({ status: { ...get().status, state: 'stopped' }, lastError: null });
    } catch (error) {
      console.error('Failed to stop Gateway:', error);
      set({ lastError: String(error) });
    }
  },

  restart: async () => {
    try {
      set({ status: { ...get().status, state: 'starting' }, lastError: null });
      const result = await hostApi.gateway.restart();
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
      const result = await hostApi.gateway.health();
      set({ health: result });
      return result;
    } catch (error) {
      const health: GatewayHealth = { ok: false, error: String(error) };
      set({ health });
      return health;
    }
  },

  rpc: async <T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> => {
    return await hostApi.gateway.rpc<T>(method, params, timeoutMs);
  },

  setStatus: (status) => set({ status }),
  clearError: () => set({ lastError: null }),
}));
