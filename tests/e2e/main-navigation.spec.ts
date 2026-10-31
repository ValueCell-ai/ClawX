import { navigateToSection } from './fixtures/navigation';
import { expectQuietFieldFocus } from './fixtures/field-focus';
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
      newChat: fileMenu?.submenu?.items.find((item) => item.id === 'new-chat' || item.label === 'New task' || item.label === '新任务')?.label,
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
  await pressElectronNewChatShortcut(app);
}

async function pressElectronNewChatShortcut(app: ElectronApplication) {
  // CDP keyboard dispatch bypasses Electron's before-input-event. Electron key
  // input reaches that handler even on macOS, where it may bypass NSMenu.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.focus();
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers });
  });
}

test.describe('ClawX main navigation without setup flow', () => {
  test('keeps the brand readable and sidebar controls accessible in both themes', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const sidebar = page.getByTestId('sidebar');
      const brand = page.getByTestId('sidebar-brand');
      const wordmark = page.getByTestId('sidebar-wordmark');
      const toggle = page.getByTestId('sidebar-collapse-toggle');
      const brandColors: string[] = [];

      for (const theme of ['Light', 'Dark']) {
        await navigateToSection(page, 'general');
        await page.getByRole('button', { name: theme, exact: true }).click();
        await page.setViewportSize({ width: theme === 'Light' ? 1280 : 900, height: 800 });
        await page.getByTestId('sidebar-new-chat').click();
        await page.mouse.move(400, 400);
        const newTask = page.getByTestId('sidebar-new-chat');
        await expect(newTask).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        const idleNavigation = page.getByTestId('sidebar-nav-models');
        for (const property of ['border-top-width', 'border-radius', 'padding-top', 'color']) {
          const expected = await idleNavigation.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
          await expect(newTask).toHaveCSS(property, expected);
        }
        await page.getByTestId('sidebar-search-toggle').click();
        const search = page.getByTestId('sidebar-task-search');
        await expect(search).toBeFocused();
        await expectQuietFieldFocus(search);
        const searchBounds = await search.boundingBox();
        const sidebarBounds = await sidebar.boundingBox();
        expect(searchBounds!.height).toBeLessThanOrEqual(28);
        expect(searchBounds!.width).toBeLessThanOrEqual(sidebarBounds!.width - 32);
        await search.press('Escape');

        await expect(brand).toHaveAccessibleName('ClawX');
        await expect(wordmark).toBeVisible();
        // A visible mask container can still be blank if its shipped asset fails
        // to load. Check the actual asset in the Electron renderer too.
        expect(await wordmark.evaluate(async element => {
          const source = getComputedStyle(element).maskImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
          if (!source) return false;
          const image = new Image();
          image.src = source;
          await image.decode();
          return image.naturalWidth >= 304 && image.naturalHeight > 0;
        })).toBe(true);
        await expect(toggle).toHaveAccessibleName('Collapse sidebar');
        const brandBox = await brand.boundingBox();
        const toggleBox = await toggle.boundingBox();
        expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(toggleBox!.x);
        brandColors.push(await wordmark.evaluate(element => getComputedStyle(element).color));
        await page.getByTestId('sidebar-brand-header').screenshot({ path: testInfo.outputPath(`brand-${theme.toLowerCase()}.png`) });

        // Keyboard users can still find the expansion control when the logo
        // visually replaces the icon in the collapsed rail.
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveAccessibleName('Expand sidebar');
        await expect(brand).toHaveCount(0);
        await expect(page.getByTestId('sidebar-collapsed-logo')).toBeAttached();
        await expect(sidebar).toHaveCSS('width', '68px');
        await page.keyboard.press('Tab');
        await page.mouse.move(400, 400);
        await expect(page.getByTestId('sidebar-collapsed-logo')).toHaveCSS('opacity', '1');
        await sidebar.screenshot({ path: testInfo.outputPath(`brand-${theme.toLowerCase()}-collapsed.png`), animations: 'disabled' });

        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(wordmark).toBeVisible();
        await expect(page).toHaveURL(/#\/$/);
      }
      expect(brandColors[0]).not.toBe(brandColors[1]);
    } finally {
      await closeElectronApp(app);
    }
  });

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

      await navigateToSection(page, 'models');
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      await navigateToSection(page, 'agents');
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await navigateToSection(page, 'channels');
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

      await navigateToSection(page, 'models');
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

  test('Electron key input opens New Chat without the menu accelerator', async ({ launchElectronApp, homeDir }) => {
    await mkdir(join(homeDir, '.openclaw', 'workspace'), { recursive: true });
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible();
      const composer = page.getByTestId('chat-composer-input');
      await composer.fill('Draft before Electron key input');
      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      // Isolate the before-input-event path from native menu acceleration.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.setIgnoreMenuShortcuts(true);
      });
      await pressElectronNewChatShortcut(app);

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
      await expect(composer).toHaveValue('');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
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
        newChat: '新任务',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
