import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Settings runtime selector', () => {
  test('switches to cc-connect and shows runtime capabilities', async ({ page }) => {
    await page.evaluate(() => {
      window.electron.ipcRenderer.__setMockConfig?.({
        gatewayStatus: {
          state: 'stopped',
          port: 0,
          runtimeKind: 'cc-connect',
          configDir: '/tmp/clawx/runtimes/cc-connect',
          capabilities: {
            chat: true,
            sessions: true,
            history: true,
            providers: true,
            models: true,
            channels: true,
            cron: true,
            logs: true,
            skills: true,
            doctor: true,
            controlUi: true,
          },
        },
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();

    await expect(page.getByTestId('settings-runtime-section')).toHaveCount(0);
    const devModeToggle = page.getByTestId('settings-dev-mode-switch');
    await devModeToggle.click();

    await expect(page.getByTestId('settings-runtime-section')).toBeVisible();
    await page.getByTestId('settings-runtime-cc-connect').click();

    await expect(page.getByTestId('settings-runtime-cc-connect')).toBeVisible();
    await expect(page.getByTestId('settings-runtime-config-dir')).toContainText('cc-connect');
    await expect(page.getByTestId('settings-runtime-capabilities')).toContainText('Doctor');

    await expect(page.getByTestId('settings-run-doctor-button')).toBeVisible();
    await expect(page.getByTestId('settings-run-doctor-fix-button')).toBeDisabled();
    await expect(page.getByTestId('sidebar-open-dev-console')).toContainText('CC Connect Page');
    await expect(page.getByTestId('sidebar-nav-dreams')).toHaveCount(0);
  });
});
