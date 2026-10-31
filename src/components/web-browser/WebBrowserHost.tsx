import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType, HTMLAttributes, RefAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  WEB_BROWSER_INITIAL_URL,
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { htmlPreviewFileUrl } from '@/lib/local-html-browser';
import { useHtmlPreview } from '@/stores/html-preview';
import type { WebBrowserWebviewElement } from '@/types/web-browser';

interface WebviewElementProps extends HTMLAttributes<HTMLElement>, RefAttributes<WebBrowserWebviewElement> {
  partition: string;
  src: string;
  useragent: string;
}

interface DidFailLoadEvent extends Event {
  errorCode: number;
  isMainFrame: boolean;
}

const WebviewElement = 'webview' as unknown as ComponentType<WebviewElementProps>;

/**
 * Reader-owned host for the local HTML preview webview.
 *
 * The guest has no browser chrome and is visible only over the shared file
 * preview's HTML anchor; the guest is portaled inside that reader so modal focus
 * and dismissal boundaries include the HTML content. Main owns URL validation and blocks every navigation
 * initiated by the loaded document.
 */
export function WebBrowserHost({ owner }: { owner?: symbol } = {}): React.ReactElement | null {
  const { t } = useTranslation('chat');
  const current = useHtmlPreview((state) => state.current);
  const reader = !owner || current?.owner === owner ? current : null;
  const anchor = reader?.anchor ?? null;
  const previewUrl = reader ? htmlPreviewFileUrl(reader.file) : null;
  const previewUrlRef = useRef(previewUrl);
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

  if (!previewUrl || !anchor) return null;

  const visible = !!reader?.active;
  return createPortal(
    <div
      data-testid="html-preview-host"
      aria-busy={loading}
      aria-hidden={!visible}
      inert={!visible}
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-white"
      style={{ visibility: visible ? 'visible' : 'hidden', pointerEvents: visible ? 'auto' : 'none' }}
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
    </div>,
    anchor,
  );
}
