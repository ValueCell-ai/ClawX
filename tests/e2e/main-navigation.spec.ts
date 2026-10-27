import type { ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { E2E_EXCLUSIVE_TAG } from './parallel-policy';

async function readNativeMenuLabels(app: ElectronApplication) {
  return await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const fileMenu = menu?.items.find((item) => item.label === '文件' || item.label === 'File');
    return {
      topLevel: menu?.items.map((item) => item.label) ?? [],
      file: fileMenu?.label,
      newChat: fileMenu?.submenu?.items.find((item) => item.id === 'new-chat' || item.label === 'New Chat' || item.label === '新对话')?.label,
    };
  });
}

async function pressNativeNewChatShortcut(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  if (process.platform === 'linux') {
    try {
      await promisify(execFile)('xdotool', ['key', '--clearmodifiers', 'ctrl+n']);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  // Playwright's CDP keyboard dispatch bypasses Electron's native menu and
  // before-input-event on Linux. Without OS input tooling, exercise the native
  // accelerator with Electron key input rather than clicking the menu item.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers });
  });
}

test.describe('ClawX main navigation without setup flow', () => {
  test('keeps reload menu commands without application accelerators', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const reloadItems = await app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu();
        const findById = (items: Electron.MenuItem[], id: string): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.id === id) return item;
            const child = item.submenu ? findById(item.submenu.items, id) : undefined;
            if (child) return child;
          }
          return undefined;
        };
        return ['reload', 'force-reload'].map((id) => {
          const item = menu ? findById(menu.items, id) : undefined;
          return { id: item?.id, label: item?.label, accelerator: item?.accelerator };
        });
      });

      expect(reloadItems).toEqual([
        { id: 'reload', label: expect.any(String), accelerator: null },
        { id: 'force-reload', label: expect.any(String), accelerator: null },
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('main-content')).toBeVisible();
      await expect(page.getByTestId('sidebar-resize-handle')).toBeVisible();
      await expect(page.getByTestId('main-content')).toHaveCSS('border-top-left-radius', '16px');

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('native New Chat menu opens the same chat route as the sidebar action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      await app.evaluate(({ BrowserWindow, Menu }) => {
        const menu = Menu.getApplicationMenu();
        const findMenuItem = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.id === 'new-chat') return item;
            const child = item.submenu ? findMenuItem(item.submenu.items) : undefined;
            if (child) return child;
          }
          return undefined;
        };
        const newChatItem = menu ? findMenuItem(menu.items) : undefined;
        newChatItem?.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined);
      });

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('New Chat keyboard shortcut keeps one usable main window', { tag: E2E_EXCLUSIVE_TAG }, async ({ launchElectronApp, homeDir }) => {
    await mkdir(join(homeDir, '.openclaw', 'workspace'), { recursive: true });
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible();
      const mainWindowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
      const composer = page.getByTestId('chat-composer-input');
      await composer.fill('Draft before the shortcut');

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await pressNativeNewChatShortcut(app);

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
      await expect(composer).toHaveValue('');
      expect(await page.evaluate(() => window.open('about:blank') === null)).toBe(true);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.id))).toEqual([mainWindowId]);

      await composer.fill('Draft before recovering a blank window');
      await app.evaluate(({ BrowserWindow }) => {
        // Exercise recovery if a native path bypasses the popup deny handlers.
        new BrowserWindow({ show: false });
      });
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.id))).toEqual([mainWindowId]);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(mainWindowId);
      await expect(composer).toHaveValue('Draft before recovering a blank window');
      await composer.click();
      await pressNativeNewChatShortcut(app);
      await expect(composer).toHaveValue('');
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.id))).toEqual([mainWindowId]);
      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('refreshes native menu labels after switching language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByRole('button', { name: 'English' }).click();
      await page.getByRole('button', { name: '中文' }).click();

      await expect(page.getByText('菜单语言已更新')).toBeVisible();
      await expect.poll(() => readNativeMenuLabels(app)).toMatchObject({
        file: '文件',
        newChat: '新对话',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
