import type { ElectronApplication, Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { WEB_BROWSER_PARTITION, WEB_BROWSER_USER_AGENT } from '../../shared/web-browser';
import { closeElectronApp, expect, getStableWindow } from './fixtures/electron';
import {
  executeInWebBrowserGuest,
  executeInWebBrowserGuestAndWaitForLoad,
  getWebBrowserCookieValue,
  getWebBrowserMainSnapshot,
  installWebBrowserPolicyInstrumentation,
  prepareWebBrowserApp,
  test,
  type LocalWebBrowserFixture,
  type WebBrowserMainSnapshot,
  type WebBrowserPolicyInstrumentation,
} from './fixtures/web-browser';

interface StoredSiteData {
  cacheStorage: boolean;
  httpCache: string;
  indexedDb: boolean;
  localStorage: string | null;
  reloadVersion: number;
  serviceWorkers: number;
}

async function launchPreparedBrowser(
  launchElectronApp: (options?: {
    skipSetup?: boolean;
    additionalArgs?: string[];
  }) => Promise<ElectronApplication>,
  fixture: LocalWebBrowserFixture,
  additionalArgs: string[] = [],
): Promise<{
  app: ElectronApplication;
  page: Page;
  policy: WebBrowserPolicyInstrumentation;
}> {
  const app = await launchElectronApp({ skipSetup: true, additionalArgs });
  await prepareWebBrowserApp(app, fixture.workspaceDir);
  const policy = await installWebBrowserPolicyInstrumentation(app);
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return { app, page, policy };
}

async function openWebBrowser(page: Page, app: ElectronApplication): Promise<WebBrowserMainSnapshot> {
  await page.getByTestId('chat-toolbar-workspace').click();
  await expect(page.getByTestId('artifact-panel')).toBeVisible();
  await page.getByTestId('artifact-panel-tab-web-browser').click();
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    url: 'about:blank',
    matchingGuestCount: 1,
    browserWindowCount: 1,
  });
  return await getWebBrowserMainSnapshot(app);
}

async function navigateFromAddress(
  page: Page,
  app: ElectronApplication,
  url: string,
  title: string,
): Promise<WebBrowserMainSnapshot> {
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
  return await getWebBrowserMainSnapshot(app);
}

async function seedSiteData(
  app: ElectronApplication,
  guestId: number,
  label: string,
): Promise<StoredSiteData> {
  return await executeInWebBrowserGuest<StoredSiteData>(
    app,
    guestId,
    `globalThis.seedFixtureStorage(${JSON.stringify(label)})`,
  );
}

async function readSiteData(app: ElectronApplication, guestId: number): Promise<StoredSiteData> {
  return await executeInWebBrowserGuest<StoredSiteData>(app, guestId, 'globalThis.readFixtureStorage()');
}

function expectSeededSiteData(data: StoredSiteData, label: string): void {
  expect(data).toEqual({
    cacheStorage: true,
    httpCache: expect.stringMatching(/^cache-version-\d+$/),
    indexedDb: true,
    localStorage: label,
    reloadVersion: expect.any(Number),
    serviceWorkers: 1,
  });
  expect(data.reloadVersion).toBeGreaterThan(0);
}

async function navigateGuest(
  app: ElectronApplication,
  guestId: number,
  url: string,
  title: string,
): Promise<void> {
  await executeInWebBrowserGuestAndWaitForLoad(
    app,
    guestId,
    `location.assign(${JSON.stringify(url)}); true`,
  );
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    guestId,
    isLoading: false,
    title,
    url,
  });
}

async function reloadGuest(app: ElectronApplication, guestId: number): Promise<void> {
  await executeInWebBrowserGuestAndWaitForLoad(app, guestId, 'location.reload(); true');
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    guestId,
    isLoading: false,
  });
}

async function clearFromMenu(page: Page, testId: string): Promise<void> {
  await page.getByTestId('web-browser-more').click();
  await page.getByTestId(testId).click();
}

async function expectGuestRefreshComplete(
  page: Page,
  app: ElectronApplication,
  expectedUrl: string,
): Promise<void> {
  await expect.poll(() => getWebBrowserMainSnapshot(app)).toMatchObject({
    isLoading: false,
    url: expectedUrl,
  });
  await expect(page.getByTestId('web-browser-address-display')).toBeVisible();
}

test.describe('embedded web browser session policy', () => {
  test('isolates one hardened guest and rejects a second matching attachment', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const snapshot = await openWebBrowser(page, app);
      expect(snapshot).toMatchObject({
        guestType: 'webview',
        usesDedicatedSession: true,
        userAgent: WEB_BROWSER_USER_AGENT,
      });
      expect(await executeInWebBrowserGuest(app, snapshot.guestId!, `({
        clawx: typeof window.clawx,
        electron: typeof window.electron,
        nodeProcess: typeof process,
        require: typeof require,
        userAgent: navigator.userAgent,
      })`)).toEqual({
        clawx: 'undefined',
        electron: 'undefined',
        nodeProcess: 'undefined',
        require: 'undefined',
        userAgent: WEB_BROWSER_USER_AGENT,
      });

      await page.evaluate(({ partition, userAgent }) => {
        const duplicate = document.createElement('webview');
        duplicate.id = 'duplicate-web-browser';
        duplicate.setAttribute('src', 'about:blank');
        duplicate.setAttribute('partition', partition);
        duplicate.setAttribute('useragent', userAgent);
        duplicate.setAttribute('allowpopups', '');
        document.body.append(duplicate);
      }, { partition: WEB_BROWSER_PARTITION, userAgent: WEB_BROWSER_USER_AGENT });

      const duplicateDeadline = Date.now() + 1_000;
      while (Date.now() < duplicateDeadline) {
        expect(await getWebBrowserMainSnapshot(app)).toMatchObject({
          guestId: snapshot.guestId,
          matchingGuestCount: 1,
          browserWindowCount: 1,
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await expect(page.locator('#duplicate-web-browser')).toHaveCount(1);
    } finally {
      await policy.restore();
      await closeElectronApp(app);
    }
  });

  test('clears cookies across origins while preserving site data and force-refreshing', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateGuest(app, guestId!, webBrowserFixture.urls.storagePolicy, 'Storage Fixture');
      const primary = await seedSiteData(app, guestId!, 'primary');
      expectSeededSiteData(primary, 'primary');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storagePolicy,
        'fixture-primary',
      )).resolves.toBe('cookie-primary');
      await navigateGuest(app, guestId!, webBrowserFixture.urls.storageAlternate, 'Storage Fixture');
      const alternate = await seedSiteData(app, guestId!, 'alternate');
      expectSeededSiteData(alternate, 'alternate');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storageAlternate,
        'fixture-alternate',
      )).resolves.toBe('cookie-alternate');
      const cacheRequests = webBrowserFixture.requestCount('/cache-resource');
      const versionRequests = webBrowserFixture.requestCount('/storage-version.js');
      const nextReloadVersion = webBrowserFixture.advanceStorageVersion();

      await reloadGuest(app, guestId!);
      await expect(readSiteData(app, guestId!)).resolves.toEqual(alternate);
      expect(webBrowserFixture.requestCount('/storage-version.js')).toBe(versionRequests);
      const storageRequests = webBrowserFixture.requestCount('/storage-policy');

      await clearFromMenu(page, 'web-browser-clear-cookies');
      await expect.poll(() => webBrowserFixture.requestCount('/storage-policy')).toBe(storageRequests + 1);
      await expect.poll(() => webBrowserFixture.requestCount('/storage-version.js')).toBe(versionRequests + 1);
      await expectGuestRefreshComplete(page, app, webBrowserFixture.urls.storageAlternate);
      const refreshedAlternate = await readSiteData(app, guestId!);
      expectSeededSiteData(refreshedAlternate, 'alternate');
      expect(refreshedAlternate).toMatchObject({
        httpCache: alternate.httpCache,
        reloadVersion: nextReloadVersion,
      });
      expect(webBrowserFixture.lastRequest('/storage-version.js')?.headers['cache-control']).toContain('no-cache');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storagePolicy,
        'fixture-primary',
      )).resolves.toBeNull();
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storageAlternate,
        'fixture-alternate',
      )).resolves.toBeNull();

      await navigateGuest(app, guestId!, webBrowserFixture.urls.storagePolicy, 'Storage Fixture');
      await expect(readSiteData(app, guestId!)).resolves.toEqual(primary);
      expect(webBrowserFixture.requestCount('/cache-resource')).toBe(cacheRequests);
    } finally {
      await policy.restore();
      await closeElectronApp(app);
    }
  });

  test('clears all non-cookie site data across origins while preserving cookies and force-refreshing', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateGuest(app, guestId!, webBrowserFixture.urls.storagePolicy, 'Storage Fixture');
      const primary = await seedSiteData(app, guestId!, 'primary');
      expectSeededSiteData(primary, 'primary');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storagePolicy,
        'fixture-primary',
      )).resolves.toBe('cookie-primary');
      await navigateGuest(app, guestId!, webBrowserFixture.urls.storageAlternate, 'Storage Fixture');
      const alternate = await seedSiteData(app, guestId!, 'alternate');
      expectSeededSiteData(alternate, 'alternate');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storageAlternate,
        'fixture-alternate',
      )).resolves.toBe('cookie-alternate');
      const cacheRequests = webBrowserFixture.requestCount('/cache-resource');
      const versionRequests = webBrowserFixture.requestCount('/storage-version.js');
      const nextReloadVersion = webBrowserFixture.advanceStorageVersion();

      await reloadGuest(app, guestId!);
      await expect(readSiteData(app, guestId!)).resolves.toEqual(alternate);
      expect(webBrowserFixture.requestCount('/storage-version.js')).toBe(versionRequests);
      const storageRequests = webBrowserFixture.requestCount('/storage-policy');

      await clearFromMenu(page, 'web-browser-clear-site-data');
      await expect.poll(() => webBrowserFixture.requestCount('/storage-policy')).toBe(storageRequests + 1);
      await expect.poll(() => webBrowserFixture.requestCount('/storage-version.js')).toBe(versionRequests + 1);
      await expectGuestRefreshComplete(page, app, webBrowserFixture.urls.storageAlternate);
      expect(await executeInWebBrowserGuest<number>(app, guestId!, 'globalThis.__fixtureReloadVersion'))
        .toBe(nextReloadVersion);
      expect(webBrowserFixture.lastRequest('/storage-version.js')?.headers['cache-control']).toContain('no-cache');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storagePolicy,
        'fixture-primary',
      )).resolves.toBe('cookie-primary');
      await expect(getWebBrowserCookieValue(
        app,
        webBrowserFixture.urls.storageAlternate,
        'fixture-alternate',
      )).resolves.toBe('cookie-alternate');

      const clearedAlternate = await readSiteData(app, guestId!);
      expect(clearedAlternate).toEqual({
        cacheStorage: false,
        httpCache: expect.any(String),
        indexedDb: false,
        localStorage: null,
        reloadVersion: nextReloadVersion,
        serviceWorkers: 0,
      });
      expect(clearedAlternate.httpCache).not.toBe(alternate.httpCache);
      await navigateGuest(app, guestId!, webBrowserFixture.urls.storagePolicy, 'Storage Fixture');
      const clearedPrimary = await readSiteData(app, guestId!);
      expect(clearedPrimary).toEqual({
        cacheStorage: false,
        httpCache: expect.any(String),
        indexedDb: false,
        localStorage: null,
        reloadVersion: expect.any(Number),
        serviceWorkers: 0,
      });
      expect(clearedPrimary.httpCache).not.toBe(primary.httpCache);
      expect(webBrowserFixture.requestCount('/cache-resource')).toBe(cacheRequests + 2);
    } finally {
      await policy.restore();
      await closeElectronApp(app);
    }
  });

  test('prompts once per combined media request and applies allow and deny independently', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(
      launchElectronApp,
      webBrowserFixture,
      ['--use-fake-device-for-media-stream'],
    );
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, app, webBrowserFixture.urls.permissions, 'Permission Fixture');

      await policy.queueDialogResponses(0);
      const allowed = await executeInWebBrowserGuest(app, guestId!, `navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .then((stream) => {
          const result = {
            allowed: true,
            audioTracks: stream.getAudioTracks().length,
            videoTracks: stream.getVideoTracks().length,
          };
          stream.getTracks().forEach((track) => track.stop());
          return result;
        }, (error) => ({ allowed: false, error: error.name }))`);
      expect(allowed).toEqual({ allowed: true, audioTracks: 1, videoTracks: 1 });
      await expect.poll(() => policy.getDialogCalls()).toHaveLength(1);
      const origin = new URL(webBrowserFixture.urls.permissions).origin;
      expect((await policy.getDialogCalls())[0]).toMatchObject({
        buttons: ['Allow', 'Deny'],
        cancelId: 1,
        defaultId: 0,
        message: expect.stringContaining(origin),
      });
      expect((await policy.getDialogCalls())[0]?.message).toContain('camera and microphone');

      await policy.queueDialogResponses(1);
      const denied = await executeInWebBrowserGuest(app, guestId!, `navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
          return { allowed: true };
        }, (error) => ({ allowed: false, error: error.name }))`);
      expect(denied).toEqual({ allowed: false, error: 'NotAllowedError' });
      await expect.poll(() => policy.getDialogCalls()).toHaveLength(2);
    } finally {
      await policy.restore();
      await closeElectronApp(app);
    }
  });

  test('allows clipboard and denies geolocation and notifications without dialogs', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, app, webBrowserFixture.urls.permissions, 'Permission Fixture');
      await policy.writeClipboardText('ClawX browser clipboard fixture');

      await expect(executeInWebBrowserGuest<string>(app, guestId!, 'navigator.clipboard.readText()'))
        .resolves.toBe('ClawX browser clipboard fixture');
      await expect(executeInWebBrowserGuest<string>(app, guestId!, `new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve('allowed'),
          (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'other'),
        );
      })`)).resolves.toBe('denied');
      await expect(executeInWebBrowserGuest<string>(app, guestId!, 'Notification.requestPermission()'))
        .resolves.toBe('denied');
      await expect(policy.getDialogCalls()).resolves.toEqual([]);
    } finally {
      await policy.restore();
      await closeElectronApp(app);
    }
  });

  test.skip('keeps default download handling and remains usable after exact completion', async ({
    launchElectronApp,
    webBrowserFixture,
  }) => {
    const { app, page, policy } = await launchPreparedBrowser(launchElectronApp, webBrowserFixture);
    let downloadedPath: string | null = null;
    try {
      const { guestId } = await openWebBrowser(page, app);
      await navigateFromAddress(page, app, webBrowserFixture.urls.start, 'Fixture Start');
      await executeInWebBrowserGuest(app, guestId!, "document.querySelector('#download-link').click(); true");

      await expect.poll(() => policy.getDownloads()).toHaveLength(1);
      await expect.poll(async () => {
        const [download] = await policy.getDownloads();
        return [download?.receivedBytes, download?.totalBytes];
      }).toEqual([
        Buffer.byteLength('deterministic download\n'),
        Buffer.byteLength('deterministic download\n'),
      ]);
      const transferred = (await policy.getDownloads())[0]!;
      downloadedPath = transferred.savePath;
      if (process.platform === 'darwin' && transferred.savePath === '') {
        test.info().annotations.push({
          type: 'platform',
          description: 'Electron default downloads await the native macOS save sheet on this runner',
        });
        expect(transferred).toMatchObject({
          defaultPrevented: false,
          filename: webBrowserFixture.downloadFilename,
          receivedBytes: Buffer.byteLength('deterministic download\n'),
          savePath: '',
          state: 'progressing',
          totalBytes: Buffer.byteLength('deterministic download\n'),
          url: webBrowserFixture.urls.download,
        });
        await expect(executeInWebBrowserGuest<string>(app, guestId!, "document.querySelector('#start').textContent"))
          .resolves.toBe('start');
        await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
          guestId,
          matchingGuestCount: 1,
          browserWindowCount: 1,
          url: webBrowserFixture.urls.start,
        });
        return;
      }

      await expect.poll(() => policy.getDownloads()).toEqual([
        expect.objectContaining({ state: 'completed' }),
      ]);
      const download = (await policy.getDownloads())[0]!;
      downloadedPath = download.savePath;
      expect(download).toMatchObject({
        defaultPrevented: false,
        filename: webBrowserFixture.downloadFilename,
        receivedBytes: Buffer.byteLength('deterministic download\n'),
        state: 'completed',
        totalBytes: Buffer.byteLength('deterministic download\n'),
        url: webBrowserFixture.urls.download,
      });
      expect(basename(download.savePath)).toBe(webBrowserFixture.downloadFilename);
      await expect(readFile(download.savePath, 'utf8')).resolves.toBe('deterministic download\n');
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId,
        url: webBrowserFixture.urls.start,
      });

      await navigateFromAddress(page, app, webBrowserFixture.urls.second, 'Fixture Second');
      await expect(getWebBrowserMainSnapshot(app)).resolves.toMatchObject({
        guestId,
        matchingGuestCount: 1,
        browserWindowCount: 1,
        url: webBrowserFixture.urls.second,
      });
    } finally {
      if (downloadedPath) await rm(downloadedPath, { force: true });
      await policy.restore();
      await closeElectronApp(app);
    }
  });
});
