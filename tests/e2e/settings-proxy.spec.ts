import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  const isChecked = currentState === 'checked';
  if (isChecked !== checked) {
    await toggle.click();
  }
}

async function readProxyEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean(settings?.proxyEnabled);
  });
}

test.describe('ClawX developer proxy settings', () => {
  test('keeps proxy save available when disabling proxy in developer mode', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();

    const devModeToggle = page.getByTestId('settings-dev-mode-switch');
    await expect(devModeToggle).toBeVisible();
    await ensureSwitchState(devModeToggle, true);

    const proxySection = page.getByTestId('settings-proxy-section');
    const proxyToggle = page.getByTestId('settings-proxy-toggle');
    const proxySaveButton = page.getByTestId('settings-proxy-save-button');

    await expect(proxySection).toBeVisible();
    await expect(proxyToggle).toBeVisible();
    await expect(proxySaveButton).toBeVisible();

    await ensureSwitchState(proxyToggle, true);
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(true);

    await ensureSwitchState(proxyToggle, false);
    await expect(proxySaveButton).toBeVisible();
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(false);
  });
});
