import { navigateToSection } from './fixtures/navigation';
import { completeSetup, expect, test } from './fixtures/electron';

const responses = {
  channels: { success: true, channels: [] },
  agents: { success: true, agents: [] },
  validation: {
    success: true,
    valid: false,
    errors: ['App Secret is identical to App ID.'],
    errorCodes: [{ code: 'feishuAppSecretEqualsAppId' }],
    warnings: [],
  },
};

test.describe('Feishu credential validation', () => {
  test('blocks the save and shows a localized error when Feishu rejects the credentials', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, fixtures) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxFeishuValidationPayload = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxFeishuSavePayload = null;
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxFeishuValidationPayload = request.payload;
          return respond(request.id, fixtures.validation);
        }
        if (request?.module === 'channels' && request.action === 'saveConfig') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxFeishuSavePayload = request.payload;
          return respond(request.id, { success: true, activationPending: true });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, responses);

    await completeSetup(page);
    await navigateToSection(page, 'channels');

    const channelsPage = page.getByTestId('channels-page');
    await expect(channelsPage).toBeVisible();
    const opener = channelsPage.getByRole('button', { name: /Feishu/ });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Configure Feishu / Lark' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await opener.click();
    const appId = dialog.locator('#appId');
    const appSecret = dialog.locator('#appSecret');
    await dialog.getByRole('button', { name: 'Validate Configuration' }).click();
    await expect(appId).toBeFocused();
    await expect(appId).toHaveAccessibleDescription('App ID is required.');
    await expect(appSecret).toHaveAccessibleDescription('App Secret is required.');
    expect(await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxFeishuValidationPayload;
    })).toBeNull();
    await dialog.getByRole('button', { name: 'Validate Configuration' }).focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

    await appId.fill('cli_a8cf7d97fbb8d00d');
    await appSecret.fill('cli_a8cf7d97fbb8d00d');
    await expect(appId).not.toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('button', { name: 'Save & Connect' }).click();

    await expect(
      page.getByText(/identical to App ID|与 App ID 相同|App ID と同一|совпадает с App ID/),
    ).toBeVisible();
    await expect.poll(async () => electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxFeishuValidationPayload;
    })).toEqual({
      channelType: 'feishu',
      config: {
        appId: 'cli_a8cf7d97fbb8d00d',
        appSecret: 'cli_a8cf7d97fbb8d00d',
      },
    });
    expect(await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxFeishuSavePayload;
    })).toBeNull();
    // The modal stays open so the user can correct the App Secret.
    await expect(page.locator('#appSecret')).toBeVisible();
  });
});
