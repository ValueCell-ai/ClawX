import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const main = 'agent:main:main';
const needle = 'agent:main:task-8';
const code = 'agent:code:report';

async function installTasks(app: ElectronApplication, workspace: string, second: string) {
  const sessions = [
    { key: main, displayName: 'Control task', workspacePath: workspace, updatedAt: Date.now() },
    ...Array.from({ length: 9 }, (_, index) => ({
      key: `agent:main:task-${index}`, displayName: index === 8 ? 'Needle report' : `Planning task ${index}`,
      workspacePath: workspace, updatedAt: Date.now() - (index + 1) * 60_000,
      status: index === 7 ? 'failed' : index === 6 ? 'running' : 'done',
    })),
    { key: code, displayName: 'Release checklist', workspacePath: second, updatedAt: Date.now() - 800_000 },
  ];
  const list = { success: true, result: { sessions } };
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 42, connectedAt: 1 },
    gatewayRpc: {
      '["sessions.subscribe",{}]': { success: true, result: {} },
      '["sessions.list",{"includeDerivedTitles":true,"includeLastMessage":true}]': list,
      '["sessions.list",{}]': list,
    },
    hostApi: {
      '["agents","list",null]': { success: true, agents: [
        { id: 'main', name: 'Main assistant', isDefault: true, workspace },
        { id: 'code', name: 'Coding helper', workspace: second },
      ], defaultAgentId: 'main' },
      [JSON.stringify(['sessions', 'summaries', { sessionKeys: sessions.map((s) => s.key) }])]: {
        success: true, summaries: sessions.map((s) => ({ sessionKey: s.key, firstUserText: s.displayName, workspacePath: s.workspacePath })),
      },
      '["sessions","delete",{"id":"agent:main:task-8"}]': { success: true },
      '["sessions","rename",{"id":"agent:main:task-8","title":"Updated pinned task"}]': { success: true },
    },
  });
  await app.evaluate(({ ipcMain }) => {
    type Request = { id: string; module: string; action: string };
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => unknown> })._invokeHandlers.get('host:invoke')!;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', (event, request: Request) => {
      if (request.module === 'chat' && request.action === 'loadAcpSession') return { id: request.id, ok: true, data: { success: true, generation: 1 } };
      return original(event, request);
    });
  });
}
async function pinnedKeys(page: Page) {
  const result = await page.evaluate(() => window.clawx.hostInvoke({ id: 'read-pins', module: 'settings', action: 'get', payload: { key: 'pinnedSessionKeys' } }));
  return result.data;
}
async function menu(page: Page, key: string) {
  await page.getByTestId(`sidebar-session-${key}`).hover();
  await page.getByTestId(`sidebar-session-menu-${key}`).click();
}

test('searches beyond pagination and collapsed workspaces, persists pins through relaunch and cleans deletion', async ({ launchElectronApp, homeDir }, testInfo) => {
  const workspace = path.join(homeDir, 'reports');
  const second = path.join(homeDir, 'release-project');
  await mkdir(workspace, { recursive: true });
  await mkdir(second, { recursive: true });
  let app = await launchElectronApp({ skipSetup: true });
  try {
    await installTasks(app, workspace, second);
    let page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId(`sidebar-session-${main}`)).toBeVisible();
    await page.getByTestId('chat-composer-input').fill('Keep this unsent draft');
    const ordinaryKey = 'agent:main:task-0';
    const ordinaryRow = page.getByTestId(`sidebar-session-${ordinaryKey}`).locator('..');
    const ordinaryTime = page.getByTestId(`sidebar-session-time-${ordinaryKey}`);
    const ordinaryActions = page.getByTestId(`sidebar-session-menu-${ordinaryKey}`);
    await page.mouse.move(600, 80);
    await expect(ordinaryTime).toBeVisible();
    await expect(ordinaryActions).toHaveCSS('opacity', '0');
    await expect(ordinaryActions).toHaveCSS('pointer-events', 'none');
    const rowBounds = await ordinaryRow.boundingBox();
    const timeBounds = await ordinaryTime.boundingBox();
    // The invisible menu trigger must not leave a button-width gap after timeago.
    expect(Math.abs(rowBounds!.x + rowBounds!.width - timeBounds!.x - timeBounds!.width)).toBeLessThanOrEqual(1);
    await ordinaryRow.screenshot({ path: testInfo.outputPath('task-row-idle.png') });
    await ordinaryRow.hover();
    await expect(ordinaryActions).toHaveCSS('opacity', '1');
    await expect(ordinaryTime).toBeHidden();
    await ordinaryRow.screenshot({ path: testInfo.outputPath('task-row-hover.png') });
    await ordinaryActions.click();
    await expect(page.getByRole('menuitem', { name: 'Pin task', exact: true })).toBeVisible();
    await page.mouse.move(600, 80);
    await expect(ordinaryActions).toHaveCSS('opacity', '1');
    await expect(ordinaryTime).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(ordinaryActions).toBeFocused();
    await page.getByTestId('chat-composer-input').focus();
    await expect(ordinaryTime).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-${needle}`)).toHaveCount(0);
    await page.getByTestId('session-list-toggle-all').click();
    await page.getByTestId('sidebar-search-toggle').click();
    const search = page.getByTestId('sidebar-task-search');
    await search.fill('Planning task 7');
    await expect(page.getByTestId('sidebar-session-failed-agent:main:task-7')).toBeVisible();
    await search.fill('Planning task 6');
    await expect(page.getByTestId('sidebar-session-busy-agent:main:task-6')).toBeVisible();
    await search.fill('needle');
    await expect(page.getByTestId(`sidebar-session-${needle}`)).toBeVisible();
    await expect(page.getByTestId('sidebar-search-count')).toContainText('1');
    await page.getByTestId(`sidebar-session-menu-${needle}`).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Pin task', exact: true }).press('Enter');
    await expect(page.getByTestId('sidebar-pinned-tasks').getByTestId(`sidebar-session-${needle}`)).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-${needle}`)).toHaveCount(1);
    await expect.poll(() => pinnedKeys(page)).toEqual([needle]);
    await expect(page.getByTestId(`sidebar-session-menu-${needle}`)).toBeFocused();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Keep this unsent draft');
    await search.fill('');
    await menu(page, needle);
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Session title' }).fill('Updated pinned task');
    await page.getByRole('textbox', { name: 'Session title' }).press('Enter');
    await expect(page.getByTestId(`sidebar-session-${needle}`)).toContainText('Updated pinned task');
    await expect.poll(() => pinnedKeys(page)).toEqual([needle]);
    await search.fill('coding release');
    await expect(page.getByTestId(`sidebar-session-${code}`)).toBeVisible();
    await search.fill('nothing-matches');
    await expect(page.getByText('No matching tasks', { exact: true })).toBeVisible();
    await search.press('Escape');
    await expect(page.getByTestId('sidebar-task-search')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-search-toggle')).toBeFocused();
    await page.getByTestId('sidebar-collapse-toggle').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByTestId('sidebar-task-search')).toBeFocused();
    await page.getByTestId('sidebar-task-search').press('Escape');
    await page.screenshot({ path: testInfo.outputPath('pinned-sidebar.png'), animations: 'disabled' });

    await closeElectronApp(app);
    app = await launchElectronApp({ skipSetup: true });
    await installTasks(app, workspace, second);
    page = await getStableWindow(app);
    await page.reload();
    await expect(page.getByTestId('sidebar-pinned-tasks').getByTestId(`sidebar-session-${needle}`)).toBeVisible();
    await expect.poll(() => pinnedKeys(page)).toEqual([needle]);
    // Temporary catalog gaps must not erase the durable preference.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:status-changed', { state: 'stopped', port: 18789 });
    });
    await expect.poll(() => pinnedKeys(page)).toEqual([needle]);
    await menu(page, needle);
    await page.getByTestId(`sidebar-session-pin-${needle}`).click();
    await expect.poll(() => pinnedKeys(page)).toEqual([]);
    // A task that returns to a paginated group remains discoverable via search.
    await page.getByTestId('sidebar-search-toggle').click();
    await page.getByTestId('sidebar-task-search').fill('needle');
    await menu(page, needle);
    await page.getByTestId(`sidebar-session-pin-${needle}`).click();
    await expect.poll(() => pinnedKeys(page)).toEqual([needle]);
    await menu(page, needle);
    await page.getByTestId(`sidebar-session-delete-${needle}`).click();
    await page.getByTestId('confirm-dialog-confirm-button').click();
    await expect.poll(() => pinnedKeys(page)).toEqual([]);
    await expect(page.getByTestId(`sidebar-session-${needle}`)).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});
