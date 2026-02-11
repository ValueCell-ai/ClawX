/**
 * Update State Store
 * Manages application update state
 */
import { create } from 'zustand';
import { useSettingsStore } from './settings';

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
    // Single source of truth: listen only to update:status-changed
    // (sent by AppUpdater.updateStatus() in the main process)
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

    set({ isInitialized: true });

    // Apply persisted settings from the settings store
    const { autoCheckUpdate, autoDownloadUpdate } = useSettingsStore.getState();

    // Sync auto-download preference to the main process
    if (autoDownloadUpdate) {
      window.electron.ipcRenderer.invoke('update:setAutoDownload', true).catch(() => {});
    }

    // Auto-check for updates on startup (respects user toggle)
    if (autoCheckUpdate) {
      setTimeout(() => {
        get().checkForUpdates().catch(() => {});
      }, 10000);
    }
  },

  checkForUpdates: async () => {
    set({ status: 'checking', error: null });
    
    try {
      const result = await Promise.race([
        window.electron.ipcRenderer.invoke('update:check'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Update check timed out')), 30000))
      ]) as {
        success: boolean;
        error?: string;
        status?: {
          status: UpdateStatus;
          info?: UpdateInfo;
          progress?: ProgressInfo;
          error?: string;
        };
      };
      
      if (result.status) {
        set({
          status: result.status.status,
          updateInfo: result.status.info || null,
          progress: result.status.progress || null,
          error: result.status.error || null,
        });
      } else if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to check for updates' });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    } finally {
      // In dev mode autoUpdater skips without emitting events, so the
      // status may still be 'checking' or even 'idle'. Catch both.
      const currentStatus = get().status;
      if (currentStatus === 'checking' || currentStatus === 'idle') {
        set({ status: 'error', error: 'Update check completed without a result. This usually means the app is running in dev mode.' });
      }
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
