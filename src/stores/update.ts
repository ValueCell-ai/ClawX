/**
 * Update State Store
 * Manages application update state
 */
import { create } from 'zustand';

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
}

export interface ProgressInfo {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: ProgressInfo | null;
  error: string | null;
  isInitialized: boolean;

  // Actions
  init: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  setChannel: (channel: 'stable' | 'beta' | 'dev') => Promise<void>;
  setAutoDownload: (enable: boolean) => Promise<void>;
  clearError: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  currentVersion: '0.0.0',
  updateInfo: null,
  progress: null,
  error: null,
  isInitialized: false,

  init: async () => {
    if (get().isInitialized) return;

    // Get current version
    try {
      const version = await window.electron.ipcRenderer.invoke('update:version');
      set({ currentVersion: version as string });
    } catch (error) {
      console.error('Failed to get version:', error);
    }

    // Get current status
    try {
      const status = await window.electron.ipcRenderer.invoke('update:status') as {
        status: UpdateStatus;
        info?: UpdateInfo;
        progress?: ProgressInfo;
        error?: string;
      };
      set({
        status: status.status,
        updateInfo: status.info || null,
        progress: status.progress || null,
        error: status.error || null,
      });
    } catch (error) {
      console.error('Failed to get update status:', error);
    }

    // Listen for update events
    window.electron.ipcRenderer.on('update:status-changed', (data) => {
      const status = data as {
        status: UpdateStatus;
        info?: UpdateInfo;
        progress?: ProgressInfo;
        error?: string;
      };
      set({
        status: status.status,
        updateInfo: status.info || null,
        progress: status.progress || null,
        error: status.error || null,
      });
    });

    window.electron.ipcRenderer.on('update:checking', () => {
      set({ status: 'checking', error: null });
    });

    window.electron.ipcRenderer.on('update:available', (info) => {
      set({ status: 'available', updateInfo: info as UpdateInfo });
    });

    window.electron.ipcRenderer.on('update:not-available', () => {
      set({ status: 'not-available' });
    });

    window.electron.ipcRenderer.on('update:progress', (progress) => {
      set({ status: 'downloading', progress: progress as ProgressInfo });
    });

    window.electron.ipcRenderer.on('update:downloaded', (info) => {
      set({ status: 'downloaded', updateInfo: info as UpdateInfo, progress: null });
    });

    window.electron.ipcRenderer.on('update:error', (error) => {
      set({ status: 'error', error: error as string, progress: null });
    });

    set({ isInitialized: true });
  },

  checkForUpdates: async () => {
    set({ status: 'checking', error: null });
    
    try {
      const result = await Promise.race([
        window.electron.ipcRenderer.invoke('update:check'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Update check timed out')), 30000))
      ]) as {
        success: boolean;
        info?: UpdateInfo;
        error?: string;
      };
      
      if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to check for updates' });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  downloadUpdate: async () => {
    set({ status: 'downloading', error: null });
    
    try {
      const result = await window.electron.ipcRenderer.invoke('update:download') as {
        success: boolean;
        error?: string;
      };
      
      if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to download update' });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  installUpdate: () => {
    window.electron.ipcRenderer.invoke('update:install');
  },

  setChannel: async (channel) => {
    try {
      await window.electron.ipcRenderer.invoke('update:setChannel', channel);
    } catch (error) {
      console.error('Failed to set update channel:', error);
    }
  },

  setAutoDownload: async (enable) => {
    try {
      await window.electron.ipcRenderer.invoke('update:setAutoDownload', enable);
    } catch (error) {
      console.error('Failed to set auto-download:', error);
    }
  },

  clearError: () => set({ error: null, status: 'idle' }),
}));
