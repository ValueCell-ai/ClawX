/**
 * Update State Store
 * Manages application update state
 */
import { create } from 'zustand';
import { useSettingsStore } from './settings';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type {
  UpdateChannel,
  UpdateInfoSnapshot,
  UpdateProgressSnapshot,
  UpdateStatusSnapshot,
} from '@shared/host-api/contract';

export type UpdateInfo = UpdateInfoSnapshot;
export type ProgressInfo = UpdateProgressSnapshot;
export type UpdateStatus = UpdateStatusSnapshot['status'];

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: ProgressInfo | null;
  error: string | null;
  isInitialized: boolean;
  /** Seconds remaining before auto-install, or null if inactive. */
  autoInstallCountdown: number | null;

  // Actions
  init: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  cancelAutoInstall: () => Promise<void>;
  setChannel: (channel: UpdateChannel) => Promise<void>;
  setAutoDownload: (enable: boolean) => Promise<void>;
  clearError: () => void;
}

let updateInitPromise: Promise<void> | null = null;

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  currentVersion: '0.0.0',
  updateInfo: null,
  progress: null,
  error: null,
  isInitialized: false,
  autoInstallCountdown: null,

  init: async () => {
    if (get().isInitialized) return;
    if (updateInitPromise) return updateInitPromise;

    updateInitPromise = (async () => {
      // Get current version
      try {
        const version = await hostApi.updates.version();
        set({ currentVersion: version });
      } catch (error) {
        console.error('Failed to get version:', error);
      }

      // Get current status
      try {
        const status = await hostApi.updates.status();
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
      hostEvents.onUpdateStatusChanged((status) => {
        set({
          status: status.status,
          updateInfo: status.info || null,
          progress: status.progress || null,
          error: status.error || null,
        });
      });

      hostEvents.onUpdateAutoInstallCountdown(({ seconds, cancelled }) => {
        set({ autoInstallCountdown: cancelled ? null : seconds });
      });

      // New default is prompt-first: never auto-download/install unless the
      // user explicitly chooses Download from the notification or Settings.
      void hostApi.updates.setAutoDownload(false).catch(() => {});

      set({ isInitialized: true });

      // Auto-check for updates on startup (respects user toggle)
      const autoCheckUpdate = useSettingsStore.getState().autoCheckUpdate;
      if (autoCheckUpdate) {
        setTimeout(() => {
          get().checkForUpdates().catch(() => {});
        }, 10000);
      }
    })();

    try {
      await updateInitPromise;
    } finally {
      if (!get().isInitialized) {
        updateInitPromise = null;
      }
    }
  },

  checkForUpdates: async () => {
    set({ status: 'checking', error: null });
    
    try {
      const result = await Promise.race([
        hostApi.updates.check(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Update check timed out')), 30000))
      ]);
      
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
      const result = await hostApi.updates.download();
      
      if (!result.success) {
        set({ status: 'error', error: result.error || 'Failed to download update' });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },

  installUpdate: () => {
    void hostApi.updates.install();
  },

  cancelAutoInstall: async () => {
    try {
      await hostApi.updates.cancelAutoInstall();
    } catch (error) {
      console.error('Failed to cancel auto-install:', error);
    }
  },

  setChannel: async (channel) => {
    try {
      await hostApi.updates.setChannel(channel);
    } catch (error) {
      console.error('Failed to set update channel:', error);
    }
  },

  setAutoDownload: async (enable) => {
    try {
      // Compatibility shim for older UI paths: the updater is now prompt-first,
      // so we keep electron-updater.autoDownload disabled even if a stale
      // persisted setting says otherwise.
      await hostApi.updates.setAutoDownload(false);
      if (enable) {
        console.info('[Update] Auto-download preference ignored; update prompts are shown instead.');
      }
    } catch (error) {
      console.error('Failed to set auto-download:', error);
    }
  },

  clearError: () => set({ error: null, status: 'idle' }),
}));
