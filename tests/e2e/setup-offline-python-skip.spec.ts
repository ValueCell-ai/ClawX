import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test.describe('ClawX setup offline managed python handling', () => {
  test('does not block setup when uv managed python download is skipped offline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          '["/api/gateway/status","GET"]': {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
          },
        },
        ipc: {
          'openclaw:status': {
            packageExists: true,
            isBuilt: true,
            dir: '/tmp/openclaw',
            entryPath: '/tmp/openclaw/openclaw.mjs',
            version: 'test',
          },
          'uv:install-all': {
            success: true,
            skippedPythonInstall: true,
            reason: 'offline',
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('setup-page')).toBeVisible();
      await page.getByTestId('setup-next-button').click();
      await page.getByTestId('setup-next-button').click();

      await expect(page.getByText('Network unavailable, skipped Python environment download for now')).toBeVisible();
      await expect(page.getByTestId('setup-skill-python-env')).toContainText('Pending');
      await expect(page.getByTestId('setup-complete-step')).toBeVisible({ timeout: 10_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
