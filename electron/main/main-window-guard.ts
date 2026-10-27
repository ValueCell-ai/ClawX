import { app, type BrowserWindow } from 'electron';

/** Recover if a native/Chromium path bypasses the window-open deny handlers. */
export function registerMainWindowGuard(
  getMainWindow: () => BrowserWindow | null,
  focusMainWindow: () => void,
): void {
  app.on('browser-window-created', (_event, win) => {
    // The constructor emits before createMainWindow assigns the singleton.
    queueMicrotask(() => {
      const main = getMainWindow();
      if (!main || main.isDestroyed() || win.isDestroyed() || win === main) return;
      if (win.webContents === main.webContents.devToolsWebContents) return;

      // destroy bypasses close handlers that could leave a blank window hidden.
      win.destroy();
      focusMainWindow();
    });
  });
}
