import type { ElectronApplication } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installIpcMocks, test as electronTest } from './electron';

export interface LocalWebBrowserRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface LocalWebBrowserFixture {
  workspaceDir: string;
  filePath: string;
  fileUrl: string;
  downloadFilename: string;
  urls: {
    start: string;
    second: string;
    popups: string;
    popupTarget: string;
    ua: string;
    allowedRedirect: string;
    crossOriginRedirect: string;
    disallowedRedirect: string;
    storage: string;
    storagePolicy: string;
    storageAlternate: string;
    permissions: string;
    download: string;
    cache: string;
    serviceWorker: string;
  };
  advanceStorageVersion: () => number;
  requestCount: (path: string) => number;
  lastRequest: (path: string) => LocalWebBrowserRequest | undefined;
}

export interface WebBrowserMainSnapshot {
  guestId: number | null;
  guestType: string | null;
  usesDedicatedSession: boolean;
  url: string | null;
  title: string | null;
  userAgent: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  matchingGuestCount: number;
  browserWindowCount: number;
}

export interface WebBrowserShellCalls {
  openExternal: string[];
  openPath: string[];
}

export interface WebBrowserDialogCall {
  type?: string;
  title?: string;
  message: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  noLink?: boolean;
}

export interface WebBrowserDownloadObservation {
  url: string;
  filename: string;
  mimeType: string;
  savePath: string;
  defaultPrevented: boolean;
  receivedBytes: number;
  totalBytes: number;
  state: string | null;
}

export interface WebBrowserPolicyInstrumentation {
  queueDialogResponses: (...responses: number[]) => Promise<void>;
  getDialogCalls: () => Promise<WebBrowserDialogCall[]>;
  getDownloads: () => Promise<WebBrowserDownloadObservation[]>;
  writeClipboardText: (text: string) => Promise<void>;
  restore: () => Promise<void>;
}

export const WEB_BROWSER_E2E_SESSION_KEYS = {
  primary: 'agent:main:web-browser-e2e',
  secondary: 'agent:main:web-browser-e2e-secondary',
} as const;

function html(title: string, body: string, head = ''): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${title}</title>${head}</head>
  <body>${body}</body>
</html>`;
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Browser fixture failed to bind an ephemeral port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createLocalWebBrowserFixture(homeDir: string): Promise<{
  fixture: LocalWebBrowserFixture;
  server: Server;
}> {
  const fixtureDir = join(homeDir, 'web-browser-e2e');
  const workspaceDir = join(fixtureDir, 'workspace');
  const filePath = join(fixtureDir, 'local file fixture.html');
  const downloadFilename = `clawx-e2e-${basename(homeDir)}.txt`;
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(filePath, html('Local File Fixture', '<main id="local-file">local file</main>'), 'utf8');

  const requests: LocalWebBrowserRequest[] = [];
  let cacheVersion = 0;
  let storageVersion = 1;
  let origin = '';
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', origin || 'http://127.0.0.1');
    requests.push({
      method: request.method ?? 'GET',
      path: requestUrl.pathname,
      headers: { ...request.headers },
    });

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    switch (requestUrl.pathname) {
      case '/start':
        response.end(html('Fixture Start', [
          '<main id="start">start</main>',
          '<a id="second-link" href="/second">second</a>',
          '<a id="download-link" href="/download" download>download</a>',
        ].join(''), '<link rel="icon" href="/favicon.svg">'));
        return;
      case '/favicon.svg':
        response.setHeader('Content-Type', 'image/svg+xml');
        response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#2563eb"/></svg>');
        return;
      case '/second':
        response.end(html('Fixture Second', '<main id="second">second</main>'));
        return;
      case '/popups':
        response.end(html('Popup Fixtures', [
          '<a id="popup-link" href="/popup-target" target="_blank">popup link</a>',
          '<button id="popup-script" onclick="window.open(\'/popup-target\', \'_blank\')">popup script</button>',
        ].join('')));
        return;
      case '/popup-target':
        response.end(html('Popup Target', '<main id="popup-target">popup target</main>'));
        return;
      case '/ua':
        response.end(html('UA Echo', request.headers['user-agent'] ?? ''));
        return;
      case '/redirect-allowed':
        response.statusCode = 302;
        response.setHeader('Location', '/second');
        response.end();
        return;
      case '/redirect-cross-origin':
        response.statusCode = 302;
        response.setHeader('Location', `${origin.replace('127.0.0.1', 'localhost')}/storage-policy`);
        response.end();
        return;
      case '/redirect-disallowed':
        response.statusCode = 302;
        response.setHeader('Location', 'data:text/html,blocked');
        response.end();
        return;
      case '/storage':
        response.setHeader('Set-Cookie', 'fixture=cookie; Path=/; Max-Age=3600; SameSite=Lax');
        response.end(html('Storage Fixture', [
          '<script>',
          "localStorage.setItem('fixture', 'local-storage');",
          "indexedDB.open('fixture-db', 1);",
          '</script>',
          '<main id="storage">storage</main>',
        ].join('')));
        return;
      case '/storage-policy':
        response.end(html('Storage Fixture', [
          '<script src="/storage-version.js"></script>',
          '<script>',
          'globalThis.readFixtureStorage = async () => ({',
          "  cacheStorage: (await caches.keys()).includes('fixture-cache'),",
          "  httpCache: await fetch('/cache-resource').then((result) => result.text()),",
          "  indexedDb: (await indexedDB.databases()).some((database) => database.name === 'fixture-db'),",
          "  localStorage: localStorage.getItem('fixture'),",
          '  reloadVersion: globalThis.__fixtureReloadVersion,',
          '  serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,',
          '});',
          'globalThis.seedFixtureStorage = async (label) => {',
          "  document.cookie = `fixture-${label}=cookie-${label}; Path=/; Max-Age=3600; SameSite=Lax`;",
          "  localStorage.setItem('fixture', label);",
          '  await new Promise((resolve, reject) => {',
          "    const request = indexedDB.open('fixture-db', 1);",
          '    request.onerror = () => reject(request.error);',
          '    request.onsuccess = () => { request.result.close(); resolve(); };',
          '  });',
          "  const cache = await caches.open('fixture-cache');",
          "  await cache.put('/cache-entry', new Response(`cache-${label}`));",
          "  await navigator.serviceWorker.register('/service-worker.js');",
          '  await navigator.serviceWorker.ready;',
          '  return globalThis.readFixtureStorage();',
          '};',
          '</script>',
          '<main id="storage">storage</main>',
        ].join('')));
        return;
      case '/storage-version.js':
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'public, max-age=3600');
        response.end(`globalThis.__fixtureReloadVersion = ${storageVersion};\n`);
        return;
      case '/cache-resource':
        cacheVersion += 1;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Cache-Control', 'public, max-age=3600');
        response.end(`cache-version-${cacheVersion}`);
        return;
      case '/permissions':
        response.end(html('Permission Fixture', [
          '<button id="clipboard" onclick="navigator.clipboard.readText()">clipboard</button>',
          '<button id="geolocation" onclick="navigator.geolocation.getCurrentPosition(() => {}, () => {})">geolocation</button>',
          '<button id="media" onclick="navigator.mediaDevices.getUserMedia({audio:true,video:true})">media</button>',
        ].join('')));
        return;
      case '/download':
        response.setHeader('Content-Length', Buffer.byteLength('deterministic download\n'));
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        response.end('deterministic download\n');
        return;
      case '/cache':
        cacheVersion += 1;
        response.setHeader('Cache-Control', 'public, max-age=3600');
        response.end(html('Cache Fixture', `<main id="cache-version">${cacheVersion}</main>`));
        return;
      case '/service-worker':
        response.end(html('Service Worker Fixture', [
          '<script>navigator.serviceWorker.register(\'/service-worker.js\')</script>',
          '<main id="service-worker">service worker</main>',
        ].join('')));
        return;
      case '/service-worker.js':
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Service-Worker-Allowed', '/');
        response.end("self.addEventListener('fetch', () => {});\n");
        return;
      default:
        response.statusCode = 404;
        response.end(html('Not Found', '<main>not found</main>'));
    }
  });
  const port = await listen(server);
  origin = `http://127.0.0.1:${port}`;
  const url = (path: string) => `${origin}${path}`;

  return {
    server,
    fixture: {
      workspaceDir,
      filePath,
      fileUrl: pathToFileURL(filePath).href,
      downloadFilename,
      urls: {
        start: url('/start'),
        second: url('/second'),
        popups: url('/popups'),
        popupTarget: url('/popup-target'),
        ua: url('/ua'),
        allowedRedirect: url('/redirect-allowed'),
        crossOriginRedirect: url('/redirect-cross-origin'),
        disallowedRedirect: url('/redirect-disallowed'),
        storage: url('/storage'),
        storagePolicy: url('/storage-policy'),
        storageAlternate: `http://localhost:${port}/storage-policy`,
        permissions: url('/permissions'),
        download: url('/download'),
        cache: url('/cache'),
        serviceWorker: url('/service-worker'),
      },
      advanceStorageVersion: () => {
        storageVersion += 1;
        return storageVersion;
      },
      requestCount: (path) => requests.filter((request) => request.path === path).length,
      lastRequest: (path) => requests.findLast((request) => request.path === path),
    },
  };
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

export async function prepareWebBrowserApp(app: ElectronApplication, workspaceDir: string): Promise<void> {
  const sessionKey = WEB_BROWSER_E2E_SESSION_KEYS.primary;
  const secondarySessionKey = WEB_BROWSER_E2E_SESSION_KEYS.secondary;
  const now = Date.now();
  const sessions = [
    {
      key: sessionKey,
      displayName: 'Browser fixture',
      derivedTitle: 'Browser fixture',
      workspacePath: workspaceDir,
      updatedAt: new Date(now).toISOString(),
    },
    {
      key: secondarySessionKey,
      displayName: 'Browser fixture secondary',
      derivedTitle: 'Browser fixture secondary',
      workspacePath: workspaceDir,
      updatedAt: new Date(now - 1).toISOString(),
    },
  ];
  const sessionsList = {
    success: true,
    result: {
      sessions,
    },
  };

  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: now },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: sessionsList,
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: sessionsList,
      [stableStringify(['chat.history', null])]: { success: true, result: { messages: [] } },
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        setupComplete: true,
        chatWorkspacePath: workspaceDir,
        recentWorkspacePaths: [workspaceDir],
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{ id: 'main', name: 'main', workspace: workspaceDir, mainSessionKey: sessionKey }],
        defaultAgentId: 'main',
      },
      [stableStringify(['sessions', 'summaries', { sessionKeys: [sessionKey, secondarySessionKey] }])]: {
        summaries: sessions.map((session, index) => ({
          sessionKey: session.key,
          firstUserText: session.derivedTitle,
          lastTimestamp: now - index,
          workspacePath: workspaceDir,
        })),
      },
      [stableStringify(['files', 'resolveWorkspaceContext', {
        workspaceRoot: workspaceDir,
        executionCwd: workspaceDir,
      }])]: { ok: true, workspaceRoot: workspaceDir, executionCwd: workspaceDir },
      [stableStringify(['chat', 'loadAcpSession', {
        sessionKey,
        workspaceRoot: workspaceDir,
        cwd: workspaceDir,
      }])]: { success: true, generation: 1 },
      [stableStringify(['chat', 'loadAcpSession', {
        sessionKey: secondarySessionKey,
        workspaceRoot: workspaceDir,
        cwd: workspaceDir,
      }])]: { success: true, generation: 2 },
    },
  });

  await app.evaluate(async ({ app: _app }) => {
    const { shell } = process.mainModule!.require('electron') as typeof import('electron');
    const globals = globalThis as unknown as { __webBrowserShellCalls?: WebBrowserShellCalls };
    const calls: WebBrowserShellCalls = { openExternal: [], openPath: [] };
    globals.__webBrowserShellCalls = calls;
    shell.openExternal = async (url) => {
      calls.openExternal.push(url);
    };
    shell.openPath = async (path) => {
      calls.openPath.push(path);
      return '';
    };
  });
}

export async function getWebBrowserMainSnapshot(app: ElectronApplication): Promise<WebBrowserMainSnapshot> {
  return await app.evaluate(async ({ app: _app }) => {
    const { BrowserWindow, session, webContents } = process.mainModule!.require('electron') as typeof import('electron');
    const browserSession = session.fromPartition('persist:clawx-web-browser', { cache: true });
    const matchingGuests = webContents.getAllWebContents().filter((contents) => (
      contents.getType() === 'webview' && contents.session === browserSession
    ));
    const guest = matchingGuests[0];
    return {
      guestId: guest?.id ?? null,
      guestType: guest?.getType() ?? null,
      usesDedicatedSession: guest?.session === browserSession,
      url: guest?.getURL() ?? null,
      title: guest?.getTitle() ?? null,
      userAgent: guest?.getUserAgent() ?? null,
      canGoBack: guest?.navigationHistory.canGoBack() ?? false,
      canGoForward: guest?.navigationHistory.canGoForward() ?? false,
      isLoading: guest?.isLoading() ?? false,
      matchingGuestCount: matchingGuests.length,
      browserWindowCount: BrowserWindow.getAllWindows().length,
    };
  });
}

export async function installWebBrowserPolicyInstrumentation(
  app: ElectronApplication,
): Promise<WebBrowserPolicyInstrumentation> {
  await app.evaluate(async ({ app: _app }) => {
    const { clipboard, dialog, session } = process.mainModule!.require('electron') as typeof import('electron');
    const browserSession = session.fromPartition('persist:clawx-web-browser', { cache: true });
    type ClipboardSnapshot = {
      hadContents: boolean;
      text: string;
      html: string;
      rtf: string;
      bookmark: { title: string; url: string };
      image: Buffer | null;
    };
    type PolicyState = {
      clipboard: ClipboardSnapshot;
      clipboardWritten: boolean;
      dialogCalls: WebBrowserDialogCall[];
      dialogResponses: number[];
      downloads: WebBrowserDownloadObservation[];
      downloadItems: Electron.DownloadItem[];
      originalShowMessageBox: typeof dialog.showMessageBox;
      downloadObserver: (...args: unknown[]) => void;
      restored: boolean;
    };
    const globals = globalThis as unknown as { __webBrowserPolicyState?: PolicyState };
    if (globals.__webBrowserPolicyState && !globals.__webBrowserPolicyState.restored) {
      throw new Error('Web browser policy instrumentation is already installed');
    }

    const originalShowMessageBox = dialog.showMessageBox;
    const originalClipboardImage = clipboard.readImage();
    const state: PolicyState = {
      clipboard: {
        hadContents: clipboard.availableFormats().length > 0,
        text: clipboard.readText(),
        html: clipboard.readHTML(),
        rtf: clipboard.readRTF(),
        bookmark: clipboard.readBookmark(),
        image: originalClipboardImage.isEmpty() ? null : originalClipboardImage.toPNG(),
      },
      clipboardWritten: false,
      dialogCalls: [],
      dialogResponses: [],
      downloads: [],
      downloadItems: [],
      originalShowMessageBox,
      downloadObserver: () => {},
      restored: false,
    };
    globals.__webBrowserPolicyState = state;

    const instrumentedDialog = dialog as unknown as {
      showMessageBox: (...args: unknown[]) => Promise<{ response: number; checkboxChecked: boolean }>;
    };
    instrumentedDialog.showMessageBox = async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions;
      state.dialogCalls.push({
        ...(options.type ? { type: options.type } : {}),
        ...(options.title ? { title: options.title } : {}),
        message: options.message,
        ...(options.buttons ? { buttons: [...options.buttons] } : {}),
        ...(options.defaultId !== undefined ? { defaultId: options.defaultId } : {}),
        ...(options.cancelId !== undefined ? { cancelId: options.cancelId } : {}),
        ...(options.noLink !== undefined ? { noLink: options.noLink } : {}),
      });
      return {
        response: state.dialogResponses.shift() ?? 1,
        checkboxChecked: false,
      };
    };

    state.downloadObserver = (eventValue: unknown, itemValue: unknown) => {
      const event = eventValue as Electron.Event;
      const item = itemValue as Electron.DownloadItem;
      const observation: WebBrowserDownloadObservation = {
        url: item.getURL(),
        filename: item.getFilename(),
        mimeType: item.getMimeType(),
        savePath: item.getSavePath(),
        defaultPrevented: event.defaultPrevented,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: null,
      };
      state.downloads.push(observation);
      state.downloadItems.push(item);
      item.once('done', (_doneEvent, downloadState) => {
        observation.receivedBytes = item.getReceivedBytes();
        observation.totalBytes = item.getTotalBytes();
        observation.savePath = item.getSavePath();
        observation.state = downloadState;
      });
    };
    browserSession.on('will-download', state.downloadObserver as never);
  });

  const readState = async (): Promise<{
    dialogCalls: WebBrowserDialogCall[];
    downloads: WebBrowserDownloadObservation[];
  }> => await app.evaluate(async () => {
    const state = (globalThis as unknown as {
      __webBrowserPolicyState?: {
        dialogCalls: WebBrowserDialogCall[];
        downloads: WebBrowserDownloadObservation[];
        downloadItems: Electron.DownloadItem[];
      };
    }).__webBrowserPolicyState;
    if (!state) throw new Error('Web browser policy instrumentation is not installed');
    return {
      dialogCalls: state.dialogCalls.map((call) => ({
        ...call,
        ...(call.buttons ? { buttons: [...call.buttons] } : {}),
      })),
      downloads: state.downloads.map((download, index) => {
        const item = state.downloadItems[index];
        return {
          ...download,
          ...(item ? {
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            savePath: item.getSavePath(),
            state: item.getState(),
          } : {}),
        };
      }),
    };
  });

  return {
    queueDialogResponses: async (...responses) => {
      await app.evaluate(async (_context, queuedResponses) => {
        const state = (globalThis as unknown as {
          __webBrowserPolicyState?: { dialogResponses: number[] };
        }).__webBrowserPolicyState;
        if (!state) throw new Error('Web browser policy instrumentation is not installed');
        state.dialogResponses.push(...queuedResponses);
      }, responses);
    },
    getDialogCalls: async () => (await readState()).dialogCalls,
    getDownloads: async () => (await readState()).downloads,
    writeClipboardText: async (text) => {
      await app.evaluate(async ({ app: _app }, clipboardText) => {
        const { clipboard } = process.mainModule!.require('electron') as typeof import('electron');
        const state = (globalThis as unknown as {
          __webBrowserPolicyState?: { clipboardWritten: boolean };
        }).__webBrowserPolicyState;
        if (!state) throw new Error('Web browser policy instrumentation is not installed');
        state.clipboardWritten = true;
        clipboard.writeText(clipboardText);
      }, text);
    },
    restore: async () => {
      await app.evaluate(async ({ app: _app }) => {
        const {
          clipboard,
          dialog,
          nativeImage,
          session,
        } = process.mainModule!.require('electron') as typeof import('electron');
        const state = (globalThis as unknown as {
          __webBrowserPolicyState?: {
            clipboard: {
              hadContents: boolean;
              text: string;
              html: string;
              rtf: string;
              bookmark: { title: string; url: string };
              image: Buffer | null;
            };
            clipboardWritten: boolean;
            originalShowMessageBox: typeof dialog.showMessageBox;
            downloadObserver: (...args: unknown[]) => void;
            restored: boolean;
          };
        }).__webBrowserPolicyState;
        if (!state || state.restored) return;
        state.restored = true;
        const instrumentedDialog = dialog as unknown as { showMessageBox: typeof dialog.showMessageBox };
        instrumentedDialog.showMessageBox = state.originalShowMessageBox;
        session.fromPartition('persist:clawx-web-browser', { cache: true })
          .off('will-download', state.downloadObserver as never);
        if (state.clipboardWritten && state.clipboard.hadContents) {
          const hasBookmark = state.clipboard.bookmark.url.length > 0;
          const restored: Electron.ClipboardData = {
            ...(hasBookmark
              ? { text: state.clipboard.bookmark.url, bookmark: state.clipboard.bookmark.title }
              : state.clipboard.text
                ? { text: state.clipboard.text }
                : {}),
            ...(state.clipboard.html ? { html: state.clipboard.html } : {}),
            ...(state.clipboard.rtf ? { rtf: state.clipboard.rtf } : {}),
            ...(state.clipboard.image ? { image: nativeImage.createFromBuffer(state.clipboard.image) } : {}),
          };
          clipboard.write(restored);
        } else if (state.clipboardWritten) {
          clipboard.clear();
        }
      });
    },
  };
}

export async function forceCrashWebBrowserGuest(app: ElectronApplication, guestId: number): Promise<void> {
  await app.evaluate(async ({ app: _app }, id) => {
    const { webContents } = process.mainModule!.require('electron') as typeof import('electron');
    const guest = webContents.fromId(id);
    if (!guest || guest.getType() !== 'webview') {
      throw new Error(`Web browser guest ${id} is unavailable`);
    }
    guest.forcefullyCrashRenderer();
  }, guestId);
}

export async function getWebBrowserCookieValue(
  app: ElectronApplication,
  url: string,
  name: string,
): Promise<string | null> {
  return await app.evaluate(async ({ app: _app }, input) => {
    const { session } = process.mainModule!.require('electron') as typeof import('electron');
    const browserSession = session.fromPartition('persist:clawx-web-browser', { cache: true });
    const cookies = await browserSession.cookies.get({ url: input.url, name: input.name });
    return cookies[0]?.value ?? null;
  }, { url, name });
}

export async function executeInWebBrowserGuest<T>(
  app: ElectronApplication,
  guestId: number,
  expression: string,
): Promise<T> {
  return await app.evaluate(async ({ app: _app }, input) => {
    const { webContents } = process.mainModule!.require('electron') as typeof import('electron');
    const guest = webContents.fromId(input.guestId);
    if (!guest || guest.getType() !== 'webview') {
      throw new Error(`Web browser guest ${input.guestId} is unavailable`);
    }
    return await guest.executeJavaScript(input.expression, true) as T;
  }, { guestId, expression });
}

export async function executeInWebBrowserGuestAndWaitForLoad(
  app: ElectronApplication,
  guestId: number,
  expression: string,
): Promise<void> {
  await app.evaluate(async ({ app: _app }, input) => {
    const { webContents } = process.mainModule!.require('electron') as typeof import('electron');
    const guest = webContents.fromId(input.guestId);
    if (!guest || guest.getType() !== 'webview') {
      throw new Error(`Web browser guest ${input.guestId} is unavailable`);
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        guest.off('did-stop-loading', handleStopped);
        reject(new Error(`Web browser guest ${input.guestId} did not finish loading`));
      }, 5_000);
      const handleStopped = () => {
        clearTimeout(timeout);
        resolve();
      };
      guest.once('did-stop-loading', handleStopped);
      void guest.executeJavaScript(input.expression, true).catch((error) => {
        clearTimeout(timeout);
        guest.off('did-stop-loading', handleStopped);
        reject(error);
      });
    });
  }, { guestId, expression });
}

export async function getWebBrowserShellCalls(app: ElectronApplication): Promise<WebBrowserShellCalls> {
  return await app.evaluate(async ({ app: _app }) => {
    const calls = (globalThis as unknown as { __webBrowserShellCalls?: WebBrowserShellCalls })
      .__webBrowserShellCalls;
    if (!calls) throw new Error('Web browser shell fixture is not installed');
    return {
      openExternal: [...calls.openExternal],
      openPath: [...calls.openPath],
    };
  });
}

export const test = electronTest.extend<{ webBrowserFixture: LocalWebBrowserFixture }>({
  webBrowserFixture: async ({ homeDir }, provideFixture) => {
    const { fixture, server } = await createLocalWebBrowserFixture(homeDir);
    try {
      await provideFixture(fixture);
    } finally {
      await close(server);
    }
  },
});
