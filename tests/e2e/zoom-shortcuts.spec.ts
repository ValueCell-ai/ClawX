import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function getZoomLevel(app: ElectronApplication): Promise<number> {
  return await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.webContents.getZoomLevel() ?? 0;
  });
}

async function sendZoomShortcut(app: ElectronApplication, action: 'in' | 'out'): Promise<void> {
  await app.evaluate(({ BrowserWindow }, zoomAction) => {
    const win = BrowserWindow.getAllWindows()[0];
    const contents = win?.webContents;
    if (!contents) return;

    const input = zoomAction === 'out'
      ? { key: '-', code: 'Minus', control: true, meta: false, alt: false }
      : { key: '=', code: 'Equal', control: true, meta: false, alt: false };

    contents.emit('before-input-event', { preventDefault() {} }, input);
  }, action);
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
      await expect.poll(async () => await getZoomLevel(app)).toBe(-1);

      await sendZoomShortcut(app, 'in');
      await expect.poll(async () => await getZoomLevel(app)).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
