/**
 * Inline PDF viewer (pdfjs-dist).
 *
 * Renders pages to <canvas> on demand and provides a small toolbar with
 * page navigation and zoom controls.  The component is intentionally
 * lazy-loaded by the parent (`React.lazy`) so the ~3 MB pdfjs bundle
 * never lands in the main chunk.
 *
 * The PDF bytes are pulled through the sandboxed `file:readBinary` IPC
 * channel — no `file://` round-trip — so anything outside the preview
 * roots is rejected the same way text reads are.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { readBinaryFile } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from 'pdfjs-dist/types/src/display/api';

const PDF_MAX_BYTES = 50 * 1024 * 1024;
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export interface PdfViewerProps {
  filePath: string;
  /** Optional file name shown in screen-reader labels and titles. */
  fileName?: string;
  className?: string;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'tooLarge'; size?: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: PDFDocumentProxy };

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(ZOOM_LEVELS[0], zoom));
}

function nextZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 1e-3;
  if (direction === 1) {
    const found = ZOOM_LEVELS.find((level) => level > zoom + epsilon);
    return found ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  }
  const reversed = [...ZOOM_LEVELS].reverse();
  const found = reversed.find((level) => level < zoom - epsilon);
  return found ?? ZOOM_LEVELS[0];
}

export default function PdfViewer({ filePath, fileName, className }: PdfViewerProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState<number>(1);
  const [renderTick, setRenderTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [autoFit, setAutoFit] = useState(true);

  // Bootstrap: read bytes through IPC, hand them to pdfjs.  We import
  // pdfjs lazily *inside* the effect to keep the renderer chunk under
  // control — Vite splits the dynamic import into its own bundle.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setPageIndex(0);

    void (async () => {
      try {
        const res = await readBinaryFile(filePath, { maxBytes: PDF_MAX_BYTES });
        if (cancelled) return;
        if (!res.ok || !res.data) {
          if (res.error === 'tooLarge') {
            setState({ status: 'tooLarge', size: res.size });
            return;
          }
          setState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        const pdfjs = await import('pdfjs-dist');
        // The worker module ships separately; importing with `?url` would
        // require type plumbing — instead we pull the worker as a static
        // asset URL via Vite's `import.meta.url` semantic.
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // pdfjs mutates the buffer; clone defensively so we keep the
        // structured-clone view stable across re-renders.
        const cloned = new Uint8Array(res.data.byteLength);
        cloned.set(res.data);
        const loadingTask = pdfjs.getDocument({ data: cloned });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        setState({ status: 'ready', doc });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    return () => {
      if (state.status === 'ready') {
        void state.doc.destroy().catch(() => {
          // Destroy errors during unmount are non-fatal — the worker is
          // tearing down anyway.
        });
      }
    };
  }, [state]);

  const totalPages = state.status === 'ready' ? state.doc.numPages : 0;

  // Auto-fit: derive an initial zoom from the container width so the
  // first paint matches WorkBuddy's "show full width by default" feel.
  useLayoutEffect(() => {
    if (state.status !== 'ready' || !autoFit) return;
    let cancelled = false;
    void (async () => {
      try {
        const page = await state.doc.getPage(pageIndex + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        const container = containerRef.current;
        if (!container) return;
        const targetWidth = Math.max(320, container.clientWidth - 32);
        const fitted = clampZoom(targetWidth / viewport.width);
        setZoom(fitted);
      } catch {
        // ignore — render effect will fall back to default zoom
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoFit, state, pageIndex]);

  // Re-render the active page whenever the doc / page / zoom changes.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const doc = state.doc;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let activePage: PDFPageProxy | null = null;

    const render = async () => {
      try {
        const page = await doc.getPage(pageIndex + 1);
        if (cancelled) {
          page.cleanup();
          return;
        }
        activePage = page;
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const viewport = page.getViewport({ scale: zoom * dpr });
        const cssViewport = page.getViewport({ scale: zoom });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        // Cancel any in-flight render before starting a new one. pdfjs
        // throws on overlapping renders on the same canvas.
        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        const textLayer = textLayerRef.current;
        if (textLayer) {
          textLayer.style.width = `${Math.floor(cssViewport.width)}px`;
          textLayer.style.height = `${Math.floor(cssViewport.height)}px`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // pdfjs emits a benign "Rendering cancelled" when we navigate
        // mid-render — swallow that, surface anything else.
        if (!message.toLowerCase().includes('cancel')) {
          // Non-fatal: keep current canvas, but log so dev sees it.
           
          // a non-fatal rendering hiccup we deliberately don't surface.
          console.warn('[PdfViewer] render failed:', message);
        }
      }
    };

    void render();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      activePage?.cleanup();
    };
  }, [state, pageIndex, zoom, renderTick]);

  const goPrev = useCallback(() => {
    setPageIndex((idx) => Math.max(0, idx - 1));
  }, []);
  const goNext = useCallback(() => {
    setPageIndex((idx) => Math.min(totalPages - 1, idx + 1));
  }, [totalPages]);

  const onPageInput = useCallback(
    (raw: string) => {
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value)) return;
      const clamped = Math.max(1, Math.min(totalPages || 1, value));
      setPageIndex(clamped - 1);
    },
    [totalPages],
  );

  const handleZoomIn = useCallback(() => {
    setAutoFit(false);
    setZoom((current) => clampZoom(nextZoom(current, 1)));
  }, []);
  const handleZoomOut = useCallback(() => {
    setAutoFit(false);
    setZoom((current) => clampZoom(nextZoom(current, -1)));
  }, []);
  const handleZoomReset = useCallback(() => {
    setAutoFit(true);
    setZoom(1);
    // Bump tick so the auto-fit layout effect reruns even when zoom
    // already happened to be 1.
    setRenderTick((v) => v + 1);
  }, []);

  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <LoadingSpinner />
      </div>
    );
  }
  if (state.status === 'tooLarge') {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground', className)}>
        {t('filePreview.errors.tooLarge', '文件过大，已禁用预览')}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive', className)}>
        <p>
          {t('filePreview.pdf.loadFailed', { defaultValue: 'PDF 加载失败：{{error}}', error: state.message })}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-black/5 dark:bg-black/30', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 bg-background/80 px-3 py-1.5 backdrop-blur dark:border-white/10">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goPrev}
            disabled={pageIndex <= 0}
            title={t('filePreview.pdf.prev', '上一页')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="inline-flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={totalPages || 1}
              value={pageIndex + 1}
              onChange={(e) => onPageInput(e.target.value)}
              className="h-6 w-12 rounded border border-black/10 bg-background px-1 text-center text-xs tabular-nums dark:border-white/15"
              aria-label={t('filePreview.pdf.pageInputAria', '当前页')}
            />
            <span className="tabular-nums">/ {totalPages}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goNext}
            disabled={pageIndex >= totalPages - 1}
            title={t('filePreview.pdf.next', '下一页')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_LEVELS[0]}
            title={t('filePreview.pdf.zoomOut', '缩小')}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={handleZoomReset}
            className="rounded px-2 py-0.5 text-xs tabular-nums text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
            title={t('filePreview.pdf.zoomReset', '适配宽度')}
          >
            {zoomLabel}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            title={t('filePreview.pdf.zoomIn', '放大')}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col items-center gap-3 px-4 py-4">
          <div className="relative inline-block shadow-lg ring-1 ring-black/10 dark:ring-white/10">
            <canvas
              ref={canvasRef}
              aria-label={fileName ?? 'PDF preview'}
              className="block bg-white"
            />
            <div ref={textLayerRef} aria-hidden className="pointer-events-none absolute inset-0" />
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
              <span aria-hidden>
                <Loader2 className="h-3.5 w-3.5 animate-pulse text-muted-foreground/40" />
              </span>
              {t('filePreview.pdf.singlePageHint', {
                defaultValue: '使用工具栏在 {{total}} 页之间切换',
                total: totalPages,
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
