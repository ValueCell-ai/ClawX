/**
 * Channels State Store
 * Manages messaging channel state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import {
  isChannelRuntimeConnected,
  pickChannelRuntimeStatus,
  type ChannelRuntimeAccountSnapshot,
} from '@/lib/channel-status';
import { useGatewayStore } from './gateway';
import { CHANNEL_NAMES, type Channel, type ChannelType } from '../types/channel';
import { toOpenClawChannelType, toUiChannelType } from '@/lib/channel-alias';

interface AddChannelParams {
  type: ChannelType;
  name: string;
  token?: string;
}

interface ChannelsState {
  channels: Channel[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchChannels: () => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  connectChannel: (channelId: string) => Promise<void>;
  disconnectChannel: (channelId: string) => Promise<void>;
  requestQrCode: (channelType: ChannelType) => Promise<{ qrCode: string; sessionId: string }>;
  setChannels: (channels: Channel[]) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  clearError: () => void;
  scheduleAutoReconnect: (channelId: string) => void;
  clearAutoReconnect: (channelId: string) => void;
}

const reconnectTimers = new Map<string, NodeJS.Timeout>();
const reconnectAttempts = new Map<string, number>();

function splitChannelId(channelId: string): { channelType: string; accountId?: string } {
  const separatorIndex = channelId.indexOf('-');
  if (separatorIndex === -1) {
    return { channelType: channelId };
  }
  return {
    channelType: channelId.slice(0, separatorIndex),
    accountId: channelId.slice(separatorIndex + 1),
  };
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  loading: false,
  error: null,

  fetchChannels: async () => {
    set({ loading: true, error: null });
    try {
      const data = await useGatewayStore.getState().rpc<{
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
            lastProbeAt?: number | null;
            probe?: {
              ok?: boolean;
            } | null;
          }>>;
          channelDefaultAccountId?: Record<string, string>;
      }>('channels.status', { probe: false });
      if (data) {
        const channels: Channel[] = [];

        // Parse the complex channels.status response into simple Channel objects
        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        for (const channelId of channelOrder) {
          const uiChannelId = toUiChannelType(channelId) as ChannelType;
          const gatewayChannelId = toOpenClawChannelType(channelId);
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
          const summarySignal = summary as { error?: string; lastError?: string } | undefined;
          const primaryAccount =
            (defaultAccountId ? accounts.find((a) => a.accountId === defaultAccountId) : undefined) ||
            accounts.find((a) => isChannelRuntimeConnected(a as ChannelRuntimeAccountSnapshot)) ||
            accounts[0];

          const status: Channel['status'] = pickChannelRuntimeStatus(accounts, summarySignal);
          const summaryError =
            typeof summarySignal?.error === 'string'
              ? summarySignal.error
              : typeof summarySignal?.lastError === 'string'
                ? summarySignal.lastError
                : undefined;

          channels.push({
            id: `${uiChannelId}-${primaryAccount?.accountId || 'default'}`,
            type: uiChannelId,
            name: primaryAccount?.name || CHANNEL_NAMES[uiChannelId] || uiChannelId,
            status,
            accountId: primaryAccount?.accountId,
            error:
              (typeof primaryAccount?.lastError === 'string' ? primaryAccount.lastError : undefined) ||
              (typeof summaryError === 'string' ? summaryError : undefined),
            metadata: {
              gatewayChannelId,
            },
          });
        }

        set({ channels, loading: false });
      } else {
        // Gateway not available - try to show channels from local config
        set({ channels: [], loading: false });
      }
    } catch {
      // Gateway not connected, show empty
      set({ channels: [], loading: false });
    }
  },

  addChannel: async (params) => {
    try {
      const result = await useGatewayStore.getState().rpc<Channel>('channels.add', params);

      if (result) {
        set((state) => ({
          channels: [...state.channels, result],
        }));
        return result;
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
        return newChannel;
      }
    } catch {
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
      return newChannel;
    }
  },

  deleteChannel: async (channelId) => {
    // Extract channel type from the channelId (format: "channelType-accountId")
    const { channelType } = splitChannelId(channelId);
    const gatewayChannelType = toOpenClawChannelType(channelType);

    try {
      // Delete the channel configuration from openclaw.json
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(channelType)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Failed to delete channel config:', error);
    }

    try {
      await useGatewayStore.getState().rpc('channels.delete', { channelId: gatewayChannelType });
    } catch (error) {
      // Continue with local deletion even if gateway fails
      console.error('Failed to delete channel from gateway:', error);
    }

    // Remove from local state
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== channelId),
    }));
  },

  connectChannel: async (channelId) => {
    const { updateChannel } = get();
    updateChannel(channelId, { status: 'connecting', error: undefined });

    try {
      const { channelType, accountId } = splitChannelId(channelId);
      await useGatewayStore.getState().rpc('channels.connect', {
        channelId: `${toOpenClawChannelType(channelType)}${accountId ? `-${accountId}` : ''}`,
      });
      updateChannel(channelId, { status: 'connected' });
    } catch (error) {
      updateChannel(channelId, { status: 'error', error: String(error) });
    }
  },

  disconnectChannel: async (channelId) => {
    const { updateChannel, clearAutoReconnect } = get();
    clearAutoReconnect(channelId);

    try {
      const { channelType, accountId } = splitChannelId(channelId);
      await useGatewayStore.getState().rpc('channels.disconnect', {
        channelId: `${toOpenClawChannelType(channelType)}${accountId ? `-${accountId}` : ''}`,
      });
    } catch (error) {
      console.error('Failed to disconnect channel:', error);
    }

    updateChannel(channelId, { status: 'disconnected', error: undefined });
  },

  requestQrCode: async (channelType) => {
    return await useGatewayStore.getState().rpc<{ qrCode: string; sessionId: string }>(
      'channels.requestQr',
      { type: toOpenClawChannelType(channelType) },
    );
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

  scheduleAutoReconnect: (channelId) => {
    if (reconnectTimers.has(channelId)) return;
    
    const attempts = reconnectAttempts.get(channelId) || 0;
    // Exponential backoff capped at 2 minutes
    const delay = Math.min(5000 * Math.pow(2, attempts), 120000);
    
    console.log(`[Watchdog] Scheduling auto-reconnect for ${channelId} in ${delay}ms (attempt ${attempts + 1})`);
    
    const timer = setTimeout(() => {
      reconnectTimers.delete(channelId);
      const state = get();
      const channel = state.channels.find((c) => c.id === channelId);
      
      if (channel && (channel.status === 'disconnected' || channel.status === 'error')) {
        reconnectAttempts.set(channelId, attempts + 1);
        console.log(`[Watchdog] Executing auto-reconnect for ${channelId} (attempt ${attempts + 1})`);
        state.connectChannel(channelId).catch(() => {});
      }
    }, delay);
    
    reconnectTimers.set(channelId, timer);
  },

  clearAutoReconnect: (channelId) => {
    const timer = reconnectTimers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      reconnectTimers.delete(channelId);
    }
    reconnectAttempts.delete(channelId);
  },
}));
