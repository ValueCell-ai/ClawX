import { completeSetup, expect, test } from './fixtures/electron';

test.describe('DingTalk multi-account lifecycle', () => {
  test('persists a second dingtalk account without replacing the existing one', async ({ electronApp, page }) => {
    await electronApp.evaluate(async () => {
      const { mkdir, writeFile } = process.mainModule!.require('fs/promises') as typeof import('fs/promises');
      const { join } = process.mainModule!.require('path') as typeof import('path');

      const openclawDir = join(process.env.HOME!, '.openclaw');
      await mkdir(openclawDir, { recursive: true });
      await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
        channels: {
          dingtalk: {
            enabled: true,
            defaultAccount: 'default',
            clientId: 'dt-main',
            clientSecret: 'secret-main',
            accounts: {
              default: {
                clientId: 'dt-main',
                clientSecret: 'secret-main',
                enabled: true,
              },
            },
          },
        },
      }, null, 2), 'utf8');
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'DingTalk' })).toBeVisible();

    const dingtalkCard = page.locator('div.rounded-2xl').filter({
      has: page.getByRole('heading', { name: 'DingTalk' }),
    }).first();
    await expect(dingtalkCard.locator('button').first()).toBeVisible();

    await dingtalkCard.locator('button').first().click();
    await expect(page.locator('#account-id')).toBeVisible();

    await page.locator('#account-id').fill('sales');
    await page.locator('#clientId').fill('dt-sales');
    await page.locator('#clientSecret').fill('secret-sales');
    await page.locator('div.fixed.inset-0 button').last().click();

    await expect(page.locator('#account-id')).toHaveCount(0);
    await expect(page.getByText('sales')).toBeVisible();

    const persisted = await electronApp.evaluate(async () => {
      const { readFile } = process.mainModule!.require('fs/promises') as typeof import('fs/promises');
      const { join } = process.mainModule!.require('path') as typeof import('path');
      const raw = await readFile(join(process.env.HOME!, '.openclaw', 'openclaw.json'), 'utf8');
      return JSON.parse(raw) as {
        channels?: {
          dingtalk?: {
            defaultAccount?: string;
            clientId?: string;
            clientSecret?: string;
            accounts?: Record<string, { clientId?: string; clientSecret?: string; enabled?: boolean }>;
          };
        };
      };
    });

    expect(persisted.channels?.dingtalk?.defaultAccount).toBe('default');
    expect(persisted.channels?.dingtalk?.clientId).toBe('dt-main');
    expect(persisted.channels?.dingtalk?.clientSecret).toBe('secret-main');
    expect(persisted.channels?.dingtalk?.accounts).toEqual({
      default: {
        clientId: 'dt-main',
        clientSecret: 'secret-main',
        enabled: true,
      },
      sales: {
        clientId: 'dt-sales',
        clientSecret: 'secret-sales',
        enabled: true,
      },
    });
  });
});
