/**
 * Channels State Store
 * Manages messaging channel state
 */
import { create } from 'zustand';
import type { Channel, ChannelType } from '../types/channel';
import { invokeIpc } from '@/lib/api-client';
import { trackUiEvent, trackUiTiming } from '@/lib/telemetry';

interface AddChannelParams {
  type: ChannelType;
  name: string;
  token?: string;
}

interface ChannelsState {
  channels: Channel[];
  configuredTypes: string[];
  channelSnapshot: Channel[];
  configuredTypesSnapshot: string[];
  lastGatewayState: string | null;
  showGatewayWarning: boolean;
  loading: boolean;
  error: string | null;

  // Actions
  initRealtimeSync: () => () => void;
  fetchChannels: (options?: { probe?: boolean; silent?: boolean }) => Promise<void>;
  fetchConfiguredTypes: () => Promise<void>;
  syncGatewayViewState: (gatewayState: string) => void;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  connectChannel: (channelId: string) => Promise<void>;
  disconnectChannel: (channelId: string) => Promise<void>;
  requestQrCode: (channelType: ChannelType) => Promise<{ qrCode: string; sessionId: string }>;
  setChannels: (channels: Channel[]) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  clearError: () => void;
}

let gatewayChannelStatusUnsubscribe: (() => void) | null = null;
let gatewayChannelStatusListenerRefs = 0;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let warningTimer: ReturnType<typeof setTimeout> | null = null;

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  configuredTypes: [],
  channelSnapshot: [],
  configuredTypesSnapshot: [],
  lastGatewayState: null,
  showGatewayWarning: false,
  loading: false,
  error: null,

  initRealtimeSync: () => {
    gatewayChannelStatusListenerRefs += 1;
    if (!gatewayChannelStatusUnsubscribe) {
      const unsubscribe = window.electron.ipcRenderer.on('gateway:channel-status', () => {
        trackUiEvent('channels.realtime_status_event');
        if (refreshDebounceTimer) {
          clearTimeout(refreshDebounceTimer);
        }
        refreshDebounceTimer = setTimeout(() => {
          const state = get();
          const refreshStartedAt = Date.now();
          void state.fetchChannels({ probe: false, silent: true });
          void state.fetchConfiguredTypes();
          trackUiTiming('channels.realtime_refresh_enqueued', Date.now() - refreshStartedAt);
        }, 300);
      });
      gatewayChannelStatusUnsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    return () => {
      gatewayChannelStatusListenerRefs = Math.max(0, gatewayChannelStatusListenerRefs - 1);
      if (gatewayChannelStatusListenerRefs === 0) {
        if (refreshDebounceTimer) {
          clearTimeout(refreshDebounceTimer);
          refreshDebounceTimer = null;
        }
        gatewayChannelStatusUnsubscribe?.();
        gatewayChannelStatusUnsubscribe = null;
      }
    };
  },

  fetchChannels: async (options) => {
    const startedAt = Date.now();
    const probe = options?.probe ?? false;
    const silent = options?.silent ?? false;
    if (!silent) {
      set({ loading: true, error: null });
    }
    try {
      const result = await invokeIpc(
        'gateway:rpc',
        'channels.status',
        { probe }
      ) as {
        success: boolean;
        result?: {
          channelOrder?: string[];
          channels?: Record<string, unknown>;
          channelAccounts?: Record<string, Array<{
            accountId?: string;
            configured?: boolean;
            connected?: boolean;
            running?: boolean;
            lastError?: string;
            name?: string;
            linked?: boolean;
            lastConnectedAt?: number | null;
            lastInboundAt?: number | null;
            lastOutboundAt?: number | null;
          }>>;
          channelDefaultAccountId?: Record<string, string>;
        };
        error?: string;
      };

      if (result.success && result.result) {
        const data = result.result;
        const channels: Channel[] = [];

        // Parse the complex channels.status response into simple Channel objects
        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        for (const channelId of channelOrder) {
          const summary = (data.channels as Record<string, unknown> | undefined)?.[channelId] as Record<string, unknown> | undefined;
          const configured =
            typeof summary?.configured === 'boolean'
              ? summary.configured
              : typeof (summary as { running?: boolean })?.running === 'boolean'
                ? true
                : false;
          if (!configured) continue;

          const accounts = data.channelAccounts?.[channelId] || [];
          const defaultAccountId = data.channelDefaultAccountId?.[channelId];
          const primaryAccount =
            (defaultAccountId ? accounts.find((a) => a.accountId === defaultAccountId) : undefined) ||
            accounts.find((a) => a.connected === true || a.linked === true) ||
            accounts[0];

          // Map gateway status to our status format
          let status: Channel['status'] = 'disconnected';
          const now = Date.now();
          const RECENT_MS = 10 * 60 * 1000;
          const hasRecentActivity = (a: { lastInboundAt?: number | null; lastOutboundAt?: number | null; lastConnectedAt?: number | null }) =>
            (typeof a.lastInboundAt === 'number' && now - a.lastInboundAt < RECENT_MS) ||
            (typeof a.lastOutboundAt === 'number' && now - a.lastOutboundAt < RECENT_MS) ||
            (typeof a.lastConnectedAt === 'number' && now - a.lastConnectedAt < RECENT_MS);
          const anyConnected = accounts.some((a) => a.connected === true || a.linked === true || hasRecentActivity(a));
          const anyRunning = accounts.some((a) => a.running === true);
          const summaryError =
            typeof (summary as { error?: string })?.error === 'string'
              ? (summary as { error?: string }).error
              : typeof (summary as { lastError?: string })?.lastError === 'string'
                ? (summary as { lastError?: string }).lastError
                : undefined;
          const anyError =
            accounts.some((a) => typeof a.lastError === 'string' && a.lastError) || Boolean(summaryError);

          if (anyConnected) {
            status = 'connected';
          } else if (anyRunning && !anyError) {
            status = 'connected';
          } else if (anyError) {
            status = 'error';
          } else if (anyRunning) {
            status = 'connecting';
          }

          channels.push({
            id: `${channelId}-${primaryAccount?.accountId || 'default'}`,
            type: channelId as ChannelType,
            name: primaryAccount?.name || channelId,
            status,
            accountId: primaryAccount?.accountId,
            error:
              (typeof primaryAccount?.lastError === 'string' ? primaryAccount.lastError : undefined) ||
              (typeof summaryError === 'string' ? summaryError : undefined),
          });
        }

        set((state) => ({ channels, loading: silent ? state.loading : false }));
        trackUiTiming('channels.fetch', Date.now() - startedAt, {
          source: 'gateway',
          probe,
          silent,
          count: channels.length,
        });
      } else {
        // Gateway not available - try to show channels from local config
        set((state) => ({ channels: [], loading: silent ? state.loading : false }));
        trackUiTiming('channels.fetch', Date.now() - startedAt, {
          source: 'gateway-unavailable',
          probe,
          silent,
          count: 0,
        });
      }
    } catch (error) {
      // Gateway not connected, show empty
      set((state) => ({ channels: [], loading: silent ? state.loading : false }));
      trackUiTiming('channels.fetch_error', Date.now() - startedAt, {
        probe,
        silent,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  fetchConfiguredTypes: async () => {
    const startedAt = Date.now();
    try {
      const result = await invokeIpc('channel:listConfigured') as {
        success: boolean;
        channels?: string[];
      };

      if (result.success && Array.isArray(result.channels)) {
        set({ configuredTypes: result.channels });
        trackUiTiming('channels.fetch_configured_types', Date.now() - startedAt, {
          count: result.channels.length,
          source: 'ipc',
        });
      } else {
        set({ configuredTypes: [] });
        trackUiTiming('channels.fetch_configured_types', Date.now() - startedAt, {
          count: 0,
          source: 'ipc-empty',
        });
      }
    } catch (error) {
      set({ configuredTypes: [] });
      trackUiTiming('channels.fetch_configured_types_error', Date.now() - startedAt, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  syncGatewayViewState: (gatewayState) => {
    const previousState = get().lastGatewayState;
    const justReconnected = gatewayState === 'running' && previousState !== 'running';

    if (gatewayState === 'running') {
      const { channels, configuredTypes } = get();
      set({
        channelSnapshot: channels,
        configuredTypesSnapshot: configuredTypes,
        lastGatewayState: gatewayState,
      });
    } else {
      set({ lastGatewayState: gatewayState });
    }

    if (warningTimer) {
      clearTimeout(warningTimer);
      warningTimer = null;
    }
    const shouldWarn = gatewayState === 'stopped' || gatewayState === 'error';
    warningTimer = setTimeout(() => {
      set({ showGatewayWarning: shouldWarn });
    }, shouldWarn ? 1800 : 0);

    if (justReconnected) {
      void get().fetchChannels({ probe: false, silent: true });
      void get().fetchConfiguredTypes();
    }
  },

  addChannel: async (params) => {
    const startedAt = Date.now();
    try {
      const result = await invokeIpc(
        'gateway:rpc',
        'channels.add',
        params
      ) as { success: boolean; result?: Channel; error?: string };

      if (result.success && result.result) {
        set((state) => ({
          channels: [...state.channels, result.result!],
        }));
        trackUiTiming('channels.add', Date.now() - startedAt, {
          type: params.type,
          source: 'gateway',
          success: true,
        });
        return result.result;
      } else {
        // If gateway is not available, create a local channel for now
        const newChannel: Channel = {
          id: `local-${Date.now()}`,
          type: params.type,
          name: params.name,
          status: 'disconnected',
        };
        set((state) => ({
          channels: [...state.channels, newChannel],
        }));
        trackUiTiming('channels.add', Date.now() - startedAt, {
          type: params.type,
          source: 'local-fallback',
          success: false,
        });
        return newChannel;
      }
    } catch (error) {
      // Create local channel if gateway unavailable
      const newChannel: Channel = {
        id: `local-${Date.now()}`,
        type: params.type,
        name: params.name,
        status: 'disconnected',
      };
      set((state) => ({
        channels: [...state.channels, newChannel],
      }));
      trackUiTiming('channels.add_error', Date.now() - startedAt, {
        type: params.type,
        source: 'local-fallback',
        message: error instanceof Error ? error.message : String(error),
      });
      return newChannel;
    }
  },

  deleteChannel: async (channelId) => {
    const startedAt = Date.now();
    // Extract channel type from the channelId (format: "channelType-accountId")
    const channelType = channelId.split('-')[0];

    try {
      // Delete the channel configuration from openclaw.json
      await invokeIpc('channel:deleteConfig', channelType);
    } catch (error) {
      console.error('Failed to delete channel config:', error);
    }

    try {
      await invokeIpc(
        'gateway:rpc',
        'channels.delete',
        { channelId: channelType }
      );
    } catch (error) {
      // Continue with local deletion even if gateway fails
      console.error('Failed to delete channel from gateway:', error);
    }

    // Remove from local state
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== channelId),
    }));
    trackUiTiming('channels.delete', Date.now() - startedAt, {
      channelType,
    });
  },

  connectChannel: async (channelId) => {
    const startedAt = Date.now();
    const { updateChannel } = get();
    updateChannel(channelId, { status: 'connecting', error: undefined });

    try {
      const result = await invokeIpc(
        'gateway:rpc',
        'channels.connect',
        { channelId }
      ) as { success: boolean; error?: string };

      if (result.success) {
        updateChannel(channelId, { status: 'connected' });
        trackUiTiming('channels.connect', Date.now() - startedAt, {
          channelId,
          success: true,
        });
      } else {
        updateChannel(channelId, { status: 'error', error: result.error });
        trackUiTiming('channels.connect', Date.now() - startedAt, {
          channelId,
          success: false,
          message: result.error || 'unknown',
        });
      }
    } catch (error) {
      updateChannel(channelId, { status: 'error', error: String(error) });
      trackUiTiming('channels.connect_error', Date.now() - startedAt, {
        channelId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  disconnectChannel: async (channelId) => {
    const startedAt = Date.now();
    const { updateChannel } = get();

    try {
      await invokeIpc(
        'gateway:rpc',
        'channels.disconnect',
        { channelId }
      );
    } catch (error) {
      console.error('Failed to disconnect channel:', error);
    }

    updateChannel(channelId, { status: 'disconnected', error: undefined });
    trackUiTiming('channels.disconnect', Date.now() - startedAt, {
      channelId,
    });
  },

  requestQrCode: async (channelType) => {
    const startedAt = Date.now();
    const result = await invokeIpc(
      'gateway:rpc',
      'channels.requestQr',
      { type: channelType }
    ) as { success: boolean; result?: { qrCode: string; sessionId: string }; error?: string };

    if (result.success && result.result) {
      trackUiTiming('channels.request_qr', Date.now() - startedAt, {
        channelType,
        success: true,
      });
      return result.result;
    }

    trackUiTiming('channels.request_qr', Date.now() - startedAt, {
      channelType,
      success: false,
      message: result.error || 'unknown',
    });
    throw new Error(result.error || 'Failed to request QR code');
  },

  setChannels: (channels) => set({ channels }),

  updateChannel: (channelId, updates) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...updates } : channel
      ),
    }));
  },

  clearError: () => set({ error: null }),
}));
