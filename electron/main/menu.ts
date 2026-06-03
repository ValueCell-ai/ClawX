/**
 * Application Menu Configuration
 * Creates the native application menu for macOS/Windows/Linux
 */
import { Menu, app, shell, BrowserWindow } from 'electron';
import { MENU_LABELS } from '@shared/i18n/resources';
import { resolveSupportedLanguage, type LanguageCode } from '@shared/language';
import { getSetting } from '../utils/store';

function applyAppName(label: string): string {
  return label.replaceAll('{{appName}}', app.name);
}

async function resolveMenuLanguage(language?: string): Promise<LanguageCode> {
  if (language) return resolveSupportedLanguage(language);
  try {
    return resolveSupportedLanguage(await getSetting('language'));
  } catch {
    return resolveSupportedLanguage(app.getLocale());
  }
}

function getMenuTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

/**
 * Create application menu
 */
export async function createMenu(language?: string): Promise<void> {
  const isMac = process.platform === 'darwin';
  const labels = MENU_LABELS[await resolveMenuLanguage(language)];
  
  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: applyAppName(labels.app.about) },
              { type: 'separator' as const },
              {
                label: labels.app.preferences,
                accelerator: 'Cmd+,',
                click: () => {
                  const win = getMenuTargetWindow();
                  win?.webContents.send('navigate', '/settings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: labels.app.services },
              { type: 'separator' as const },
              { role: 'hide' as const, label: applyAppName(labels.app.hide) },
              { role: 'hideOthers' as const, label: labels.app.hideOthers },
              { role: 'unhide' as const, label: labels.app.unhide },
              { type: 'separator' as const },
              { role: 'quit' as const, label: applyAppName(labels.app.quit) },
            ],
          },
        ]
      : []),
    
    // File menu
    {
      label: labels.file.label,
      submenu: [
        {
          id: 'new-chat',
          label: labels.file.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('new-chat');
          },
        },
        { type: 'separator' },
        isMac
          ? { role: 'close', label: labels.file.close }
          : { role: 'quit', label: applyAppName(labels.app.quit) },
      ],
    },
    
    // Edit menu
    {
      label: labels.edit.label,
      submenu: [
        { role: 'undo', label: labels.edit.undo },
        { role: 'redo', label: labels.edit.redo },
        { type: 'separator' },
        { role: 'cut', label: labels.edit.cut },
        { role: 'copy', label: labels.edit.copy },
        { role: 'paste', label: labels.edit.paste },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: labels.edit.pasteAndMatchStyle },
              { role: 'delete' as const, label: labels.edit.delete },
              { role: 'selectAll' as const, label: labels.edit.selectAll },
            ]
          : [
              { role: 'delete' as const, label: labels.edit.delete },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: labels.edit.selectAll },
            ]),
      ],
    },
    
    // View menu
    {
      label: labels.view.label,
      submenu: [
        { role: 'reload', label: labels.view.reload },
        { role: 'forceReload', label: labels.view.forceReload },
        { role: 'toggleDevTools', label: labels.view.toggleDevTools },
        { type: 'separator' },
        { role: 'resetZoom', label: labels.view.resetZoom },
        { role: 'zoomIn', label: labels.view.zoomIn },
        { role: 'zoomOut', label: labels.view.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: labels.view.toggleFullscreen },
      ],
    },
    
    // Navigate menu
    {
      label: labels.navigate.label,
      submenu: [
        {
          label: labels.navigate.dashboard,
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/');
          },
        },
        {
          label: labels.navigate.chat,
          accelerator: 'CmdOrCtrl+2',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/');
          },
        },
        {
          label: labels.navigate.channels,
          accelerator: 'CmdOrCtrl+3',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/channels');
          },
        },
        {
          label: labels.navigate.skills,
          accelerator: 'CmdOrCtrl+4',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/skills');
          },
        },
        {
          label: labels.navigate.cronTasks,
          accelerator: 'CmdOrCtrl+5',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/cron');
          },
        },
        {
          label: labels.navigate.settings,
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => {
            const win = getMenuTargetWindow();
            win?.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    
    // Window menu
    {
      label: labels.window.label,
      submenu: [
        { role: 'minimize', label: labels.window.minimize },
        { role: 'zoom', label: labels.window.zoom },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: labels.window.front },
              { type: 'separator' as const },
              { role: 'window' as const, label: labels.window.label },
            ]
          : [{ role: 'close' as const, label: labels.window.close }]),
      ],
    },
    
    // Help menu
    {
      role: 'help',
      label: labels.help.label,
      submenu: [
        {
          label: labels.help.documentation,
          click: async () => {
            await shell.openExternal('https://claw-x.com');
          },
        },
        {
          label: labels.help.reportIssue,
          click: async () => {
            await shell.openExternal('https://github.com/ValueCell-ai/ClawX/issues');
          },
        },
        { type: 'separator' },
        {
          label: labels.help.openClawDocumentation,
          click: async () => {
            await shell.openExternal('https://docs.openclaw.ai');
          },
        },
      ],
    },
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
