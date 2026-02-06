/**
 * Channels State Store
 * Manages messaging channel state
 */
import { create } from 'zustand';
import type { Channel, ChannelType } from '../types/channel';

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
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  loading: false,
  error: null,
  
  fetchChannels: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.status',
        { probe: false }
      ) as {
        success: boolean;
        result?: {
          channelOrder?: string[];
          channels?: Record<string, { configured?: boolean; connected?: boolean; status?: string; error?: string }>;
          channelAccounts?: Record<string, Array<{
            accountId?: string;
            configured?: boolean;
            connected?: boolean;
            status?: string;
            error?: string;
            label?: string;
          }>>;
        };
        error?: string;
      };

      if (result.success && result.result) {
        const data = result.result;
        const channels: Channel[] = [];

        // Parse the complex channels.status response into simple Channel objects
        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        for (const channelId of channelOrder) {
          const summary = data.channels?.[channelId];
          if (!summary?.configured) continue; // Skip unconfigured channels

          const accounts = data.channelAccounts?.[channelId] || [];
          const primaryAccount = accounts[0];

          // Map gateway status to our status format
          let status: Channel['status'] = 'disconnected';
          if (primaryAccount?.connected) {
            status = 'connected';
          } else if (primaryAccount?.status === 'connecting' || primaryAccount?.status === 'starting') {
            status = 'connecting';
          } else if (primaryAccount?.error || summary.error) {
            status = 'error';
          }

          channels.push({
            id: `${channelId}-${primaryAccount?.accountId || 'default'}`,
            type: channelId as ChannelType,
            name: primaryAccount?.label || channelId,
            status,
            accountId: primaryAccount?.accountId,
            error: primaryAccount?.error || summary.error,
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
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.add',
        params
      ) as { success: boolean; result?: Channel; error?: string };
      
      if (result.success && result.result) {
        set((state) => ({
          channels: [...state.channels, result.result!],
        }));
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
    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.delete',
        { channelId }
      );
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
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.connect',
        { channelId }
      ) as { success: boolean; error?: string };
      
      if (result.success) {
        updateChannel(channelId, { status: 'connected' });
      } else {
        updateChannel(channelId, { status: 'error', error: result.error });
      }
    } catch (error) {
      updateChannel(channelId, { status: 'error', error: String(error) });
    }
  },
  
  disconnectChannel: async (channelId) => {
    const { updateChannel } = get();
    
    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.disconnect',
        { channelId }
      );
    } catch (error) {
      console.error('Failed to disconnect channel:', error);
    }
    
    updateChannel(channelId, { status: 'disconnected', error: undefined });
  },
  
  requestQrCode: async (channelType) => {
    const result = await window.electron.ipcRenderer.invoke(
      'gateway:rpc',
      'channels.requestQr',
      { type: channelType }
    ) as { success: boolean; result?: { qrCode: string; sessionId: string }; error?: string };
    
    if (result.success && result.result) {
      return result.result;
    }
    
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
