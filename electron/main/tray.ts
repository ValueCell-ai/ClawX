/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'path';
import { MENU_LABELS, type MenuLabels } from '@shared/i18n/resources';
import { resolveSupportedLanguage, type LanguageCode } from '@shared/language';
import { getSetting } from '../utils/store';

let tray: Tray | null = null;
let trayMainWindow: BrowserWindow | null = null;
let trayStatus: string | null = null;

export type TrayMenuLabels = MenuLabels['tray'];

function applyTemplate(label: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    label,
  );
}

function applyAppName(label: string): string {
  return applyTemplate(label, { appName: app.name });
}

async function resolveTrayLanguage(language?: string): Promise<LanguageCode> {
  if (language) return resolveSupportedLanguage(language);
  try {
    return resolveSupportedLanguage(await getSetting('language'));
  } catch {
    return resolveSupportedLanguage(app.getLocale());
  }
}

export function getTrayMenuLabels(language?: string): TrayMenuLabels {
  return MENU_LABELS[resolveSupportedLanguage(language)].tray;
}

function showWindow(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

export function buildTrayMenuTemplate(
  mainWindow: BrowserWindow,
  labels: TrayMenuLabels,
): MenuItemConstructorOptions[] {
  return [
    {
      label: applyAppName(labels.show),
      click: () => showWindow(mainWindow),
    },
    {
      type: 'separator',
    },
    {
      label: labels.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${labels.running}`,
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: labels.quickActions,
      submenu: [
        {
          label: labels.openChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: labels.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: labels.checkForUpdates,
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: applyAppName(labels.quit),
      click: () => {
        app.quit();
      },
    },
  ];
}

function applyTrayMenu(mainWindow: BrowserWindow, labels: TrayMenuLabels): void {
  if (!tray) return;
  const tooltip = trayStatus
    ? applyTemplate(labels.statusTooltip, { appName: app.name, status: trayStatus })
    : applyAppName(labels.tooltip);
  tray.setToolTip(tooltip);
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(mainWindow, labels)));
}

export async function refreshTrayMenu(language?: string): Promise<void> {
  if (!tray || !trayMainWindow || trayMainWindow.isDestroyed()) return;
  const resolvedLanguage = await resolveTrayLanguage(language);
  applyTrayMenu(trayMainWindow, getTrayMenuLabels(resolvedLanguage));
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
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
  trayMainWindow = mainWindow;

  applyTrayMenu(mainWindow, getTrayMenuLabels(app.getLocale()));
  void refreshTrayMenu();

  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  
  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  trayStatus = status;
  void refreshTrayMenu();
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
    trayMainWindow = null;
    trayStatus = null;
  }
}
