import { completeSetup, expect, test } from './fixtures/electron';

const unsupportedChannelTypes = [
  'signal',
  'imessage',
  'matrix',
  'line',
  'msteams',
  'googlechat',
  'mattermost',
];

const channelsResponse = {
  success: true,
  channels: [
    {
      channelType: 'feishu',
      defaultAccountId: 'default',
      status: 'connected',
      accounts: [],
    },
    ...unsupportedChannelTypes.map((channelType) => ({
      channelType,
      defaultAccountId: 'default',
      status: 'connected',
      accounts: [{
        accountId: 'default',
        name: `unsupported-${channelType}`,
        configured: true,
        status: 'connected',
        isDefault: true,
      }],
    })),
  ],
};

test.describe('ClawX supported channel catalog', () => {
  test('does not expose unsupported runtime channels as configurable integrations', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, response) => {
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
          return respond(request.id, response);
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [] });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, channelsResponse);

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-channels').click();

    const channelsPage = page.getByTestId('channels-page');
    await expect(channelsPage).toBeVisible();
    await expect(channelsPage.getByText('Feishu / Lark')).toBeVisible();
    await expect(channelsPage.getByText('Telegram', { exact: true })).toBeVisible();

    for (const channelType of unsupportedChannelTypes) {
      await expect(channelsPage.getByText(channelType, { exact: true })).toHaveCount(0);
      await expect(channelsPage.getByText(`unsupported-${channelType}`)).toHaveCount(0);
    }
  });
});
