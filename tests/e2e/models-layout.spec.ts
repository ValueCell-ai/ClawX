import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test('model tabs share icon hierarchy and usage rows remain compact with pagination', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      hostApi: {
        '["/api/settings","GET"]': { language: 'en', setupComplete: true, devModeUnlocked: true, theme: 'light' },
      },
    });
    await app.evaluate(async () => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      type Request = { id: string; module: string; action: string };
      const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', (event, request: Request) => {
        if (request.module === 'usage' && request.action === 'recentTokenHistory') {
          return { id: request.id, ok: true, data: Array.from({ length: 6 }, (_, index) => ({
            sessionId: `layout-session-${index}`, timestamp: new Date(Date.now() - index * 60000).toISOString(),
            model: `test-model-${index}`, provider: 'Test', agentId: 'main', inputTokens: 120, outputTokens: 30,
            cacheReadTokens: 10, cacheWriteTokens: 5, totalTokens: 165, costUsd: 0.0123,
            usageStatus: index === 1 ? 'missing' : index === 2 ? 'error' : 'available',
          })) };
        }
        return original(event, request);
      });
    });
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId('sidebar-nav-models').click();
    for (const tab of ['chat', 'voice', 'image-generation']) {
      await expect(page.getByTestId(`models-tab-${tab}`).locator('svg')).toBeVisible();
    }
    const table = page.getByTestId('token-usage-table');
    await expect(table).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Loading token usage history...', { exact: true })).toHaveCount(0);
    await expect(table.getByRole('columnheader', { name: 'Cache read', exact: true })).toBeVisible();
    const rows = table.getByTestId('token-usage-entry');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('$0.0123');
    await expect(rows.nth(1)).toContainText('—');
    await expect(rows.nth(2)).toContainText('✕');
    expect((await rows.first().boundingBox())!.height).toBeLessThan(80);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('test-model-5');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('models-table.png'), fullPage: true });
    for (const [tab, title, field] of [
      ['voice', 'asr-settings-title', 'asr-base-url-input'],
      ['image-generation', 'image-generation-settings-title', 'image-generation-relay-base-url'],
    ]) {
      await page.getByTestId(`models-tab-${tab}`).click();
      await expect(page.getByTestId(title).locator('svg')).toBeVisible();
      await expect(page.getByTestId(field)).toBeVisible();
      await expect(table).toHaveCount(0);
    }
    await page.setViewportSize({ width: 900, height: 650 });
    await page.getByTestId('models-tab-chat').click();
    await expect(table).toBeVisible();
    expect(await table.evaluate(el => el.parentElement!.scrollWidth > el.parentElement!.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('models-table-narrow.png'), fullPage: true });
  } finally {
    await closeElectronApp(app);
  }
});
