import type { ElectronApplication } from '@playwright/test';
import { expect, installIpcMocks, test } from './fixtures/electron';

async function installComputerFixture(electronApp: ElectronApplication, supported = true, mac = true) {
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
        state.permissions = { accessibility: true, screenRecording: 'granted' };
        state.running = true;
      }
      if (!state.enabled) state.running = false;
      return { id: request.id, ok: true, data: state };
    });
  }, { supported, mac });
}

test('Computer Use is default off and only the explicit button requests permissions', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp);
  await page.getByTestId('setup-skip-button').click();
  await page.getByTestId('sidebar-nav-computer-use').click();
  await expect(page.getByTestId('computer-use-page')).toBeVisible();
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
  await page.getByTestId('sidebar-nav-computer-use').click();
  await expect(page.getByTestId('computer-use-toggle')).toBeDisabled();
  await expect(page.getByTestId('computer-use-request-permissions')).toHaveCount(0);
});

test('the real host defaults off and rejects permission requests without loading the driver', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const status = await window.clawx.hostInvoke({ id: 'computer-status', module: 'computerUse', action: 'status' });
    const request = await window.clawx.hostInvoke({ id: 'computer-request', module: 'computerUse', action: 'requestPermissions' });
    return { status, request };
  });
  expect(result.status).toMatchObject({ ok: true, data: { enabled: false, running: false } });
  expect(result.request).toMatchObject({ ok: false, error: { message: 'Computer Use is disabled' } });
});

test('failed opt-in displays an error and retains the safe host state', async ({ electronApp, page }) => {
  await installComputerFixture(electronApp);
  await installIpcMocks(electronApp, { hostApiErrors: {
    '["computerUse","setEnabled",{"enabled":true}]': 'Gateway policy update failed',
  } });
  await page.getByTestId('setup-skip-button').click();
  await page.getByTestId('sidebar-nav-computer-use').click();
  await page.getByTestId('computer-use-toggle').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('computer-use-toggle')).not.toBeChecked();
  await expect(page.getByTestId('computer-use-toggle')).toBeEnabled();
  await expect(page.getByTestId('computer-use-request-permissions')).toBeDisabled();
});
