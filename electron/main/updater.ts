/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 *
 * Update providers are configured in electron-builder.yml (OSS primary, GitHub fallback).
 * For prerelease channels (alpha, beta), the feed URL is overridden at runtime
 * to point at the channel-specific OSS directory (e.g. /alpha/, /beta/).
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { autoUpdater as nativeSquirrelUpdater } from 'electron';
import { BrowserWindow, app, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

/** Base CDN URL (without trailing channel path) */
const OSS_BASE_URL = 'https://oss.intelli-spectrum.com';

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

/**
 * Detect the update channel from a semver version string.
 * e.g. "0.1.8-alpha.0" → "alpha", "1.0.0-beta.1" → "beta", "1.0.0" → "latest"
 */
function detectChannel(version: string): string {
  const match = version.match(/-([a-zA-Z]+)/);
  return match ? match[1] : 'latest';
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private autoInstallTimer: NodeJS.Timeout | null = null;
  private autoInstallCountdown = 0;

  /**
   * Tracks whether Squirrel.Mac has finished staging the update.
   * On macOS, electron-updater fires its own `update-downloaded` event early
   * (before Squirrel finishes). We listen to Electron's native autoUpdater
   * `update-downloaded` event to know when Squirrel is truly ready.
   */
  private nativeSquirrelReady = false;

  /** Fallback timer for Squirrel staging; stored so it can be cancelled. */
  private squirrelFallbackTimer: NodeJS.Timeout | null = null;

  /** Set when the user explicitly cancels auto-install to prevent fallback restart. */
  private autoInstallCancelled = false;

  /** Delay (in seconds) before auto-installing a downloaded update. */
  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  /**
   * Squirrel.Mac staging (localhost download + zip extraction) can take 3–5 min
   * for large apps. Allow 6 min before falling back.
   */
  private static readonly SQUIRREL_STAGING_TIMEOUT_MS = 6 * 60_000;

  /**
   * Safety timeout for quitAndInstall() on macOS when Squirrel hasn't finished
   * staging. Generous enough for a full staging cycle.
   */
  private static readonly QUIT_SAFETY_TIMEOUT_MS = 6 * 60_000;

  constructor() {
    super();
    
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    // Must be true on macOS so that MacUpdater.updateDownloaded() triggers
    // nativeUpdater.checkForUpdates() during the download phase, which lets
    // Squirrel.Mac pre-stage the update.  When false, the Squirrel download
    // is deferred entirely to quitAndInstall() time, where it races against
    // any safety timeout and often loses — resulting in the app quitting
    // without installing the update.
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Use logger
    autoUpdater.logger = {
      info: (msg: string) => console.log('[Updater]', msg),
      warn: (msg: string) => console.warn('[Updater]', msg),
      error: (msg: string) => console.error('[Updater]', msg),
      debug: (msg: string) => console.debug('[Updater]', msg),
    };

    // Override feed URL for prerelease channels so that
    // alpha -> /alpha/alpha-mac.yml, beta -> /beta/beta-mac.yml, etc.
    const version = app.getVersion();
    const channel = detectChannel(version);
    const feedUrl = `${OSS_BASE_URL}/${channel}`;

    console.log(`[Updater] Version: ${version}, channel: ${channel}, feedUrl: ${feedUrl}`);

    // Set channel so electron-updater requests the correct yml filename.
    // e.g. channel "alpha" → requests alpha-mac.yml, channel "latest" → requests latest-mac.yml
    autoUpdater.channel = channel;

    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
      useMultipleRangeRequest: false,
    });

    // Track when Squirrel.Mac has finished staging the update.
    // This is separate from electron-updater's update-downloaded event.
    if (process.platform === 'darwin') {
      nativeSquirrelUpdater.on('update-downloaded', () => {
        this.nativeSquirrelReady = true;
        logger.info('[Updater] Squirrel.Mac has finished staging the update');
      });
      nativeSquirrelUpdater.on('error', (err) => {
        logger.warn('[Updater] Squirrel.Mac error:', err);
      });
    }

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

      if (autoUpdater.autoDownload) {
        if (process.platform === 'darwin' && !this.nativeSquirrelReady) {
          this.waitForSquirrelThenAutoInstall();
        } else {
          this.startAutoInstallCountdown();
        }
      }
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
   * Check for updates.
   * electron-updater automatically tries providers defined in electron-builder.yml in order.
   *
   * In dev mode (not packed), autoUpdater.checkForUpdates() silently returns
   * null without emitting any events, so we must detect this and force a
   * final status so the UI never gets stuck in 'checking'.
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      const result = await autoUpdater.checkForUpdates();

      // In dev mode (app not packaged), autoUpdater silently returns null
      // without emitting ANY events (not even checking-for-update).
      // Detect this and force an error so the UI never stays silent.
      if (result == null) {
        this.updateStatus({
          status: 'error',
          error: 'Update check skipped (dev mode – app is not packaged)',
        });
        return null;
      }

      // Safety net: if events somehow didn't fire, force a final state.
      if (this.status.status === 'checking' || this.status.status === 'idle') {
        this.updateStatus({ status: 'not-available' });
      }

      return result.updateInfo || null;
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
   * Install update and restart app.
   *
   * On macOS, electron-updater's MacUpdater.quitAndInstall() delegates to
   * Squirrel.Mac. If Squirrel hasn't finished staging the update yet, the
   * call silently defers (registers a one-shot listener) and returns
   * immediately — leaving the app running with no visible feedback.
   *
   * When Squirrel is already ready the quit fires synchronously and no safety
   * net is needed. When it's still pending we add a generous safety timeout
   * so the app doesn't hang indefinitely; autoInstallOnAppQuit=true ensures
   * Squirrel applies the staged update on the next launch even if we
   * force-quit.
   */
  quitAndInstall(): void {
    const squirrelStatus = this.nativeSquirrelReady ? 'ready' : 'pending';
    logger.info(`[Updater] quitAndInstall called (squirrel=${squirrelStatus})`);

    autoUpdater.quitAndInstall();

    if (process.platform === 'darwin' && !this.nativeSquirrelReady) {
      const safetyTimer = setTimeout(() => {
        logger.warn('[Updater] macOS safety timeout reached – forcing app.quit()');
        app.quit();
      }, AppUpdater.QUIT_SAFETY_TIMEOUT_MS);
      safetyTimer.unref();
    }
  }

  /**
   * Start a countdown that auto-installs the downloaded update.
   * Sends `update:auto-install-countdown` events to the renderer each second.
   */
  private startAutoInstallCountdown(): void {
    this.clearAutoInstallTimer();
    this.autoInstallCountdown = AppUpdater.AUTO_INSTALL_DELAY_SECONDS;
    this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

    this.autoInstallTimer = setInterval(() => {
      this.autoInstallCountdown--;
      this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

      if (this.autoInstallCountdown <= 0) {
        this.clearAutoInstallTimer();
        this.quitAndInstall();
      }
    }, 1000);
  }

  /**
   * Wait for Squirrel.Mac to finish staging before starting auto-install.
   * Falls back after SQUIRREL_STAGING_TIMEOUT_MS if Squirrel never signals.
   */
  private waitForSquirrelThenAutoInstall(): void {
    logger.info('[Updater] Waiting for Squirrel.Mac to finish staging before auto-install...');
    this.autoInstallCancelled = false;

    const onReady = () => {
      this.clearSquirrelFallbackTimer();
      if (this.autoInstallCancelled) return;
      logger.info('[Updater] Squirrel.Mac ready – starting auto-install countdown');
      this.startAutoInstallCountdown();
    };

    nativeSquirrelUpdater.once('update-downloaded', onReady);

    this.squirrelFallbackTimer = setTimeout(() => {
      this.squirrelFallbackTimer = null;
      nativeSquirrelUpdater.removeListener('update-downloaded', onReady);
      if (this.autoInstallCancelled) return;
      if (this.autoInstallTimer === null) {
        logger.warn('[Updater] Squirrel.Mac staging timeout – starting auto-install countdown anyway');
        this.startAutoInstallCountdown();
      }
    }, AppUpdater.SQUIRREL_STAGING_TIMEOUT_MS);
  }

  /**
   * Cancel a running auto-install countdown (and any pending Squirrel wait).
   */
  cancelAutoInstall(): void {
    this.autoInstallCancelled = true;
    this.clearSquirrelFallbackTimer();
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
    }
  }

  private clearSquirrelFallbackTimer(): void {
    if (this.squirrelFallbackTimer) {
      clearTimeout(this.squirrelFallbackTimer);
      this.squirrelFallbackTimer = null;
    }
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

  // Check for updates – always return final status so the renderer
  // never gets stuck in 'checking' waiting for a push event.
  ipcMain.handle('update:check', async () => {
    try {
      await updater.checkForUpdates();
      return { success: true, status: updater.getStatus() };
    } catch (error) {
      return { success: false, error: String(error), status: updater.getStatus() };
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

  // Cancel pending auto-install countdown
  ipcMain.handle('update:cancelAutoInstall', () => {
    updater.cancelAutoInstall();
    return { success: true };
  });

}

// Export singleton instance
export const appUpdater = new AppUpdater();
