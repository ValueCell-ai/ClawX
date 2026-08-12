import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, HTMLAttributes, RefAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { htmlPreviewFileUrl } from '@/lib/local-html-browser';
import { useArtifactPanel } from '@/stores/artifact-panel';
import type { WebBrowserWebviewElement } from '@/types/web-browser';

interface WebviewElementProps extends HTMLAttributes<HTMLElement>, RefAttributes<WebBrowserWebviewElement> {
  partition: string;
  src: string;
  useragent: string;
}

interface HostGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  fullscreen: boolean;
}

interface DidFailLoadEvent extends Event {
  errorCode: number;
  isMainFrame: boolean;
}

const WebviewElement = 'webview' as unknown as ComponentType<WebviewElementProps>;

function readGeometry(anchor: HTMLElement): HostGeometry | null {
  if (!anchor.isConnected) return null;
  const bounds = anchor.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    fullscreen: anchor.closest('[data-testid="file-preview-fullscreen-layer"]') !== null,
  };
}

/**
 * Route-stable host for the local HTML preview webview.
 *
 * The guest has no browser chrome and is visible only over the Preview
 * tab's HTML anchor. Main owns URL validation and blocks every navigation
 * initiated by the loaded document.
 */
export function WebBrowserHost(): React.ReactElement | null {
  const { t } = useTranslation('chat');
  const panelOpen = useArtifactPanel((state) => state.open);
  const activeTab = useArtifactPanel((state) => state.tab);
  const focusedFile = useArtifactPanel((state) => state.focusedFile);
  const anchor = useArtifactPanel((state) => state.htmlPreviewAnchor);
  const previewUrl = focusedFile ? htmlPreviewFileUrl(focusedFile) : null;
  const previewUrlRef = useRef(previewUrl);
  const [geometry, setGeometry] = useState<HostGeometry | null>(null);
  const [loading, setLoading] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const webviewRef = useRef<WebBrowserWebviewElement | null>(null);
  const attachedWebviewRef = useRef<WebBrowserWebviewElement | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const removeListenersRef = useRef<() => void>(() => {});

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const navigateToPreview = useCallback(async () => {
    const guest = webviewRef.current;
    const url = previewUrlRef.current;
    if (!guest || attachedWebviewRef.current !== guest || !url || loadedUrlRef.current === url) return;
    try {
      await hostApi.webBrowser.navigate(url);
      loadedUrlRef.current = url;
    } catch {
      toast.error(t('filePreview.errors.htmlLoadFailed', 'Could not load HTML preview'));
    }
  }, [t]);

  useEffect(() => {
    void navigateToPreview();
  }, [navigateToPreview, previewUrl]);

  useLayoutEffect(() => {
    if (!anchor) {
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
    removeListenersRef.current();
    removeListenersRef.current = () => {};
    webviewRef.current = node;
    attachedWebviewRef.current = null;
    loadedUrlRef.current = null;
    if (!node) return;

    const onDidAttach = () => {
      attachedWebviewRef.current = node;
      setLoading(node.isLoading());
      void navigateToPreview();
    };
    const onDomReady = () => {
      // did-attach can be missed when React mounts during guest initialization.
      // dom-ready confirms Main has registered the guest and is safe to navigate.
      attachedWebviewRef.current = node;
      void navigateToPreview();
    };
    const onDidStartLoading = () => setLoading(true);
    const onDidStopLoading = () => setLoading(false);
    const onDidFailLoad = (event: DidFailLoadEvent) => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      setLoading(false);
      toast.error(t('filePreview.errors.htmlLoadFailed', 'Could not load HTML preview'));
    };
    const onRenderProcessGone = () => {
      attachedWebviewRef.current = null;
      setLoading(false);
      setCrashed(true);
    };

    node.addEventListener('did-attach', onDidAttach);
    node.addEventListener('dom-ready', onDomReady);
    node.addEventListener('did-start-loading', onDidStartLoading);
    node.addEventListener('did-stop-loading', onDidStopLoading);
    node.addEventListener('did-fail-load', onDidFailLoad);
    node.addEventListener('render-process-gone', onRenderProcessGone);
    removeListenersRef.current = () => {
      node.removeEventListener('did-attach', onDidAttach);
      node.removeEventListener('dom-ready', onDomReady);
      node.removeEventListener('did-start-loading', onDidStartLoading);
      node.removeEventListener('did-stop-loading', onDidStopLoading);
      node.removeEventListener('did-fail-load', onDidFailLoad);
      node.removeEventListener('render-process-gone', onRenderProcessGone);
    };
  }, [navigateToPreview, t]);

  useEffect(() => () => removeListenersRef.current(), []);

  if (!previewUrl) return null;

  const visible = panelOpen && activeTab === 'preview' && anchor !== null && geometry !== null;
  const style: CSSProperties = {
    position: 'fixed',
    left: geometry?.left ?? 0,
    top: geometry?.top ?? 0,
    width: geometry?.width ?? 0,
    height: geometry?.height ?? 0,
    zIndex: geometry?.fullscreen ? 110 : 20,
    visibility: visible ? 'visible' : 'hidden',
    pointerEvents: visible ? 'auto' : 'none',
  };

  return (
    <div
      data-testid="html-preview-host"
      aria-busy={loading}
      aria-hidden={!visible}
      inert={!visible}
      className="flex min-h-0 flex-col overflow-hidden bg-white"
      style={style}
    >
      {crashed ? (
        <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-foreground">
            {t('filePreview.html.crashed', 'HTML preview stopped')}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              loadedUrlRef.current = null;
              setGeneration((current) => current + 1);
              setCrashed(false);
            }}
          >
            {t('filePreview.actions.retry', 'Retry')}
          </Button>
        </div>
      ) : (
        <WebviewElement
          key={generation}
          ref={setWebviewRef}
          data-testid="html-preview-webview"
          src={WEB_BROWSER_INITIAL_URL}
          partition={WEB_BROWSER_PARTITION}
          useragent={WEB_BROWSER_USER_AGENT}
          className="min-h-0 flex-1"
        />
      )}
    </div>
  );
}
