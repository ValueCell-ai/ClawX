import type { BrowserWindow } from 'electron';

export type ZoomShortcutAction = 'in' | 'out' | 'reset';

type ZoomShortcutInput = Pick<Electron.Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'alt'>;

export function getZoomShortcutAction(
  input: ZoomShortcutInput,
  platform: NodeJS.Platform = process.platform,
): ZoomShortcutAction | null {
  // Electron sends before-input-event for both halves of a keystroke. Acting on
  // keyUp makes one Ctrl/Cmd +/- press change the zoom twice; a focus transition
  // can make that trailing change appear to happen when the window is reopened.
  const commandModifier = platform === 'darwin' ? input.meta : input.control;
  if (input.type !== 'keyDown' || !commandModifier || input.alt) {
    return null;
  }

  const key = input.key.toLowerCase();

  if (key === '+' || key === '=' || input.code === 'Equal' || input.code === 'NumpadAdd') {
    return 'in';
  }

  if (key === '-' || input.code === 'Minus' || input.code === 'NumpadSubtract') {
    return 'out';
  }

  if (key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') {
    return 'reset';
  }

  return null;
}

export function registerZoomShortcuts(win: BrowserWindow): void {
  let zoomLevelBeforeMinimize: number | null = null;

  win.on('minimize', () => {
    const zoomLevel = win.webContents.getZoomLevel();
    zoomLevelBeforeMinimize = Number.isFinite(zoomLevel) ? zoomLevel : null;
  });

  win.on('restore', () => {
    if (zoomLevelBeforeMinimize === null || win.webContents.isDestroyed()) {
      return;
    }

    // Re-assert the pre-minimize page zoom. Chromium can recalculate its
    // same-origin zoom while a Windows window is detached from the display;
    // preserving the user's current level prevents the UI text from jumping.
    win.webContents.setZoomLevel(zoomLevelBeforeMinimize);
    zoomLevelBeforeMinimize = null;
  });

  win.webContents.on('before-input-event', (event, input) => {
    const action = getZoomShortcutAction(input);

    if (!action) {
      return;
    }

    event.preventDefault();

    if (action === 'reset') {
      win.webContents.setZoomLevel(0);
      return;
    }

    const delta = action === 'in' ? 1 : -1;
    win.webContents.setZoomLevel(win.webContents.getZoomLevel() + delta);
  });
}
