import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function getZoomLevel(app: ElectronApplication): Promise<number> {
  return await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.webContents.getZoomLevel() ?? 0;
  });
}

async function sendZoomShortcut(
  app: ElectronApplication,
  action: 'in' | 'out',
  type: 'keyDown' | 'keyUp' = 'keyDown',
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, { zoomAction, inputType }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const contents = win?.webContents;
    if (!contents) return;

    const commandModifiers = process.platform === 'darwin'
      ? { control: false, meta: true }
      : { control: true, meta: false };
    const input = zoomAction === 'out'
      ? { type: inputType, key: '-', code: 'Minus', ...commandModifiers, alt: false }
      : { type: inputType, key: '=', code: 'Equal', ...commandModifiers, alt: false };

    contents.emit('before-input-event', { preventDefault() {} }, input);
  }, { zoomAction: action, inputType: type });
}

test.describe('ClawX window zoom shortcuts', () => {
  test('can zoom back in after zooming out with keyboard shortcuts', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomLevel(0);
      });

      await sendZoomShortcut(app, 'out');
      await sendZoomShortcut(app, 'out', 'keyUp');
      await expect.poll(async () => await getZoomLevel(app)).toBe(-1);

      await sendZoomShortcut(app, 'in');
      await sendZoomShortcut(app, 'in', 'keyUp');
      await expect.poll(async () => await getZoomLevel(app)).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preserves the page zoom when the window is minimized and restored', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;

        win.webContents.setZoomLevel(1);
        if (!win.isMinimized()) {
          await new Promise<void>((resolve) => {
            win.once('minimize', resolve);
            win.minimize();
          });
        }
      });
      await expect.poll(async () => await app.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false
      ))).toBe(true);

      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;

        await new Promise<void>((resolve) => {
          win.once('restore', resolve);
          win.restore();
        });
      });
      await expect.poll(async () => await app.evaluate(({ BrowserWindow }) => (
        BrowserWindow.getAllWindows()[0]?.isMinimized() ?? true
      ))).toBe(false);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect.poll(async () => await getZoomLevel(app)).toBe(1);
    } finally {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomLevel(0);
      });
      await closeElectronApp(app);
    }
  });
});
