import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Channels binding regression', () => {
  test('keeps newly added non-default Feishu accounts unassigned until the user binds an agent', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        nextAccountId: 'feishu-a1b2c3d4',
        saveCount: 0,
        bindingCount: 0,
        channels: [
          {
            channelType: 'feishu',
            defaultAccountId: 'default',
            status: 'connected',
            accounts: [
              {
                accountId: 'default',
                name: 'Primary Account',
                configured: true,
                status: 'connected',
                isDefault: true,
                agentId: 'main',
              },
            ],
          },
        ],
        agents: [
          { id: 'main', name: 'Main Agent' },
          { id: 'code', name: 'Code Agent' },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eBindingRegression = state;

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string; body?: string }) => {
        const method = request?.method ?? 'GET';
        const path = request?.path ?? '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (globalThis as any).__clawxE2eBindingRegression as typeof state;

        if (path === '/api/channels/accounts' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, channels: current.channels } } };
        }
        if (path === '/api/agents' && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, agents: current.agents } } };
        }
        if (path === '/api/channels/credentials/validate' && method === 'POST') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, valid: true, warnings: [] } } };
        }
        if (path === '/api/channels/config' && method === 'POST') {
          current.saveCount += 1;
          const body = JSON.parse(request?.body ?? '{}') as { accountId?: string };
          const accountId = body.accountId || current.nextAccountId;
          const feishu = current.channels[0];
          if (!feishu.accounts.some((account) => account.accountId === accountId)) {
            feishu.accounts.push({
              accountId,
              name: accountId,
              configured: true,
              status: 'connected',
              isDefault: false,
            });
          }
          return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
        }
        if (path === '/api/channels/binding' && method === 'PUT') {
          current.bindingCount += 1;
          const body = JSON.parse(request?.body ?? '{}') as { channelType?: string; accountId?: string; agentId?: string };
          if (body.channelType === 'feishu' && body.accountId) {
            const feishu = current.channels[0];
            const account = feishu.accounts.find((entry) => entry.accountId === body.accountId);
            if (account) {
              account.agentId = body.agentId;
            }
          }
          return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
        }
        if (path === '/api/channels/binding' && method === 'DELETE') {
          current.bindingCount += 1;
          return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
        }
        if (path.startsWith('/api/channels/config/') && method === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, values: {} } } };
        }

        return {
          ok: false,
          error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` },
        };
      });
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();

    await page.getByRole('button', { name: /Add Account|添加账号|アカウントを追加/ }).click();
    await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeVisible();

    const accountIdInput = page.locator('#account-id');
    const newAccountId = await accountIdInput.inputValue();
    await expect(accountIdInput).toHaveValue(/feishu-/);
    await page.locator('#appId').fill('cli_test');
    await page.locator('#appSecret').fill('secret_test');

    await page.getByRole('button', { name: /Save & Connect|dialog\.saveAndConnect/ }).click();
    await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeHidden();

    const newAccountRow = page.locator('div.rounded-xl').filter({ hasText: newAccountId }).first();
    await expect(newAccountRow).toBeVisible();
    const bindingSelect = newAccountRow.locator('select');
    await expect(bindingSelect).toHaveValue('');

    await bindingSelect.selectOption('code');
    await expect(bindingSelect).toHaveValue('code');

    const counters = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (globalThis as any).__clawxE2eBindingRegression as { saveCount: number; bindingCount: number };
      return { saveCount: state.saveCount, bindingCount: state.bindingCount };
    });

    expect(counters.saveCount).toBe(1);
    expect(counters.bindingCount).toBe(1);
  });
});
