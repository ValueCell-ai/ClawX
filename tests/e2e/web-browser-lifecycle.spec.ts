import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow } from './fixtures/electron';
import {
  executeInWebBrowserGuest,
  forceCrashWebBrowserGuest,
  getWebBrowserCookieValue,
  getWebBrowserMainSnapshot,
  prepareWebBrowserApp,
  test,
  WEB_BROWSER_E2E_SESSION_KEYS,
  type LocalWebBrowserFixture,
  type WebBrowserMainSnapshot,
} from './fixtures/web-browser';

interface BrowserState {
  formValue: string;
  globalValue: string;
  historyLength: number;
  url: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

async function launchPreparedBrowser(
  launchElectronApp: (options?: { skipSetup?: boolean }) => Promise<ElectronApplication>,
  fixture: LocalWebBrowserFixture,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchElectronApp({ skipSetup: true });
  await prepareWebBrowserApp(app, fixture.workspaceDir);
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return { app, page };
}

async function openWebBrowser(page: Page, app: ElectronApplication): Promise<WebBrowserMainSnapshot> {
  const workspaceButton = page.getByTestId('chat-toolbar-workspace');
  await expect(workspaceButton).toBeEnabled();
  await workspaceButton.click();
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await page.getByTestId('artifact-panel-tab-web-browser').click();
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    url: 'about:blank',
    matchingGuestCount: 1,
    browserWindowCount: 1,
  });
  return await getWebBrowserMainSnapshot(app);
}

async function reopenWebBrowser(page: Page): Promise<void> {
  await page.getByTestId('chat-toolbar-workspace').click();
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await page.getByTestId('artifact-panel-tab-web-browser').click();
  await expect(page.getByTestId('web-browser-webview')).toBeVisible();
}

async function navigateFromAddress(
  page: Page,
  app: ElectronApplication,
  url: string,
  title: string,
): Promise<void> {
  const input = page.getByTestId('web-browser-address-input');
  const display = page.getByTestId('web-browser-address-display');
  if (await display.isVisible()) await display.click();
  await expect(input).toBeVisible();
  await input.fill(url);
  await input.press('Enter');
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    url,
    title,
    matchingGuestCount: 1,
  });
  await expect(display).toBeVisible();
}

async function expectGuestAt(
  app: ElectronApplication,
  expected: Partial<WebBrowserMainSnapshot>,
): Promise<WebBrowserMainSnapshot> {
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject(expected);
  return await getWebBrowserMainSnapshot(app);
}

async function readBrowserState(app: ElectronApplication, guestId: number): Promise<BrowserState> {
  return await executeInWebBrowserGuest<BrowserState>(app, guestId, `({
    formValue: document.querySelector('#lifecycle-state')?.value ?? '',
    globalValue: globalThis.__clawxLifecycleState ?? '',
    historyLength: history.length,
    url: location.href,
  })`);
}

async function expectPersistentBrowserState(
  app: ElectronApplication,
  guestId: number,
  expectedState: BrowserState,
): Promise<void> {
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    guestId,
    url: expectedState.url,
    canGoBack: true,
    matchingGuestCount: 1,
    browserWindowCount: 1,
  });
  await expect.poll(() => readBrowserState(app, guestId)).toEqual(expectedState);
}

async function expectBrowserStateToRemain(
  app: ElectronApplication,
  expected: Partial<WebBrowserMainSnapshot>,
  durationMs: number,
  guestHistory?: { guestId: number; length: number },
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (true) {
    expect(await getWebBrowserMainSnapshot(app)).toMatchObject(expected);
    if (guestHistory) {
      expect(await executeInWebBrowserGuest<number>(app, guestHistory.guestId, 'history.length'))
        .toBe(guestHistory.length);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remainingMs)));
  }
}

async function readRect(locator: Locator): Promise<Rect> {
  return await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

async function expectHostAligned(page: Page, tolerance = 2): Promise<void> {
  const host = page.getByTestId('web-browser-host');
  const anchor = page.getByTestId('web-browser-anchor');
  await expect.poll(async () => {
    const [hostRect, anchorRect] = await Promise.all([readRect(host), readRect(anchor)]);
    return {
      left: Math.abs(hostRect.left - anchorRect.left) <= tolerance,
      top: Math.abs(hostRect.top - anchorRect.top) <= tolerance,
      width: Math.abs(hostRect.width - anchorRect.width) <= tolerance,
      height: Math.abs(hostRect.height - anchorRect.height) <= tolerance,
    };
  }).toEqual({ left: true, top: true, width: true, height: true });
}

test.describe('embedded web browser lifecycle', () => {
  test('preserves one live guest, DOM state, URL, and history across every hiding path', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const initial = await openWebBrowser(page, app);
      const guestId = initial.guestId!;
      await navigateFromAddress(page, app, webBrowserFixture.urls.start, 'Fixture Start');
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.start });
      await navigateFromAddress(page, app, webBrowserFixture.urls.second, 'Fixture Second');
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.second, canGoBack: true });
      await executeInWebBrowserGuest(app, guestId, `
        const input = document.createElement('input');
        input.id = 'lifecycle-state';
        input.value = 'live form state';
        document.body.append(input);
        globalThis.__clawxLifecycleState = 'live global state';
        true;
      `);
      const expectedState = await readBrowserState(app, guestId);
      expect(expectedState).toMatchObject({
        formValue: 'live form state',
        globalValue: 'live global state',
        url: webBrowserFixture.urls.second,
      });
      expect(expectedState.historyLength).toBeGreaterThan(1);

      await page.getByTestId('artifact-panel-tab-changes').click();
      await expect(page.getByTestId('web-browser-host')).toHaveAttribute('aria-hidden', 'true');
      await expectPersistentBrowserState(app, guestId, expectedState);
      await page.getByTestId('artifact-panel-tab-web-browser').click();
      await expectPersistentBrowserState(app, guestId, expectedState);

      await page.getByTestId('artifact-panel').getByRole('button', { name: 'Close' }).click();
      await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
      await expectPersistentBrowserState(app, guestId, expectedState);
      await reopenWebBrowser(page);
      await expectPersistentBrowserState(app, guestId, expectedState);

      await page.getByTestId(`sidebar-session-${WEB_BROWSER_E2E_SESSION_KEYS.secondary}`).click();
      await expect(page.getByTestId(`sidebar-session-${WEB_BROWSER_E2E_SESSION_KEYS.secondary}`))
        .toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('artifact-panel')).toHaveCount(0);
      await expectPersistentBrowserState(app, guestId, expectedState);
      await page.getByTestId(`sidebar-session-${WEB_BROWSER_E2E_SESSION_KEYS.primary}`).click();
      await expect(page.getByTestId(`sidebar-session-${WEB_BROWSER_E2E_SESSION_KEYS.primary}`))
        .toHaveAttribute('aria-current', 'page');
      await reopenWebBrowser(page);
      await expectPersistentBrowserState(app, guestId, expectedState);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();
      await expect(page.getByTestId('web-browser-host')).toHaveAttribute('aria-hidden', 'true');
      await expectPersistentBrowserState(app, guestId, expectedState);
      await page.getByTestId(`sidebar-session-${WEB_BROWSER_E2E_SESSION_KEYS.primary}`).click();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await reopenWebBrowser(page);
      await expectPersistentBrowserState(app, guestId, expectedState);
      await expect(page.getByTestId('web-browser-back')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the host aligned after panel drag and native BrowserWindow resize', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      await openWebBrowser(page, app);
      await expectHostAligned(page);

      const initialAnchor = await readRect(page.getByTestId('web-browser-anchor'));
      const divider = page.getByRole('separator', { name: 'Drag to resize width' });
      const dividerBounds = await divider.boundingBox();
      if (!dividerBounds) throw new Error('Artifact panel divider has no bounds');
      await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + dividerBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(dividerBounds.x - 120, dividerBounds.y + dividerBounds.height / 2, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await readRect(page.getByTestId('web-browser-anchor'))).width)
        .toBeGreaterThan(initialAnchor.width + 80);
      await expectHostAligned(page);

      const previousViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const [width, height] = window.getSize();
        window.setSize(Math.max(width - 140, 900), Math.max(height - 90, 650), false);
      });
      await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
        .not.toEqual(previousViewport);
      await expectHostAligned(page);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('removes a crashed guest before attaching one replacement and restores only its URL', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    // Electron's webview support is unstable on Linux.
    test.skip(process.platform !== 'win32' && process.platform !== 'darwin');

    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId: oldGuestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, app, webBrowserFixture.urls.start, 'Fixture Start');
      await expectGuestAt(app, { guestId: oldGuestId, url: webBrowserFixture.urls.start });
      await navigateFromAddress(page, app, webBrowserFixture.urls.second, 'Fixture Second');
      const beforeCrash = await expectGuestAt(app, {
        guestId: oldGuestId,
        url: webBrowserFixture.urls.second,
        canGoBack: true,
      });

      await forceCrashWebBrowserGuest(app, oldGuestId!);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
        guestId: null,
        matchingGuestCount: 0,
        browserWindowCount: 1,
      });

      await page.getByRole('alert').getByRole('button').click();
      const replacement = await expectGuestAt(app, {
        url: webBrowserFixture.urls.second,
        canGoBack: false,
        canGoForward: false,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });
      expect(replacement.guestId).not.toBe(oldGuestId);
      expect(beforeCrash.canGoBack).toBe(true);
      await expect(page.getByTestId('web-browser-back')).toBeDisabled();
      expect(await executeInWebBrowserGuest<number>(app, replacement.guestId!, 'history.length')).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('persists partition cookies but not guest creation, URL, or history across relaunch', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    let app: ElectronApplication | null = null;
    try {
      ({ app } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture));
      let page = await getStableWindow(app);
      const { guestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, app, webBrowserFixture.urls.storage, 'Storage Fixture');
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.storage });
      await navigateFromAddress(page, app, webBrowserFixture.urls.second, 'Fixture Second');
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.second, canGoBack: true });
      await expect.poll(() => getWebBrowserCookieValue(app!, webBrowserFixture.urls.storage, 'fixture')).toBe('cookie');

      await closeElectronApp(app);
      app = null;

      ({ app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture));
      await expectBrowserStateToRemain(app, {
        guestId: null,
        url: null,
        canGoBack: false,
        canGoForward: false,
        matchingGuestCount: 0,
        browserWindowCount: 1,
      }, 1_500);
      await expect(getWebBrowserCookieValue(app, webBrowserFixture.urls.storage, 'fixture')).resolves.toBe('cookie');

      const relaunched = await openWebBrowser(page, app);
      const stableRelaunchState = {
        guestId: relaunched.guestId,
        url: 'about:blank',
        canGoBack: false,
        canGoForward: false,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      };
      expect(relaunched).toMatchObject(stableRelaunchState);
      await expectBrowserStateToRemain(app, stableRelaunchState, 1_500, {
        guestId: relaunched.guestId!,
        length: 1,
      });
    } finally {
      if (app) await closeElectronApp(app);
    }
  });
});
