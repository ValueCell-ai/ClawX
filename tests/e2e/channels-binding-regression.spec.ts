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

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
      }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (globalThis as any).__clawxE2eBindingRegression as typeof state;

        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: current.channels });
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: current.agents });
        }
        if (request?.module === 'channels' && request.action === 'validateCredentials') {
          return respond(request.id, { success: true, valid: true, warnings: [] });
        }
        if (request?.module === 'channels' && request.action === 'saveConfig') {
          current.saveCount += 1;
          const body = request.payload ?? {};
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
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'bindingSave') {
          current.bindingCount += 1;
          const body = request.payload ?? {};
          if (body.channelType === 'feishu' && body.accountId) {
            const feishu = current.channels[0];
            const account = feishu.accounts.find((entry) => entry.accountId === body.accountId);
            if (account) {
              account.agentId = body.agentId;
            }
          }
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'bindingDelete') {
          current.bindingCount += 1;
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'formValues') {
          return respond(request.id, { success: true, values: {} });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();

    const feishuGroupHeader = page.locator('div.rounded-2xl').filter({ hasText: 'Feishu / Lark' }).first();
    await expect(feishuGroupHeader).toContainText(/Connected|已连接|接続済み|Подключён/);

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
