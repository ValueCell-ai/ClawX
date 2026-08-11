import { completeSetup, expect, test } from './fixtures/electron';

const responses = {
  channels: { success: true, channels: [] },
  agents: { success: true, agents: [] },
  validation: { success: true, valid: true, warnings: [] },
};

test.describe('Plugin-backed channel save', () => {
  test('submits QQBot credentials through the typed Channels host API', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, fixtures) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxPluginChannelSavePayload = null;
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
        payload?: unknown;
      }) => {
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, fixtures.channels);
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, fixtures.agents);
        }
        if (request?.module === 'channels' && request.action === 'validateCredentials') {
          return respond(request.id, fixtures.validation);
        }
        if (request?.module === 'channels' && request.action === 'saveConfig') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxPluginChannelSavePayload = request.payload;
          return respond(request.id, { success: true });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, responses);

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-channels').click();

    const channelsPage = page.getByTestId('channels-page');
    await expect(channelsPage).toBeVisible();
    await channelsPage.getByRole('button', { name: /QQ Bot/ }).click();

    await page.locator('#appId').fill('qq-app-id');
    await page.locator('#clientSecret').fill('qq-client-secret');
    await page.getByRole('button', { name: /Save & Connect|dialog\.saveAndConnect/i }).click();

    await expect.poll(async () => electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxPluginChannelSavePayload;
    })).toEqual({
      channelType: 'qqbot',
      config: {
        appId: 'qq-app-id',
        clientSecret: 'qq-client-secret',
      },
    });
  });
});
