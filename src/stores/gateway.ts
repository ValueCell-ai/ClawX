/**
 * Gateway State Store
 * Uses typed Host API IPC for lifecycle/status and runtime RPC.
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { GatewayNotification, GatewayHealth, GatewayStatus } from '../types/gateway';
import type { GatewaySessionsChangedPayload } from './chat/session-catalog';

let gatewayInitPromise: Promise<void> | null = null;
let gatewayEventUnsubscribers: Array<() => void> | null = null;
let gatewayReconcileTimer: ReturnType<typeof setInterval> | null = null;
let cronRepairTriggeredThisSession = false;
let lastSynchronizedRuntimeIdentity: string | null = null;
let gatewaySessionGeneration = 0;

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

function getGatewayErrorMessage(payload: string | { message?: string }): string {
  if (typeof payload === 'string') return payload || 'Gateway error';
  return payload.message || 'Gateway error';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getGatewayRuntimeIdentity(status: GatewayStatus): string {
  return `${status.pid ?? 'none'}:${status.connectedAt ?? 'none'}:${status.port}`;
}

function synchronizeGatewaySessionCatalog(status: GatewayStatus): void {
  if (status.state !== 'running' || status.gatewayReady === false) {
    lastSynchronizedRuntimeIdentity = null;
    return;
  }

  const identity = getGatewayRuntimeIdentity(status);
  if (identity === lastSynchronizedRuntimeIdentity) return;
  lastSynchronizedRuntimeIdentity = identity;
  gatewaySessionGeneration += 1;
  const generation = gatewaySessionGeneration;

  void (async () => {
    const chatModulePromise = import('./chat');
    try {
      const { synchronizeGatewaySessionGeneration } = await chatModulePromise;
      synchronizeGatewaySessionGeneration(generation);
    } catch {
      // Hydration below reports import failures without blocking subscription.
    }

    try {
      await useGatewayStore.getState().rpc('sessions.subscribe', {});
    } catch (error) {
      console.warn('Failed to subscribe to Gateway session changes:', error);
    } finally {
      try {
        const { useChatStore } = await chatModulePromise;
        await useChatStore.getState().loadSessions({
          force: true,
          gatewayGeneration: generation,
        });
      } catch (error) {
        console.warn('Failed to hydrate Gateway session catalog:', error);
      }
    }
  })();
}

function handleGatewayNotification(notification: GatewayNotification | undefined): void {
  const payload = notification;
  if (!payload || payload.method === 'agent') {
    return;
  }

  if (payload.method === 'sessions.changed') {
    const changed = asRecord(payload.params) as GatewaySessionsChangedPayload;
    import('./chat')
      .then(({ useChatStore }) => {
        useChatStore.getState().handleSessionsChanged(changed);
      })
      .catch(() => {});
    return;
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
        const status = await hostApi.gateway.status();
        set({ status, isInitialized: true });
        synchronizeGatewaySessionCatalog(status);

        if (!gatewayEventUnsubscribers) {
          const unsubscribers: Array<() => void> = [];
          unsubscribers.push(hostEvents.onGatewayStatus((payload) => {
            set({ status: payload });
            synchronizeGatewaySessionCatalog(payload);

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
                const stateChanged = latest.state !== current.state;
                const runtimeChanged = getGatewayRuntimeIdentity(latest) !== getGatewayRuntimeIdentity(current);
                const readinessChanged = latest.gatewayReady !== current.gatewayReady;
                if (stateChanged) {
                  console.info(
                    `[gateway-store] reconciled stale state: ${current.state} → ${latest.state}`,
                  );
                }
                if (stateChanged || runtimeChanged || readinessChanged) {
                  set({ status: latest });
                }
                synchronizeGatewaySessionCatalog(latest);
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
          synchronizeGatewaySessionCatalog(refreshed);
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
