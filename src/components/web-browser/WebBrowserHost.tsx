import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, HTMLAttributes, RefAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  normalizeWebBrowserTopLevelUrl,
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import type { WebBrowserAddressErrorCode } from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useArtifactPanel } from '@/stores/artifact-panel';
import type { WebBrowserWebviewElement } from '@/types/web-browser';
import { WebBrowserToolbar } from './WebBrowserToolbar';

interface WebviewElementProps extends HTMLAttributes<HTMLElement>, RefAttributes<WebBrowserWebviewElement> {
  allowpopups: string;
  partition: string;
  src: string;
  useragent: string;
}

interface HostGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NavigationRequest {
  generation: number;
  errorShown: boolean;
}

interface WebBrowserDidFailLoadEvent extends Event {
  errorCode: number;
  isMainFrame: boolean;
}

interface WebBrowserDidNavigateEvent extends Event {
  url: string;
}

interface WebBrowserDidNavigateInPageEvent extends WebBrowserDidNavigateEvent {
  isMainFrame: boolean;
}

interface WebBrowserPageTitleUpdatedEvent extends Event {
  title: string;
}

interface WebBrowserPageFaviconUpdatedEvent extends Event {
  favicons: string[];
}

interface WebBrowserDidStartNavigationEvent extends Event {
  isMainFrame: boolean;
  isInPlace: boolean;
  url: string;
}

const WebviewElement = 'webview' as unknown as ComponentType<WebviewElementProps>;

const ADDRESS_ERROR_KEYS: Record<WebBrowserAddressErrorCode, string> = {
  empty: 'empty',
  'absolute-path': 'absolutePath',
  'invalid-url': 'invalidUrl',
  'unsupported-protocol': 'unsupportedProtocol',
  'reserved-url': 'reservedUrl',
};

function readGeometry(anchor: HTMLElement): HostGeometry | null {
  if (!anchor.isConnected) return null;
  const bounds = anchor.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function hasSameOrigin(currentUrl: string, nextUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);
    if (current.origin !== 'null' || next.origin !== 'null') {
      return current.origin === next.origin;
    }
    current.hash = '';
    next.hash = '';
    return current.href === next.href;
  } catch {
    return false;
  }
}

export function WebBrowserHost(): React.ReactElement | null {
  const { t } = useTranslation('chat');
  const initialized = useArtifactPanel((state) => state.webBrowserInitialized);
  const panelOpen = useArtifactPanel((state) => state.open);
  const activeTab = useArtifactPanel((state) => state.tab);
  const anchor = useArtifactPanel((state) => state.webBrowserAnchor);
  const requestedNavigation = useArtifactPanel((state) => state.webBrowserNavigation);
  const [geometry, setGeometry] = useState<HostGeometry | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState<string>(WEB_BROWSER_INITIAL_URL);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [addressNavigationId, setAddressNavigationId] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [clearingCookies, setClearingCookies] = useState(false);
  const [clearingSiteData, setClearingSiteData] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebBrowserWebviewElement | null>(null);
  const knownWebviewRef = useRef<WebBrowserWebviewElement | null>(null);
  const attachedWebviewRef = useRef<WebBrowserWebviewElement | null>(null);
  const webviewGenerationRef = useRef(0);
  const removeWebviewListenersRef = useRef<() => void>(() => {});
  const translationRef = useRef(t);
  const lastAllowedUrlRef = useRef<string | null>(null);
  const pendingRecoveryUrlRef = useRef<string | null>(null);
  const navigationRequestRef = useRef<NavigationRequest | null>(null);
  const navigationGenerationRef = useRef(0);
  const currentUrlRef = useRef<string>(WEB_BROWSER_INITIAL_URL);
  const requestedNavigationRef = useRef(requestedNavigation);
  const handledNavigationIdRef = useRef(0);
  translationRef.current = t;
  requestedNavigationRef.current = requestedNavigation;

  const reportNavigationFailure = useCallback((request: NavigationRequest) => {
    if (
      navigationRequestRef.current?.generation !== request.generation
      || request.errorShown
    ) return;
    request.errorShown = true;
    toast.error(translationRef.current('artifactPanel.webBrowser.errors.loadFailed'));
  }, []);

  const runNavigation = useCallback(async (nextUrl: string, rethrow: boolean) => {
    const request: NavigationRequest = {
      generation: ++navigationGenerationRef.current,
      errorShown: false,
    };
    navigationRequestRef.current = request;
    try {
      await hostApi.webBrowser.navigate(nextUrl);
      if (navigationRequestRef.current?.generation === request.generation) {
        navigationRequestRef.current = null;
      }
    } catch (error) {
      reportNavigationFailure(request);
      if (rethrow) throw error;
    }
  }, [reportNavigationFailure]);

  const consumeRequestedNavigation = useCallback(() => {
    const request = requestedNavigationRef.current;
    const guest = webviewRef.current;
    if (
      !request
      || request.id <= handledNavigationIdRef.current
      || !guest
      || attachedWebviewRef.current !== guest
    ) return;
    handledNavigationIdRef.current = request.id;
    currentUrlRef.current = request.url;
    setUrl(request.url);
    setTitle('');
    setFaviconUrl(null);
    setAddressNavigationId(request.id);
    void runNavigation(request.url, false);
  }, [runNavigation]);

  useEffect(consumeRequestedNavigation, [consumeRequestedNavigation, requestedNavigation]);

  useLayoutEffect(() => {
    if (!anchor) {
      setGeometry(null);
      return;
    }

    let animationFrame: number | null = null;
    const measure = () => setGeometry(readGeometry(anchor));
    const scheduleMeasure = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        measure();
      });
    };
    const observer = new ResizeObserver(scheduleMeasure);

    measure();
    observer.observe(anchor);
    window.addEventListener('resize', scheduleMeasure);
    window.addEventListener('scroll', scheduleMeasure, true);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.removeEventListener('scroll', scheduleMeasure, true);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [anchor]);

  const setWebviewRef = useCallback((node: WebBrowserWebviewElement | null) => {
    removeWebviewListenersRef.current();
    removeWebviewListenersRef.current = () => {};
    webviewRef.current = node;
    attachedWebviewRef.current = null;
    if (!node) return;
    if (knownWebviewRef.current !== node) {
      knownWebviewRef.current = node;
      webviewGenerationRef.current += 1;
    }

    const syncHistory = () => {
      try {
        setCanGoBack(node.canGoBack());
        setCanGoForward(node.canGoForward());
      } catch {
        setCanGoBack(false);
        setCanGoForward(false);
      }
    };
    const syncAllowedUrl = (nextUrl: string) => {
      currentUrlRef.current = nextUrl;
      setUrl(nextUrl);
      const allowedUrl = normalizeWebBrowserTopLevelUrl(nextUrl);
      if (allowedUrl) lastAllowedUrlRef.current = allowedUrl;
    };
    const onDidAttach = () => {
      attachedWebviewRef.current = node;
      try {
        syncAllowedUrl(node.getURL() || WEB_BROWSER_INITIAL_URL);
        setTitle(node.getTitle());
        setLoading(node.isLoading());
      } catch {
        setLoading(false);
      }
      syncHistory();
      hostRef.current?.querySelector<HTMLInputElement>('[data-testid="web-browser-address-input"]')?.focus();

      consumeRequestedNavigation();

      const recoveryUrl = pendingRecoveryUrlRef.current;
      pendingRecoveryUrlRef.current = null;
      if (!recoveryUrl) return;
      void runNavigation(recoveryUrl, false);
    };
    const onDidStartLoading = () => {
      setLoading(true);
      const request = navigationRequestRef.current;
      if (request?.errorShown) {
        navigationRequestRef.current = null;
      }
    };
    const onDidStopLoading = () => {
      setLoading(false);
      syncHistory();
    };
    const onPageTitleUpdated = (event: WebBrowserPageTitleUpdatedEvent) => setTitle(event.title);
    const onPageFaviconUpdated = (event: WebBrowserPageFaviconUpdatedEvent) => {
      setFaviconUrl(event.favicons[0] ?? null);
    };
    const onDidStartNavigation = (event: WebBrowserDidStartNavigationEvent) => {
      if (
        event.isMainFrame
        && !event.isInPlace
        && !hasSameOrigin(currentUrlRef.current, event.url)
      ) setFaviconUrl(null);
    };
    const onDidNavigate = (event: WebBrowserDidNavigateEvent) => {
      syncAllowedUrl(event.url);
      syncHistory();
    };
    const onDidNavigateInPage = (event: WebBrowserDidNavigateInPageEvent) => {
      if (!event.isMainFrame) return;
      syncAllowedUrl(event.url);
      syncHistory();
    };
    const onDidFailLoad = (event: WebBrowserDidFailLoadEvent) => {
      if (!event.isMainFrame) return;
      if (event.errorCode === -3) return;
      const request = navigationRequestRef.current;
      if (request) {
        reportNavigationFailure(request);
      } else {
        toast.error(translationRef.current('artifactPanel.webBrowser.errors.loadFailed'));
      }
    };
    const onRenderProcessGone = () => {
      attachedWebviewRef.current = null;
      navigationRequestRef.current = null;
      setLoading(false);
      setFaviconUrl(null);
      setCrashed(true);
    };

    node.addEventListener('did-attach', onDidAttach);
    node.addEventListener('did-start-loading', onDidStartLoading);
    node.addEventListener('did-stop-loading', onDidStopLoading);
    node.addEventListener('page-title-updated', onPageTitleUpdated);
    node.addEventListener('page-favicon-updated', onPageFaviconUpdated);
    node.addEventListener('did-start-navigation', onDidStartNavigation);
    node.addEventListener('did-redirect-navigation', onDidStartNavigation);
    node.addEventListener('did-navigate', onDidNavigate);
    node.addEventListener('did-navigate-in-page', onDidNavigateInPage);
    node.addEventListener('did-fail-load', onDidFailLoad);
    node.addEventListener('render-process-gone', onRenderProcessGone);

    removeWebviewListenersRef.current = () => {
      node.removeEventListener('did-attach', onDidAttach);
      node.removeEventListener('did-start-loading', onDidStartLoading);
      node.removeEventListener('did-stop-loading', onDidStopLoading);
      node.removeEventListener('page-title-updated', onPageTitleUpdated);
      node.removeEventListener('page-favicon-updated', onPageFaviconUpdated);
      node.removeEventListener('did-start-navigation', onDidStartNavigation);
      node.removeEventListener('did-redirect-navigation', onDidStartNavigation);
      node.removeEventListener('did-navigate', onDidNavigate);
      node.removeEventListener('did-navigate-in-page', onDidNavigateInPage);
      node.removeEventListener('did-fail-load', onDidFailLoad);
      node.removeEventListener('render-process-gone', onRenderProcessGone);
    };
  }, [consumeRequestedNavigation, reportNavigationFailure, runNavigation]);

  useEffect(() => () => removeWebviewListenersRef.current(), []);

  const anchorVisible = panelOpen && activeTab === 'web-browser' && geometry !== null;
  const hostHidden = !anchorVisible;

  useEffect(() => {
    if (!hostHidden && !crashed) return;
    const activeElement = document.activeElement;
    if (!activeElement || !hostRef.current?.contains(activeElement)) return;
    const tab = document.querySelector<HTMLElement>('[data-testid="artifact-panel-tab-web-browser"]');
    const fallback = document.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (tab ?? fallback)?.focus();
  }, [crashed, hostHidden]);

  if (!initialized) return null;

  const callAttached = (action: (guest: WebBrowserWebviewElement) => void) => {
    const guest = webviewRef.current;
    if (!guest || attachedWebviewRef.current !== guest) return;
    action(guest);
  };
  const reloadClearedGuest = (guest: WebBrowserWebviewElement | null, guestGeneration: number) => {
    if (
      !guest
      || webviewRef.current !== guest
      || attachedWebviewRef.current !== guest
      || webviewGenerationRef.current !== guestGeneration
    ) return;
    guest.reloadIgnoringCache();
  };
  const handleNavigate = (nextUrl: string) => runNavigation(nextUrl, true);
  const handleClearCookies = async () => {
    const guest = webviewRef.current;
    const guestGeneration = webviewGenerationRef.current;
    setClearingCookies(true);
    try {
      await hostApi.webBrowser.clearCookies();
      reloadClearedGuest(guest, guestGeneration);
      toast.success(t('artifactPanel.webBrowser.success.cookiesCleared'));
    } catch {
      toast.error(t('artifactPanel.webBrowser.errors.clearCookiesFailed'));
    } finally {
      setClearingCookies(false);
    }
  };
  const handleClearSiteData = async () => {
    const guest = webviewRef.current;
    const guestGeneration = webviewGenerationRef.current;
    setClearingSiteData(true);
    try {
      await hostApi.webBrowser.clearSiteData();
      reloadClearedGuest(guest, guestGeneration);
      toast.success(t('artifactPanel.webBrowser.success.siteDataCleared'));
    } catch {
      toast.error(t('artifactPanel.webBrowser.errors.clearSiteDataFailed'));
    } finally {
      setClearingSiteData(false);
    }
  };
  const handleOpenExternal = async () => {
    try {
      await hostApi.webBrowser.openExternal();
    } catch {
      toast.error(t('artifactPanel.webBrowser.errors.openExternalFailed'));
    }
  };
  const handleRecover = () => {
    pendingRecoveryUrlRef.current = lastAllowedUrlRef.current;
    navigationRequestRef.current = null;
    setTitle('');
    currentUrlRef.current = WEB_BROWSER_INITIAL_URL;
    setUrl(WEB_BROWSER_INITIAL_URL);
    setFaviconUrl(null);
    setCanGoBack(false);
    setCanGoForward(false);
    setGeneration((current) => current + 1);
    setCrashed(false);
  };

  const style: CSSProperties = {
    position: 'fixed',
    left: geometry?.left ?? 0,
    top: geometry?.top ?? 0,
    width: geometry?.width ?? 0,
    height: geometry?.height ?? 0,
    visibility: hostHidden ? 'hidden' : 'visible',
    pointerEvents: hostHidden ? 'none' : 'auto',
  };

  // Removing the webview from the DOM destroys its guest, so inactive states hide this host instead.
  return (
    <div
      ref={hostRef}
      data-testid="web-browser-host"
      aria-busy={loading}
      aria-hidden={hostHidden}
      inert={hostHidden}
      className="z-20 flex min-h-0 flex-col overflow-hidden bg-background"
      style={style}
    >
      <WebBrowserToolbar
        title={title}
        url={url}
        faviconUrl={faviconUrl}
        addressNavigationId={addressNavigationId}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        visible={!hostHidden && !crashed}
        crashed={crashed}
        clearingCookies={clearingCookies}
        clearingSiteData={clearingSiteData}
        onNavigate={handleNavigate}
        onAddressError={(error) => {
          toast.error(t(`artifactPanel.webBrowser.errors.${ADDRESS_ERROR_KEYS[error]}`));
        }}
        onBack={() => callAttached((guest) => guest.goBack())}
        onForward={() => callAttached((guest) => guest.goForward())}
        onRefresh={() => callAttached((guest) => guest.reload())}
        onForceRefresh={() => callAttached((guest) => guest.reloadIgnoringCache())}
        onClearCookies={() => void handleClearCookies()}
        onClearSiteData={() => void handleClearSiteData()}
        onOpenExternal={() => void handleOpenExternal()}
      />
      {crashed ? (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('artifactPanel.webBrowser.crash.title')}
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {t('artifactPanel.webBrowser.crash.message')}
            </p>
          </div>
          <Button type="button" size="sm" onClick={handleRecover}>
            {t('artifactPanel.webBrowser.crash.recover')}
          </Button>
        </div>
      ) : (
        <WebviewElement
          key={generation}
          ref={setWebviewRef}
          data-testid="web-browser-webview"
          src={WEB_BROWSER_INITIAL_URL}
          partition={WEB_BROWSER_PARTITION}
          useragent={WEB_BROWSER_USER_AGENT}
          allowpopups=""
          className="min-h-0 flex-1"
        />
      )}
    </div>
  );
}
