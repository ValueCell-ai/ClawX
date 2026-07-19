import type { Session, WebContents, WebPreferences } from 'electron';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
  normalizeWebBrowserTopLevelUrl,
} from '../../shared/web-browser';
import { logger } from '../utils/logger';

const DENY_WINDOW_OPEN = { action: 'deny' } as const;

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
    && params.allowpopups === true
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

    const rejectDisallowedNavigation = (
      details: Electron.Event<Electron.WebContentsWillNavigateEventParams>,
    ): void => {
      if (!details.isMainFrame || normalizeWebBrowserTopLevelUrl(details.url) !== null) {
        return;
      }

      logger.warn(`[WebBrowser] Blocked top-level navigation to ${details.url}`);
      details.preventDefault();
    };

    const rejectDisallowedRedirect = (
      details: Electron.Event<Electron.WebContentsWillRedirectEventParams>,
    ): void => {
      if (!details.isMainFrame || normalizeWebBrowserTopLevelUrl(details.url) !== null) {
        return;
      }

      logger.warn(`[WebBrowser] Blocked top-level redirect to ${details.url}`);
      details.preventDefault();
    };

    // Same-tab fallback cannot preserve window.opener, returned window handles, or full POST/referrer fidelity.
    guest.setWindowOpenHandler(({ url }) => {
      const target = normalizeWebBrowserTopLevelUrl(url);
      if (!target || !registry.owns(guest)) {
        logger.warn(`[WebBrowser] Blocked popup target ${url}`);
        return DENY_WINDOW_OPEN;
      }

      try {
        void guest.loadURL(target).catch((error) => {
          logger.warn(`[WebBrowser] Failed to load popup target ${target}:`, error);
        });
      } catch (error) {
        logger.warn(`[WebBrowser] Failed to load popup target ${target}:`, error);
      }

      return DENY_WINDOW_OPEN;
    });

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;

      guest.off('will-navigate', rejectDisallowedNavigation);
      guest.off('will-redirect', rejectDisallowedRedirect);
      guest.off('destroyed', cleanup);
      if (!guest.isDestroyed()) {
        guest.setWindowOpenHandler(() => DENY_WINDOW_OPEN);
      }
      if (cleanupGuestPolicy === cleanup) {
        cleanupGuestPolicy = null;
      }
    };

    guest.on('will-navigate', rejectDisallowedNavigation);
    guest.on('will-redirect', rejectDisallowedRedirect);
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
