import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function getZoomLevel(app: ElectronApplication): Promise<number> {
  return await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win?.webContents.getZoomLevel() ?? 0;
  });
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

      await page.keyboard.press('Control+-');
      await expect.poll(async () => await getZoomLevel(app)).toBe(-1);

      await page.keyboard.press('Control+Shift+=');
      await expect.poll(async () => await getZoomLevel(app)).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
