import { expect, test, completeSetup } from './fixtures/electron';

test.describe('ClawX update notifications', () => {
  test('prompts when a new version is available', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(() => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      win?.webContents.send('update:status-changed', {
        status: 'available',
        info: {
          version: '9.9.9',
          releaseDate: new Date().toISOString(),
        },
      });
    });

    await expect(page.getByText(/9\.9\.9/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Download|下载|ダウンロード|Скачать/i })).toBeVisible();
  });
});
