import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, test } from './fixtures/electron';

const configuredChannels = {
  success: true,
  channels: [{
    channelType: 'feishu',
    defaultAccountId: 'default',
    status: 'connected',
    accounts: [{
      accountId: 'default',
      name: 'Primary Account',
      configured: true,
      status: 'connected',
      isDefault: true,
    }],
  }],
};

test.describe('Channel deletion responsiveness', () => {
  test('closes the confirmation and removes the channel before host cleanup settles', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, response) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxDeletePending = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxResolveDelete = null;
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({
        id: typeof id === 'string' ? id : undefined,
        ok: true,
        data,
      });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
      }) => {
        if (request?.module === 'channels' && request.action === 'accounts') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pending = (globalThis as any).__clawxDeletePending === true;
          return respond(request.id, pending ? { success: true, channels: [] } : response);
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [] });
        }
        if (request?.module === 'channels' && request.action === 'formValues') {
          return respond(request.id, { success: true, values: { appId: 'cli_configured' } });
        }
        if (request?.module === 'channels' && request.action === 'deleteConfig') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxDeletePending = true;
          return await new Promise((resolve) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).__clawxResolveDelete = () => resolve(respond(request.id, { success: true }));
          });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, configuredChannels);

    await completeSetup(page);
    await navigateToSection(page, 'channels');

    const channelsPage = page.getByTestId('channels-page');
    const appActions = channelsPage.getByRole('button', { name: 'App actions' });
    const accountActions = channelsPage.getByRole('button', { name: 'Account actions' });
    await expect(channelsPage.getByRole('button', { name: 'Add Account' })).toBeVisible();
    await expect(channelsPage.getByRole('combobox', { name: 'Handled by' })).toBeVisible();
    await accountActions.click();
    await expect(page.getByRole('menuitem', { name: 'Remove app' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Edit configuration' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Update Feishu / Lark' });
    await expect(editDialog.locator('#appId')).toHaveValue('cli_configured');
    await page.keyboard.press('Escape');
    await expect(editDialog).toBeHidden();
    await expect(accountActions).toBeFocused();

    await accountActions.click();
    await page.getByRole('menuitem', { name: 'Delete Account' }).click();
    const accountConfirmation = page.getByRole('dialog', { name: 'Delete Account' });
    await expect(accountConfirmation).toContainText('delete this account');
    await accountConfirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(accountActions).toBeFocused();

    await appActions.click();
    await expect(page.getByRole('menuitem', { name: 'Delete Account' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Remove app' }).click();
    await expect(page.getByRole('dialog', { name: 'Remove app' })).toContainText('all its accounts');
    await page.getByTestId('confirm-dialog-confirm-button').click();

    await expect(page.getByTestId('confirm-dialog-confirm-button')).toBeHidden();
    await expect(appActions).toHaveCount(0);
    await expect.poll(async () => electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxDeletePending;
    })).toBe(true);

    await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxResolveDelete?.();
    });
  });
});
