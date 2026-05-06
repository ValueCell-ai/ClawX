import type { BrowserWindow } from 'electron';

export type ZoomShortcutAction = 'in' | 'out' | 'reset';

type ZoomShortcutInput = Pick<Electron.Input, 'key' | 'code' | 'control' | 'meta' | 'alt'>;

export function getZoomShortcutAction(input: ZoomShortcutInput): ZoomShortcutAction | null {
  if ((!input.control && !input.meta) || input.alt) {
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
