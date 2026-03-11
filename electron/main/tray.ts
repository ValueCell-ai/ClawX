/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

export interface TrayTranslations {
  tooltipRunning: string;
  tooltipStopped: string;
  show: string;
  gatewayStatus: string;
  running: string;
  stopped: string;
  quickActions: string;
  openDashboard: string;
  openChat: string;
  openSettings: string;
  checkUpdates: string;
  quit: string;
}

const defaultTranslations: TrayTranslations = {
  tooltipRunning: 'ClawX - Gateway Running',
  tooltipStopped: 'ClawX - Gateway Stopped',
  show: 'Show ClawX',
  gatewayStatus: 'Gateway Status',
  running: 'Running',
  stopped: 'Stopped',
  quickActions: 'Quick Actions',
  openDashboard: 'Open Dashboard',
  openChat: 'Open Chat',
  openSettings: 'Open Settings',
  checkUpdates: 'Check for Updates...',
  quit: 'Quit ClawX',
};

let currentTranslations: TrayTranslations = defaultTranslations;

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

function buildContextMenu(translations: TrayTranslations, gatewayRunning: boolean): Electron.Menu {
  const showWindow = () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    mainWindowRef.show();
    mainWindowRef.focus();
  };

  return Menu.buildFromTemplate([
    {
      label: translations.show,
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: translations.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${gatewayRunning ? translations.running : translations.stopped}`,
      type: 'checkbox',
      checked: gatewayRunning,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: translations.quickActions,
      submenu: [
        {
          label: translations.openDashboard,
          click: () => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.show();
            mainWindowRef.webContents.send('navigate', '/');
          },
        },
        {
          label: translations.openChat,
          click: () => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.show();
            mainWindowRef.webContents.send('navigate', '/chat');
          },
        },
        {
          label: translations.openSettings,
          click: () => {
            if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
            mainWindowRef.show();
            mainWindowRef.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: translations.checkUpdates,
      click: () => {
        if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
        mainWindowRef.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: translations.quit,
      click: () => {
        app.quit();
      },
    },
  ]);
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Store window reference for later use
  mainWindowRef = mainWindow;

  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  
  // Set initial tooltip (will be updated via updateTrayMenu)
  tray.setToolTip(defaultTranslations.tooltipRunning);
  
  // Set context menu
  tray.setContextMenu(buildContextMenu(defaultTranslations, true));
  
  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    if (mainWindowRef.isVisible()) {
      mainWindowRef.hide();
    } else {
      mainWindowRef.show();
      mainWindowRef.focus();
    }
  });
  
  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    mainWindowRef.show();
    mainWindowRef.focus();
  });
  
  return tray;
}

/**
 * Update tray menu with translations and gateway status
 */
export function updateTrayMenu(translations: TrayTranslations, gatewayRunning: boolean): void {
  if (!tray) return;
  
  currentTranslations = translations;
  tray.setToolTip(gatewayRunning ? translations.tooltipRunning : translations.tooltipStopped);
  tray.setContextMenu(buildContextMenu(translations, gatewayRunning));
}

/**
 * Get current tray translations
 */
export function getCurrentTrayTranslations(): TrayTranslations {
  return currentTranslations;
}

/**
 * Update tray tooltip with Gateway status (legacy function)
 */
export function updateTrayStatus(status: 'running' | 'stopped'): void {
  if (!tray) return;
  const isRunning = status === 'running';
  tray.setToolTip(isRunning ? currentTranslations.tooltipRunning : currentTranslations.tooltipStopped);
  tray.setContextMenu(buildContextMenu(currentTranslations, isRunning));
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    mainWindowRef = null;
  }
}
