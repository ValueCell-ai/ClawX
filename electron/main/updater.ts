/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 *
 * Update providers are configured in electron-builder.yml (OSS primary, GitHub fallback).
 * electron-updater handles provider resolution automatically.
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { BrowserWindow, app, ipcMain } from 'electron';
import { EventEmitter } from 'events';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export interface UpdaterEvents {
  'status-changed': (status: UpdateStatus) => void;
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfo) => void;
  'update-not-available': (info: UpdateInfo) => void;
  'download-progress': (progress: ProgressInfo) => void;
  'update-downloaded': (event: UpdateDownloadedEvent) => void;
  'error': (error: Error) => void;
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };

  constructor() {
    super();
    
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Use logger
    autoUpdater.logger = {
      info: (msg: string) => console.log('[Updater]', msg),
      warn: (msg: string) => console.warn('[Updater]', msg),
      error: (msg: string) => console.error('[Updater]', msg),
      debug: (msg: string) => console.debug('[Updater]', msg),
    };

    this.setupListeners();
  }

  /**
   * Set the main window for sending update events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get current update status
   */
  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * Setup auto-updater event listeners
   */
  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking' });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateStatus({ status: 'available', info });
      this.emit('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateStatus({ status: 'not-available', info });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.updateStatus({ status: 'downloaded', info: event });
      this.emit('update-downloaded', event);
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateStatus({ status: 'error', error: error.message });
      this.emit('error', error);
    });
  }

  /**
   * Update status and notify renderer
   */
  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...newStatus };
    this.sendToRenderer('update:status-changed', this.status);
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates
   * electron-updater automatically tries providers defined in electron-builder.yml in order
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo || null;
    } catch (error) {
      console.error('[Updater] Check for updates failed:', error);
      this.updateStatus({ status: 'error', error: (error as Error).message || String(error) });
      throw error;
    }
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  /**
   * Install update and restart app
   */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  /**
   * Set update channel (stable, beta, dev)
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    autoUpdater.channel = channel;
  }

  /**
   * Set auto-download preference
   */
  setAutoDownload(enable: boolean): void {
    autoUpdater.autoDownload = enable;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return app.getVersion();
  }
}

/**
 * Register IPC handlers for update operations
 */
export function registerUpdateHandlers(
  updater: AppUpdater,
  mainWindow: BrowserWindow
): void {
  updater.setMainWindow(mainWindow);

  // Get current update status
  ipcMain.handle('update:status', () => {
    return updater.getStatus();
  });

  // Get current version
  ipcMain.handle('update:version', () => {
    return updater.getCurrentVersion();
  });

  // Check for updates
  ipcMain.handle('update:check', async () => {
    try {
      const info = await updater.checkForUpdates();
      return { success: true, info };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Download update
  ipcMain.handle('update:download', async () => {
    try {
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install update and restart
  ipcMain.handle('update:install', () => {
    updater.quitAndInstall();
    return { success: true };
  });

  // Set update channel
  ipcMain.handle('update:setChannel', (_, channel: 'stable' | 'beta' | 'dev') => {
    updater.setChannel(channel);
    return { success: true };
  });

  // Set auto-download preference
  ipcMain.handle('update:setAutoDownload', (_, enable: boolean) => {
    updater.setAutoDownload(enable);
    return { success: true };
  });

  // Forward update events to renderer
  updater.on('checking-for-update', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:checking');
    }
  });

  updater.on('update-available', (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', info);
    }
  });

  updater.on('update-not-available', (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:not-available', info);
    }
  });

  updater.on('download-progress', (progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', progress);
    }
  });

  updater.on('update-downloaded', (event) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', event);
    }
  });

  updater.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', error.message);
    }
  });
}

// Export singleton instance
export const appUpdater = new AppUpdater();
