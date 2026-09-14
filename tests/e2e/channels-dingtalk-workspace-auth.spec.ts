import { completeSetup, expect, test } from './fixtures/electron';

const responses = {
  channels: { success: true, channels: [] },
  agents: { success: true, agents: [] },
  validation: { success: true, valid: true, warnings: [] },
};

test.describe('DingTalk workspace authorization', () => {
  test('offers browser OAuth after saving a new DingTalk bot', async ({ electronApp, page }) => {
    // Wait for Main initialization before replacing host:invoke; otherwise the
    // production handler can race this fixture and overwrite it.
    await completeSetup(page);
    await electronApp.evaluate(({ ipcMain }, fixtures) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxDingTalkWorkspaceAuth = {
        statusCalls: 0,
        startCalls: 0,
        openedUrl: null,
        authorized: false,
      };
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
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'dingtalkWorkspaceAuthStatus') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const state = (globalThis as any).__clawxDingTalkWorkspaceAuth;
          state.statusCalls += 1;
          return respond(request.id, {
            success: true,
            status: state.statusCalls === 1
              ? 'needs_auth'
              : state.authorized ? 'authorized' : 'pending',
          });
        }
        if (request?.module === 'channels' && request.action === 'dingtalkWorkspaceAuthStart') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxDingTalkWorkspaceAuth.startCalls += 1;
          return respond(request.id, {
            success: true,
            status: 'pending',
            verificationUriComplete: 'https://login.dingtalk.com/oauth2/auth?client_id=ding-client-id&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback',
            expiresAt: Date.now() + 600_000,
          });
        }
        if (request?.module === 'shell' && request.action === 'openExternal') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).__clawxDingTalkWorkspaceAuth.openedUrl = (request.payload as { url?: string })?.url;
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'dingtalkWorkspaceAuthCancel') {
          return respond(request.id, { success: true, status: 'needs_auth' });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, responses);

    await page.getByTestId('sidebar-nav-channels').click();
    await page.getByTestId('channels-page').getByRole('button', { name: /DingTalk/ }).click();

    await page.locator('#clientId').fill('ding-client-id');
    await page.locator('#clientSecret').fill('ding-client-secret');
    await page.getByRole('button', { name: /Save & Connect|dialog\.saveAndConnect/i }).click();

    await expect.poll(async () => electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (globalThis as any).__clawxDingTalkWorkspaceAuth;
      return { statusCalls: state.statusCalls, startCalls: state.startCalls };
    })).toEqual({ statusCalls: 1, startCalls: 1 });
    await expect(page.getByTestId('dingtalk-workspace-auth')).toBeVisible();
    await expect(page.getByTestId('dingtalk-workspace-code')).toHaveCount(0);
    await page.getByRole('button', { name: /Open DingTalk Authorization|dialog\.dingtalkWorkspaceAuthOpen/i }).click();
    await expect.poll(async () => electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).__clawxDingTalkWorkspaceAuth.openedUrl;
    })).toBe('https://login.dingtalk.com/oauth2/auth?client_id=ding-client-id&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback');

    await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxDingTalkWorkspaceAuth.authorized = true;
    });
    await expect(page.getByTestId('dingtalk-workspace-auth')).not.toBeVisible({ timeout: 8_000 });
  });
});
