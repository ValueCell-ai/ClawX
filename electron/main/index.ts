/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray } from './tray';
import { createMenu } from './menu';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';

// Disable GPU acceleration for better compatibility
app.disableHardwareAcceleration();

import { ClawHubService } from '../gateway/clawhub';

// Global references
let mainWindow: BrowserWindow | null = null;
const gatewayManager = new GatewayManager();
const clawHubService = new ClawHubService();

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
  });

  // Show window when ready to prevent visual flash
  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Open DevTools in development
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== ClawX Application Starting ===');
  logger.info(`Platform: ${process.platform}, Arch: ${process.arch}`);
  logger.info(`Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
  logger.info(`App path: ${app.getAppPath()}`);
  logger.info(`User data: ${app.getPath('userData')}`);
  logger.info(`Is packaged: ${app.isPackaged}`);
  logger.info(`Resources path: ${process.resourcesPath}`);
  logger.info(`Exec path: ${process.execPath}`);

  // Set application menu
  createMenu();

  // Create the main window
  mainWindow = createWindow();

  // Create system tray
  createTray(mainWindow);

  // Override security headers ONLY for the OpenClaw Gateway Control UI
  // The Control UI sets X-Frame-Options: DENY and CSP frame-ancestors 'none'
  // which prevents embedding in an iframe. Only apply to gateway URLs.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isGatewayUrl = details.url.includes('127.0.0.1:18789') || details.url.includes('localhost:18789');

    if (!isGatewayUrl) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const headers = { ...details.responseHeaders };
    // Remove X-Frame-Options to allow embedding in iframe
    delete headers['X-Frame-Options'];
    delete headers['x-frame-options'];
    // Remove restrictive CSP frame-ancestors
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
        (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
      );
    }
    if (headers['content-security-policy']) {
      headers['content-security-policy'] = headers['content-security-policy'].map(
        (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
      );
    }
    callback({ responseHeaders: headers });
  });

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, mainWindow);

  // Register update handlers
  registerUpdateHandlers(appUpdater, mainWindow);

  // Check for updates after a delay (only in production)
  if (!process.env.VITE_DEV_SERVER_URL) {
    setTimeout(() => {
      appUpdater.checkForUpdates().catch((err) => {
        console.error('Failed to check for updates:', err);
      });
    }, 10000); // Check after 10 seconds
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Start Gateway automatically (optional based on settings)
  try {
    logger.info('Auto-starting Gateway...');
    await gatewayManager.start();
    logger.info('Gateway auto-start succeeded');
  } catch (error) {
    logger.error('Gateway auto-start failed:', error);
    // Notify renderer about the error
    mainWindow?.webContents.send('gateway:error', String(error));
  }
}

// Application lifecycle
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  // On macOS, keep the app running in the menu bar
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on('before-quit', async () => {
  // Clean up Gateway process
  await gatewayManager.stop();
});

// Export for testing
export { mainWindow, gatewayManager };
