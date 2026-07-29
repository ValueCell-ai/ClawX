import {
  session,
  type BrowserWindow,
  type Session,
} from 'electron';
import {
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
  normalizeWebBrowserHtmlFileUrl,
} from '@shared/web-browser';
import type { WebBrowserGuestRegistry } from './web-browser-policy';

const DOWNLOAD_OBSERVED_SESSIONS = new WeakSet<Session>();

export interface ConfigureWebBrowserSessionOptions {
  registry: WebBrowserGuestRegistry;
  getMainWindow: () => BrowserWindow | null;
  getLanguage?: () => Promise<string | undefined>;
}

export function configureWebBrowserSession(
  _options: ConfigureWebBrowserSessionOptions,
): Session {
  const browserSession = session.fromPartition(WEB_BROWSER_PARTITION, { cache: true });

  // Keep a deterministic identity even though this session may load only local HTML.
  browserSession.setUserAgent(WEB_BROWSER_USER_AGENT);

  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  browserSession.setDevicePermissionHandler(() => false);
  browserSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });

  browserSession.webRequest.onBeforeRequest(
    { urls: ['file://*/*', 'http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const isNetworkRequest = /^(?:https?|wss?):/i.test(details.url);
      const isInvalidMainDocument = details.resourceType === 'mainFrame'
        && normalizeWebBrowserHtmlFileUrl(details.url) === null;
      callback({ cancel: isNetworkRequest || isInvalidMainDocument });
    },
  );

  if (!DOWNLOAD_OBSERVED_SESSIONS.has(browserSession)) {
    DOWNLOAD_OBSERVED_SESSIONS.add(browserSession);
    browserSession.on('will-download', (event) => {
      event.preventDefault();
    });
  }

  return browserSession;
}
