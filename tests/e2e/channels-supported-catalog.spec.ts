import type { Locator } from '@playwright/test';
import { navigateToSection } from './fixtures/navigation';
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

function measureSetupLayout(dialog: Locator) {
  return dialog.evaluate((element) => {
    const footer = element.querySelector('footer');
    if (!footer) throw new Error('Missing channel setup footer');
    return {
      width: element.offsetWidth,
      footerWidth: footer.offsetWidth,
      footerInset: element.offsetHeight - footer.offsetTop - footer.offsetHeight,
    };
  });
}

test.describe('ClawX supported channel catalog', () => {
  test('limits the catalog to supported apps and shows WhatsApp pairing steps with its QR code', async ({ electronApp, page }) => {
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
        if (request?.module === 'channels' && request.action === 'startLogin') {
          event.sender.send('channel:whatsapp-qr', {
            qr: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E',
          });
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'cancelLogin') {
          return respond(request.id, { success: true });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, channelsResponse);

    await completeSetup(page);
    await navigateToSection(page, 'channels');

    const channelsPage = page.getByTestId('channels-page');
    await expect(channelsPage).toBeVisible();
    await expect(channelsPage.getByText('Feishu / Lark')).toBeVisible();
    await expect(channelsPage.getByText('Telegram', { exact: true })).toBeVisible();

    for (const channelType of unsupportedChannelTypes) {
      await expect(channelsPage.getByText(channelType, { exact: true })).toHaveCount(0);
      await expect(channelsPage.getByText(`unsupported-${channelType}`)).toHaveCount(0);
    }

    const telegram = channelsPage.getByRole('button', { name: /Telegram/ });
    await telegram.click();
    const telegramDialog = page.getByRole('dialog', { name: 'Configure Telegram' });
    const setupLayout = await measureSetupLayout(telegramDialog);
    expect(setupLayout.footerInset).toBe(0);
    await expect(telegramDialog.locator('footer').getByRole('button', { name: 'View Documentation' })).toBeVisible();
    await telegramDialog.getByRole('button', { name: 'Close' }).click();
    await expect(telegram).toBeFocused();

    const feishu = channelsPage.getByTestId('channel-group-feishu').getByRole('button', { name: 'Add Account' });
    await feishu.click();
    const feishuDialog = page.getByRole('dialog', { name: 'Configure Feishu / Lark' });
    expect(await measureSetupLayout(feishuDialog)).toEqual(setupLayout);
    await expect(feishuDialog.locator('footer').getByRole('button', { name: 'View Documentation' })).toBeVisible();
    await feishuDialog.getByRole('button', { name: 'Close' }).click();
    await expect(feishu).toBeFocused();

    const whatsapp = channelsPage.getByRole('button', { name: /WhatsApp/ });
    await whatsapp.click();
    const dialog = page.getByRole('dialog', { name: 'Configure WhatsApp' });
    const footer = dialog.locator('footer');
    expect(await measureSetupLayout(dialog)).toEqual(setupLayout);
    await expect(footer.getByRole('button', { name: 'View Documentation' })).toBeVisible();
    await expect(dialog.getByText(/Linked devices/)).toHaveCount(0);
    await footer.getByRole('button', { name: 'Generate QR Code' }).click();
    await expect(dialog.getByRole('img', { name: 'Scan this QR code with WhatsApp' })).toBeVisible();
    await expect(dialog.getByText(/Linked devices.*Link a device/)).toBeVisible();
    expect(await measureSetupLayout(dialog)).toEqual(setupLayout);
    await expect(footer.getByRole('button', { name: 'Refresh Code' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(whatsapp).toBeFocused();
  });
});
