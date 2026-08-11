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
    await page.getByTestId('sidebar-nav-channels').click();

    const channelsPage = page.getByTestId('channels-page');
    await expect(channelsPage.getByTitle('Delete channel')).toBeVisible();
    await channelsPage.getByTitle('Delete channel').click();
    await page.getByTestId('confirm-dialog-confirm-button').click();

    await expect(page.getByTestId('confirm-dialog-confirm-button')).toBeHidden();
    await expect(channelsPage.getByTitle('Delete channel')).toHaveCount(0);
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
