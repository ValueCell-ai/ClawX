/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater.
 *
 * Region-aware provider selection (runtime, not electron-builder.yml):
 *   - Mainland-CN-like users  → primary OSS,    fallback GitHub.
 *   - All other regions       → primary GitHub, fallback OSS.
 *
 * `electron-builder.yml`'s `publish:` block is only consumed at build time to
 * stamp `app-update.yml`; at runtime we bypass it entirely by calling
 * `setFeedURL()` ourselves for each attempt, so the order there is not
 * load-bearing.
 *
 * For prerelease channels (alpha, beta), the OSS feed URL points at the
 * channel-specific directory (e.g. `/alpha/`, `/beta/`). GitHub handles
 * channels via semver tag parsing on the releases atom feed.
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { BrowserWindow, app, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { setQuitting } from './app-state';
import { shouldOptimizeNetwork } from '../utils/uv-env';

/** Base CDN URL (without trailing channel path) */
const OSS_BASE_URL = 'https://oss.intelli-spectrum.com';

/** GitHub release coordinates. Mirrors electron-builder.yml. */
const GITHUB_OWNER = 'ValueCell-ai';
const GITHUB_REPO = 'ClawX';

type UpdateProviderKind = 'oss' | 'github';

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
   * Currently-applied feed provider (set by `applyFeed`). Purely informational
   * for logs / IPC; the source of truth lives in electron-updater.
   */
  private currentProvider: UpdateProviderKind | null = null;
  /**
   * While a non-terminal provider attempt is in flight, we hide
   * `error` status updates from the renderer so the UI doesn't flash red
   * before the fallback attempt has a chance to succeed.
   */
  private suppressErrorStatus = false;

  /** Delay (in seconds) before auto-installing a downloaded update. */
  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  constructor() {
    super();

    // EventEmitter treats an unhandled 'error' event as fatal. Keep a default
    // listener so updater failures surface in logs/UI without terminating main.
    this.on('error', (error: Error) => {
      logger.error('[Updater] AppUpdater emitted error:', error);
    });

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.logger = {
      info: (msg: string) => logger.info('[Updater]', msg),
      warn: (msg: string) => logger.warn('[Updater]', msg),
      error: (msg: string) => logger.error('[Updater]', msg),
      debug: (msg: string) => logger.debug('[Updater]', msg),
    };

    const version = app.getVersion();
    const channel = detectChannel(version);
    logger.info(`[Updater] Version: ${version}, channel: ${channel} (feed selected per check)`);
    autoUpdater.channel = channel;

    this.setupListeners();
  }

  /**
   * Point electron-updater at a specific provider. Called before every
   * `autoUpdater.checkForUpdates()` so region detection / fallback can
   * re-route dynamically. `setFeedURL` replaces any previous client, so this
   * is safe to call repeatedly.
   */
  private applyFeed(kind: UpdateProviderKind): void {
    const channel = detectChannel(app.getVersion());
    autoUpdater.channel = channel;

    if (kind === 'oss') {
      const feedUrl = `${OSS_BASE_URL}/${channel}`;
      logger.info(`[Updater] Applying OSS feed: ${feedUrl}`);
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: feedUrl,
        useMultipleRangeRequest: false,
      });
    } else {
      // CI publishes every GitHub release with `prerelease: true`, so the
      // GitHub provider must be told to accept prereleases. It still
      // channel-filters via semver tags on the atom feed, so alpha/beta/
      // stable users only see matching tags.
      logger.info(`[Updater] Applying GitHub feed: ${GITHUB_OWNER}/${GITHUB_REPO} (channel=${channel})`);
      autoUpdater.allowPrerelease = true;
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
      });
    }

    this.currentProvider = kind;
  }

  /**
   * Mainland-CN-like users → OSS primary; everyone else → GitHub primary.
   * Uses the same detection as the uv mirror (timezone/locale + Google 204
   * probe). Failures default to OSS to preserve existing behavior.
   */
  private async detectPreferredProvider(): Promise<UpdateProviderKind> {
    try {
      const isMainlandLike = await shouldOptimizeNetwork();
      return isMainlandLike ? 'oss' : 'github';
    } catch (err) {
      logger.warn('[Updater] Region detection failed, defaulting to OSS:', err);
      return 'oss';
    }
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
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      if (this.suppressErrorStatus) {
        logger.info(
          `[Updater] Suppressed provider error during fallback (provider=${this.currentProvider ?? 'unknown'}): ${error.message}`
        );
        return;
      }
      this.updateStatus({ status: 'error', error: error.message });
      this.emit('error', error);
    });
  }

  /**
   * Update status and notify renderer
   */
  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = {
      status: newStatus.status ?? this.status.status,
      info: newStatus.info,
      progress: newStatus.progress,
      error: newStatus.error,
    };
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
   * Check for updates across region-preferred providers with fallback.
   *
   * Order:
   *   - Mainland-CN-like users  → [oss, github]
   *   - Other regions           → [github, oss]
   *
   * Fallback is only triggered on *transport-level* failures (promise
   * rejection). `update-not-available` is a successful terminal state and
   * does NOT cause a fallback.
   *
   * In dev mode (not packed), autoUpdater.checkForUpdates() silently returns
   * null without emitting any events, so we detect this and force a final
   * status so the UI never gets stuck in 'checking'.
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    const preferred = await this.detectPreferredProvider();
    const order: UpdateProviderKind[] = preferred === 'oss' ? ['oss', 'github'] : ['github', 'oss'];
    logger.info(`[Updater] Check order: ${order.join(' → ')} (preferred=${preferred})`);

    let lastError: Error | null = null;

    for (let i = 0; i < order.length; i++) {
      const kind = order[i];
      const isLast = i === order.length - 1;

      this.applyFeed(kind);
      this.suppressErrorStatus = !isLast;

      try {
        const result = await autoUpdater.checkForUpdates();

        // Dev mode: autoUpdater short-circuits without emitting events.
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

        logger.info(`[Updater] Check succeeded via ${kind}`);
        return result.updateInfo || null;
      } catch (error) {
        lastError = error as Error;
        logger.warn(`[Updater] Check via ${kind} failed: ${(error as Error).message || String(error)}`);
        if (!isLast) {
          logger.info(`[Updater] Falling back to ${order[i + 1]}`);
        }
      } finally {
        this.suppressErrorStatus = false;
      }
    }

    logger.error('[Updater] All providers failed:', lastError);
    this.updateStatus({
      status: 'error',
      error: lastError?.message || String(lastError),
    });
    throw lastError ?? new Error('Unknown update check failure');
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  /**
   * Install update and restart.
   *
   * On macOS, electron-updater delegates to Squirrel.Mac (ShipIt). The
   * native quitAndInstall() spawns ShipIt then internally calls app.quit().
   * However, the tray close handler in index.ts intercepts window close
   * and hides to tray unless isQuitting is true. Squirrel's internal quit
   * sometimes fails to trigger before-quit in time, so we set isQuitting
   * BEFORE calling quitAndInstall(). This lets the native quit flow close
   * the window cleanly while ShipIt runs independently to replace the app.
   */
  quitAndInstall(): void {
    logger.info('[Updater] quitAndInstall called');
    setQuitting();
    autoUpdater.quitAndInstall();
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

  cancelAutoInstall(): void {
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
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
