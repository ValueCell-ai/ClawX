import type { ElectronApplication, Page } from '@playwright/test';
import { WEB_BROWSER_USER_AGENT } from '../../shared/web-browser';
import { closeElectronApp, expect, getStableWindow } from './fixtures/electron';
import {
  executeInWebBrowserGuest,
  executeInWebBrowserGuestAndWaitForLoad,
  getWebBrowserMainSnapshot,
  getWebBrowserShellCalls,
  prepareWebBrowserApp,
  test,
  type LocalWebBrowserFixture,
  type WebBrowserMainSnapshot,
} from './fixtures/web-browser';

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
  await page.getByTestId('chat-toolbar-workspace').click();
  const panel = page.getByTestId('artifact-panel');
  await expect(panel).toBeVisible();
  await panel.getByTestId('artifact-panel-tab-web-browser').click();
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    url: 'about:blank',
    matchingGuestCount: 1,
    browserWindowCount: 1,
  });
  await expect(page.getByTestId('web-browser-address-input')).toBeFocused();
  return await getWebBrowserMainSnapshot(app);
}

async function navigateFromAddress(page: Page, url: string): Promise<void> {
  const input = page.getByTestId('web-browser-address-input');
  if (await input.count() === 0) {
    await page.getByTestId('web-browser-address-display').click();
  }
  await page.getByTestId('web-browser-address-input').fill(url);
  await page.getByTestId('web-browser-address-input').focus();
  await page.keyboard.press('Enter');
}

async function expectGuestAt(
  app: ElectronApplication,
  expected: Partial<WebBrowserMainSnapshot>,
): Promise<WebBrowserMainSnapshot> {
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject(expected);
  return await getWebBrowserMainSnapshot(app);
}

async function expectMainSnapshotToRemain(
  app: ElectronApplication,
  expected: Partial<WebBrowserMainSnapshot>,
  durationMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (true) {
    expect(await getWebBrowserMainSnapshot(app)).toMatchObject(expected);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remainingMs)));
  }
}

test.describe('embedded web browser navigation', () => {
  test('creates one guest lazily in fixed tab order and exposes stable controls', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId: null,
        url: null,
        matchingGuestCount: 0,
        browserWindowCount: 1,
      });

      await page.getByTestId('chat-toolbar-workspace').click();
      const tabs = page.getByTestId('artifact-panel-tabs').locator('[data-testid]');
      await expect(tabs).toHaveCount(4);
      expect(await tabs.evaluateAll((elements) => (
        elements.map((element) => element.getAttribute('data-testid'))
      ))).toEqual([
        'artifact-panel-tab-browser',
        'artifact-panel-tab-preview',
        'artifact-panel-tab-changes',
        'artifact-panel-tab-web-browser',
      ]);
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId: null,
        matchingGuestCount: 0,
      });

      await page.getByTestId('artifact-panel-tab-web-browser').click();
      const snapshot = await expectGuestAt(app, {
        url: 'about:blank',
        title: 'about:blank',
        userAgent: WEB_BROWSER_USER_AGENT,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });
      await expect(page.getByTestId('web-browser-address-input')).toBeFocused();
      expect(typeof snapshot.guestId).toBe('number');

      for (const testId of [
        'web-browser-toolbar',
        'web-browser-back',
        'web-browser-forward',
        'web-browser-refresh',
        'web-browser-address-input',
        'web-browser-more',
        'web-browser-webview',
      ]) {
        await expect(page.getByTestId(testId)).toBeVisible();
      }

      await page.getByTestId('web-browser-more').click();
      await expect(page.getByTestId('web-browser-force-refresh')).toBeVisible();
      await expect(page.getByTestId('web-browser-clear-cookies')).toBeVisible();
      await expect(page.getByTestId('web-browser-clear-site-data')).toBeVisible();
      await expect(page.getByTestId('web-browser-open-external')).toBeDisabled();
      for (const testId of [
        'web-browser-force-refresh',
        'web-browser-clear-cookies',
        'web-browser-clear-site-data',
        'web-browser-open-external',
      ]) {
        await expect(page.getByTestId(testId).locator('svg')).toHaveCount(1);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('navigates with address and history controls without replacing the guest', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const initial = await openWebBrowser(page, app);
      const guestId = initial.guestId!;

      await navigateFromAddress(page, webBrowserFixture.urls.start);
      await expectGuestAt(app, {
        guestId,
        url: webBrowserFixture.urls.start,
        title: 'Fixture Start',
        matchingGuestCount: 1,
      });
      const display = page.getByTestId('web-browser-address-display');
      await expect(display).toContainText('Fixture Start');
      await expect(page.getByTestId('web-browser-favicon')).toHaveAttribute(
        'src',
        new URL('/favicon.svg', webBrowserFixture.urls.start).href,
      );
      await executeInWebBrowserGuest(app, guestId, "history.pushState({}, '', '#same-document'); true");
      await expect(page.getByTestId('web-browser-favicon')).toHaveAttribute(
        'src',
        new URL('/favicon.svg', webBrowserFixture.urls.start).href,
      );
      await executeInWebBrowserGuest(app, guestId, 'history.back(); true');
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.start });
      await expect(page.getByTestId('web-browser-favicon')).toHaveAttribute(
        'src',
        new URL('/favicon.svg', webBrowserFixture.urls.start).href,
      );
      await display.hover();
      await expect(page.getByRole('tooltip')).toHaveCount(0);

      await display.click();
      await expect(page.getByTestId('web-browser-favicon')).toHaveCount(0);
      await page.getByTestId('web-browser-address-input').fill(webBrowserFixture.urls.second);
      await page.getByTestId('web-browser-address-input').press('Escape');
      await expect(page.getByTestId('web-browser-address-display')).toContainText('Fixture Start');
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({ guestId, url: webBrowserFixture.urls.start });

      await page.getByTestId('web-browser-address-display').click();
      await page.getByTestId('web-browser-address-input').fill(webBrowserFixture.urls.second);
      await page.getByTestId('web-browser-refresh').focus();
      await expect(page.getByTestId('web-browser-address-display')).toContainText('Fixture Start');
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({ guestId, url: webBrowserFixture.urls.start });

      await navigateFromAddress(page, webBrowserFixture.urls.second);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.second, title: 'Fixture Second' });
      await expect(page.getByTestId('web-browser-favicon')).toBeVisible();
      await expect(page.getByTestId('web-browser-favicon-placeholder')).toHaveCount(0);
      await expect(page.getByTestId('web-browser-back')).toBeEnabled();
      await page.getByTestId('web-browser-back').click();
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.start, title: 'Fixture Start' });
      await expect(page.getByTestId('web-browser-forward')).toBeEnabled();
      await page.getByTestId('web-browser-forward').click();
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.second, title: 'Fixture Second' });

      const secondLoads = webBrowserFixture.requestCount('/second');
      await page.getByTestId('web-browser-refresh').click();
      await expect.poll(() => webBrowserFixture.requestCount('/second')).toBe(secondLoads + 1);
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({ guestId, matchingGuestCount: 1 });

      await page.getByTestId('web-browser-more').click();
      await page.getByTestId('web-browser-force-refresh').click();
      await expect.poll(() => webBrowserFixture.requestCount('/second')).toBe(secondLoads + 2);
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });

      await navigateFromAddress(page, webBrowserFixture.urls.crossOriginRedirect);
      await expectGuestAt(app, {
        guestId,
        url: webBrowserFixture.urls.storageAlternate,
        title: 'Storage Fixture',
      });
      await expect(page.getByTestId('web-browser-favicon')).toHaveCount(0);
      const placeholder = page.getByTestId('web-browser-favicon-placeholder');
      await expect(placeholder).toHaveCSS('width', '16px');
      await expect(placeholder).toHaveCSS('height', '16px');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('reuses the guest for allowed popups and blocks disallowed targets and redirects', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, webBrowserFixture.urls.popups);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.popups, title: 'Popup Fixtures' });
      await expect(page.getByTestId('web-browser-address-display')).toBeVisible();

      await executeInWebBrowserGuest(app, guestId!, "document.querySelector('#popup-link').click(); true");
      await expectGuestAt(app, {
        guestId,
        url: webBrowserFixture.urls.popupTarget,
        title: 'Popup Target',
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });

      await navigateFromAddress(page, webBrowserFixture.urls.popups);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.popups });
      await expect(page.getByTestId('web-browser-address-display')).toBeVisible();
      await executeInWebBrowserGuest(app, guestId!, "document.querySelector('#popup-script').click(); true");
      await expectGuestAt(app, {
        guestId,
        url: webBrowserFixture.urls.popupTarget,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });

      await navigateFromAddress(page, webBrowserFixture.urls.popups);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.popups });
      await expect(page.getByTestId('web-browser-address-display')).toBeVisible();
      await executeInWebBrowserGuest(app, guestId!, "window.open('data:text/html,blocked', '_blank'); true");
      await expectMainSnapshotToRemain(app, {
        guestId,
        url: webBrowserFixture.urls.popups,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });

      await executeInWebBrowserGuestAndWaitForLoad(
        app,
        guestId!,
        `location.assign(${JSON.stringify(webBrowserFixture.urls.disallowedRedirect)}); true`,
      );
      await expect.poll(() => webBrowserFixture.requestCount('/redirect-disallowed')).toBe(1);
      const blockedRedirect = await getWebBrowserMainSnapshot(app);
      expect(blockedRedirect).toMatchObject({
        guestId,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });
      expect([
        webBrowserFixture.urls.popups,
        webBrowserFixture.urls.disallowedRedirect,
      ]).toContain(blockedRedirect.url);
      expect(await executeInWebBrowserGuest<string>(app, guestId!, 'location.protocol')).not.toBe('data:');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('uses the exact UA and safely handles paths, file URLs, and external opening', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId } = await openWebBrowser(page, app);

      await navigateFromAddress(page, webBrowserFixture.filePath);
      await expect(page.getByText('Local paths must use a file:/// URL.')).toBeVisible();
      await expect(page.getByTestId('web-browser-address-input')).toBeFocused();
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({ guestId, url: 'about:blank' });

      await navigateFromAddress(page, webBrowserFixture.urls.ua);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.ua, userAgent: WEB_BROWSER_USER_AGENT });
      const guestUserAgent = await executeInWebBrowserGuest<string>(app, guestId!, 'navigator.userAgent');
      const echoedUserAgent = await executeInWebBrowserGuest<string>(app, guestId!, 'document.body.textContent');
      expect(guestUserAgent).toBe(WEB_BROWSER_USER_AGENT);
      expect(echoedUserAgent.trim()).toBe(WEB_BROWSER_USER_AGENT);
      expect(webBrowserFixture.lastRequest('/ua')?.headers['user-agent']).toBe(WEB_BROWSER_USER_AGENT);

      await navigateFromAddress(page, webBrowserFixture.fileUrl);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.fileUrl, title: 'Local File Fixture' });
      await page.getByTestId('web-browser-more').click();
      await page.getByTestId('web-browser-open-external').click();
      await expect.poll(() => getWebBrowserShellCalls(app)).toEqual({
        openExternal: [webBrowserFixture.fileUrl],
        openPath: [],
      });

      await navigateFromAddress(page, webBrowserFixture.urls.start);
      await expectGuestAt(app, { guestId, url: webBrowserFixture.urls.start });
      await page.getByTestId('web-browser-more').click();
      await page.getByTestId('web-browser-open-external').click();
      await expect.poll(() => getWebBrowserShellCalls(app)).toEqual({
        openExternal: [webBrowserFixture.fileUrl, webBrowserFixture.urls.start],
        openPath: [],
      });
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId,
        matchingGuestCount: 1,
        browserWindowCount: 1,
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
