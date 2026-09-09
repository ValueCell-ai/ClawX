import type { ElectronApplication, Page } from '@playwright/test';
import { expect, installIpcMocks, test } from './fixtures/electron';

async function installComputerFixture(electronApp: ElectronApplication, supported = true, mac = true, grantPermissions = true) {
  await electronApp.evaluate(({ ipcMain }, options) => {
    type Request = { id: string; module: string; action: string; payload?: { enabled: boolean } };
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => unknown> })._invokeHandlers.get('host:invoke')!;
    const state = {
      enabled: false, supported: options.supported, running: false,
      permissions: options.mac ? { accessibility: false, screenRecording: 'denied' } : null,
    };
    const calls: string[] = [];
    Object.assign(globalThis, { computerUseCalls: calls });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      if (request.module !== 'computerUse') return original(event, request);
      calls.push(request.action);
      if (request.action === 'setEnabled') state.enabled = request.payload!.enabled;
      if (request.action === 'requestPermissions') {
        if (!state.enabled) throw new Error('disabled');
        if (options.grantPermissions) {
          state.permissions = { accessibility: true, screenRecording: 'granted' };
          state.running = true;
        }
      }
      if (!state.enabled) state.running = false;
      return { id: request.id, ok: true, data: state };
    });
  }, { supported, mac, grantPermissions });
}

async function enableDeveloperMode(page: Page) {
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-dev-mode-switch').click();
  await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
}

test.afterEach(async ({ page }) => {
  const settingsLink = page.getByTestId('sidebar-nav-settings');
  if (await settingsLink.count() === 0) return;
  await settingsLink.click();
  const devModeSwitch = page.getByTestId('settings-dev-mode-switch');
  if (await devModeSwitch.getAttribute('data-state') === 'checked') await devModeSwitch.click();
});

test('Computer Use is default off and only the explicit button requests permissions', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp);
  await page.getByTestId('setup-skip-button').click();
  await enableDeveloperMode(page);
  await page.getByTestId('sidebar-nav-computer-use').click();
  await expect(page.getByTestId('computer-use-page')).toBeVisible();
  await expect(page.getByTestId('computer-use-page')).toContainText('Let agents inspect windows, accessibility elements, and menus, verify results, and operate this computer through the bundled native CUA CLI.');
  await expect(page.getByTestId('computer-use-page')).toContainText('Once enabled, it is recommended to use the /computer-use skill to guide AI in operating your computer.');
  await expect(page.getByTestId('computer-use-page')).not.toContainText('computer tool');
  await expect(page.getByTestId('computer-use-runtime')).toHaveText('Disabled. The ClawX-managed CUA service is stopped.');
  const toggle = page.getByTestId('computer-use-toggle');
  const request = page.getByTestId('computer-use-request-permissions');
  await expect(toggle).not.toBeChecked();
  await expect(request).toBeDisabled();
  await expect(page.getByTestId('computer-use-accessibility')).toBeVisible();
  await expect(page.getByTestId('computer-use-screen-recording')).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(request).toBeEnabled();
  expect(await electronApp.evaluate(() => (globalThis as unknown as { computerUseCalls: string[] }).computerUseCalls)).not.toContain('requestPermissions');
  await page.reload();
  await expect(toggle).toBeChecked();
  await request.click();
  await expect(request).toBeDisabled();
  await expect(page.getByTestId('computer-use-runtime')).toContainText(/running|运行|実行中|работает/);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(request).toBeDisabled();
  expect(await electronApp.evaluate(() => (globalThis as unknown as { computerUseCalls: string[] }).computerUseCalls.filter((action) => action === 'requestPermissions'))).toHaveLength(1);
});

test('unsupported platforms cannot opt in and non-macOS does not show macOS permissions', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp, false, false);
  await page.getByTestId('setup-skip-button').click();
  await enableDeveloperMode(page);
  await page.getByTestId('sidebar-nav-computer-use').click();
  await expect(page.getByTestId('computer-use-toggle')).toBeDisabled();
  await expect(page.getByTestId('computer-use-request-permissions')).toHaveCount(0);
});

test('an unchanged permission request shows guidance without implicitly re-prompting', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp, true, true, false);
  await page.getByTestId('setup-skip-button').click();
  await enableDeveloperMode(page);
  await page.getByTestId('sidebar-nav-computer-use').click();
  const feedback = page.getByTestId('computer-use-permission-feedback');
  await expect(feedback).toHaveCount(0);
  await page.getByTestId('computer-use-toggle').click();
  await expect(feedback).toHaveCount(0);
  await page.getByTestId('computer-use-request-permissions').click();
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(/System Settings/);
  await expect(page.getByTestId('computer-use-request-permissions')).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await electronApp.evaluate(() => (globalThis as unknown as { computerUseCalls: string[] }).computerUseCalls.filter((action) => action === 'requestPermissions'))).toHaveLength(1);
  await page.getByTestId('computer-use-toggle').click();
  await expect(feedback).toHaveCount(0);
});

test('the real host defaults off and rejects permission requests without loading the driver', async ({ electronApp, page }) => {
  const result = await page.evaluate(async () => {
    const status = await window.clawx.hostInvoke({ id: 'computer-status', module: 'computerUse', action: 'status' });
    const request = await window.clawx.hostInvoke({ id: 'computer-request', module: 'computerUse', action: 'requestPermissions' });
    return { status, request };
  });
  expect(result.status).toMatchObject({ ok: true, data: { enabled: false, running: false } });
  expect(result.request).toMatchObject({ ok: false, error: { message: 'Computer Use is disabled' } });
  const nativeLibraries = await electronApp.evaluate(() => {
    const report = process.report.getReport() as { sharedObjects: string[] };
    return report.sharedObjects.filter((file) => /cua_driver_(sdk|node_runtime)/.test(file));
  });
  expect(nativeLibraries).toEqual([]);
});

test('failed opt-in displays an error and retains the safe host state', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp);
  await installIpcMocks(electronApp, { hostApiErrors: {
    '["computerUse","setEnabled",{"enabled":true}]': 'Computer Use startup failed',
  } });
  await page.getByTestId('setup-skip-button').click();
  await enableDeveloperMode(page);
  await page.getByTestId('sidebar-nav-computer-use').click();
  await page.getByTestId('computer-use-toggle').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('computer-use-toggle')).not.toBeChecked();
  await expect(page.getByTestId('computer-use-toggle')).toBeEnabled();
  await expect(page.getByTestId('computer-use-request-permissions')).toBeDisabled();
});
