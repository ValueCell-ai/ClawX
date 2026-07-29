import type { Session, WebContents, WebPreferences } from 'electron';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
  normalizeWebBrowserHtmlFileUrl,
} from '../../shared/web-browser';
import { logger } from '../utils/logger';

const DENY_WINDOW_OPEN = { action: 'deny' } as const;
const INERT_LINK_CSS = `
  a, area {
    color: inherit !important;
    cursor: inherit !important;
    pointer-events: none !important;
    text-decoration: none !important;
  }
`;

export class WebBrowserGuestRegistry {
  private guest: WebContents | null = null;
  private pendingAttachment = false;

  beginAttachment(): boolean {
    this.dropDestroyedGuest();
    if (this.pendingAttachment || this.guest) {
      return false;
    }

    this.pendingAttachment = true;
    return true;
  }

  completeAttachment(guest: WebContents): void {
    if (!this.pendingAttachment || this.guest) {
      return;
    }

    this.pendingAttachment = false;
    this.guest = guest;
    guest.once('destroyed', () => {
      if (this.guest === guest) {
        this.guest = null;
      }
    });
  }

  cancelAttachment(): void {
    this.pendingAttachment = false;
  }

  current(): WebContents | null {
    this.dropDestroyedGuest();
    return this.guest;
  }

  owns(contents: WebContents | null): boolean {
    return contents !== null && this.current() === contents;
  }

  hasLiveGuest(): boolean {
    return this.current() !== null;
  }

  private dropDestroyedGuest(): void {
    if (this.guest?.isDestroyed()) {
      this.guest = null;
    }
  }
}

export function isExpectedWebBrowserAttachment(
  params: Record<string, unknown>,
): boolean {
  return params.partition === WEB_BROWSER_PARTITION
    && params.src === WEB_BROWSER_INITIAL_URL
    && params.useragent === WEB_BROWSER_USER_AGENT
    && params.allowpopups !== true
    && params.preload === '';
}

export function hardenWebBrowserPreferences(preferences: WebPreferences): void {
  delete preferences.preload;
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.plugins = false;
  preferences.allowRunningInsecureContent = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
}

export function installWebBrowserGuestPolicy(
  embedder: WebContents,
  options: {
    browserSession: Session;
    registry: WebBrowserGuestRegistry;
  },
): () => void {
  const { browserSession, registry } = options;
  let attachmentPending = false;
  let cleanupGuestPolicy: (() => void) | null = null;

  const handleWillAttach = (
    event: Electron.Event,
    preferences: WebPreferences,
    params: Record<string, unknown>,
  ): void => {
    if (!isExpectedWebBrowserAttachment(params)) {
      logger.warn('[WebBrowser] Rejected webview attachment with unexpected identity');
      event.preventDefault();
      return;
    }

    if (!registry.beginAttachment()) {
      logger.warn('[WebBrowser] Rejected additional webview attachment');
      event.preventDefault();
      return;
    }

    attachmentPending = true;
    hardenWebBrowserPreferences(preferences);
  };

  const handleDidAttach = (_event: Electron.Event, guest: WebContents): void => {
    if (!attachmentPending) {
      logger.warn('[WebBrowser] Ignored attached guest without a reserved slot');
      return;
    }
    attachmentPending = false;

    if (guest.getType() !== 'webview' || guest.session !== browserSession) {
      logger.warn('[WebBrowser] Rejected attached guest with unexpected type or session');
      registry.cancelAttachment();
      return;
    }

    registry.completeAttachment(guest);
    if (!registry.owns(guest)) {
      logger.warn('[WebBrowser] Failed to register reserved guest');
      return;
    }

    guest.setUserAgent(WEB_BROWSER_USER_AGENT);
    let committedHtmlUrl = normalizeWebBrowserHtmlFileUrl(guest.getURL());
    let restoringCommittedUrl = false;

    const blockPageNavigation = (
      details: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>,
    ): void => {
      logger.warn(`[WebBrowser] Blocked guest navigation to ${details.url}`);
      details.preventDefault();
    };

    const stopInvalidProgrammaticNavigation = (
      details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (!details.isMainFrame || normalizeWebBrowserHtmlFileUrl(details.url)) {
        return;
      }

      logger.warn(`[WebBrowser] Stopped invalid programmatic navigation to ${details.url}`);
      guest.stop();
    };

    const blockRedirect = (
      details: Electron.Event<Electron.WebContentsWillRedirectEventParams>,
    ): void => {
      logger.warn(`[WebBrowser] Blocked guest redirect to ${details.url}`);
      details.preventDefault();
    };

    guest.setWindowOpenHandler(({ url }) => {
      logger.warn(`[WebBrowser] Blocked popup target ${url}`);
      return DENY_WINDOW_OPEN;
    });

    const makeLinksVisuallyInert = (): void => {
      void guest.insertCSS(INERT_LINK_CSS, { cssOrigin: 'user' }).catch((error) => {
        logger.warn('[WebBrowser] Failed to neutralize HTML links:', error);
      });
    };

    const rememberCommittedHtml = (_event: Electron.Event, url: string): void => {
      const normalizedUrl = normalizeWebBrowserHtmlFileUrl(url);
      if (normalizedUrl) {
        committedHtmlUrl = normalizedUrl;
      }
      restoringCommittedUrl = false;
    };

    const restoreAfterInPageNavigation = (
      _event: Electron.Event,
      url: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || !committedHtmlUrl || url === committedHtmlUrl || restoringCommittedUrl) {
        return;
      }

      restoringCommittedUrl = true;
      logger.warn(`[WebBrowser] Reverting blocked in-page navigation to ${url}`);
      void guest.loadURL(committedHtmlUrl).catch((error) => {
        restoringCommittedUrl = false;
        logger.warn(`[WebBrowser] Failed to restore local HTML preview ${committedHtmlUrl}:`, error);
      });
    };

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;

      guest.off('will-frame-navigate', blockPageNavigation);
      guest.off('did-start-navigation', stopInvalidProgrammaticNavigation);
      guest.off('will-redirect', blockRedirect);
      guest.off('did-finish-load', makeLinksVisuallyInert);
      guest.off('did-navigate', rememberCommittedHtml);
      guest.off('did-navigate-in-page', restoreAfterInPageNavigation);
      guest.off('destroyed', cleanup);
      if (!guest.isDestroyed()) {
        guest.setWindowOpenHandler(() => DENY_WINDOW_OPEN);
      }
      if (cleanupGuestPolicy === cleanup) {
        cleanupGuestPolicy = null;
      }
    };

    guest.on('will-frame-navigate', blockPageNavigation);
    guest.on('did-start-navigation', stopInvalidProgrammaticNavigation);
    guest.on('will-redirect', blockRedirect);
    guest.on('did-finish-load', makeLinksVisuallyInert);
    guest.on('did-navigate', rememberCommittedHtml);
    guest.on('did-navigate-in-page', restoreAfterInPageNavigation);
    guest.once('destroyed', cleanup);
    cleanupGuestPolicy = cleanup;
  };

  embedder.on('will-attach-webview', handleWillAttach);
  embedder.on('did-attach-webview', handleDidAttach);

  return () => {
    embedder.off('will-attach-webview', handleWillAttach);
    embedder.off('did-attach-webview', handleDidAttach);
    attachmentPending = false;
    registry.cancelAttachment();
    cleanupGuestPolicy?.();
  };
}
