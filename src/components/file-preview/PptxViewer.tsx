import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import {
  readAttachmentBinary,
  readBinaryFile,
  readWorkspaceBinary,
} from '@/lib/file-preview-client';
import { cn } from '@/lib/utils';
import { FILE_PREVIEW_MAX_OFFICE_BYTES } from '@shared/file-preview/limits';
import type { OfficeViewerProps } from './DocxViewer';
import { getFilePreviewTargetIdentity } from './types';

export interface PptxViewerProps extends OfficeViewerProps {
  initialSlideIndex?: number;
  onSlideIndexChange?: (index: number) => void;
}

interface PositiveSize {
  height: number;
  width: number;
}

type ViewerState =
  | { identity: string; status: 'loading' }
  | { identity: string; status: 'tooLarge'; size?: number }
  | { identity: string; status: 'error' }
  | {
    identity: string;
    status: 'ready';
    currentSlideIndex: number;
    rendering: boolean;
    slideCount: number;
  };

interface PendingAnimationFrame {
  id: number;
  resolve: (completed: boolean) => void;
}

let hasActiveDevelopmentInstance = false;
// Every dependency operation shares one queue because pptxviewjs@1.1.9 uses
// Renderer-global chart/ZIP state and active operations cannot be cancelled.
let sharedOperationQueue: Promise<void> = Promise.resolve();

function schedulePptxOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  const result = sharedOperationQueue.then(operation);
  sharedOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function readPositiveSize(element: HTMLElement | null): PositiveSize | null {
  if (!element) return null;
  const width = element.clientWidth;
  const height = element.clientHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}

async function waitForPositiveSize(
  element: HTMLElement,
  pendingFrames: Set<PendingAnimationFrame>,
  maxFrames = 60,
): Promise<PositiveSize | null> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const size = readPositiveSize(element);
    if (size) return size;
    if (frame === maxFrames - 1) break;

    const completed = await new Promise<boolean>((resolve) => {
      const pendingFrame: PendingAnimationFrame = {
        id: requestAnimationFrame(() => {
          pendingFrames.delete(pendingFrame);
          resolve(true);
        }),
        resolve,
      };
      pendingFrames.add(pendingFrame);
    });
    if (!completed) return null;
  }

  return null;
}

export default function PptxViewer({
  filePath,
  fileName,
  attachmentFileRef,
  workspaceFileRef,
  initialSlideIndex = 0,
  onSlideIndexChange,
  onTooLarge,
  className,
}: PptxViewerProps) {
  const { t } = useTranslation('chat');
  const loadIdentity = getFilePreviewTargetIdentity({ filePath, attachmentFileRef, workspaceFileRef });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const committedIdentityRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const initialSlideIndexRef = useRef(initialSlideIndex);
  const onSlideIndexChangeRef = useRef(onSlideIndexChange);
  const onTooLargeRef = useRef(onTooLarge);
  const renderNavigationRef = useRef<((slideIndex: number, size: PositiveSize) => void) | null>(null);
  const [storedState, setState] = useState<ViewerState>({
    identity: loadIdentity,
    status: 'loading',
  });

  const state: ViewerState = storedState.identity === loadIdentity
    ? storedState
    : { identity: loadIdentity, status: 'loading' };

  initialSlideIndexRef.current = initialSlideIndex;

  useLayoutEffect(() => {
    onSlideIndexChangeRef.current = onSlideIndexChange;
    onTooLargeRef.current = onTooLarge;
  }, [onSlideIndexChange, onTooLarge]);

  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    if (hasActiveDevelopmentInstance) {
      throw new Error('PptxViewer requires a single active instance');
    }

    // pptxviewjs@1.1.9 shares chart/ZIP globals across instances.
    // See harness/reference/office-document-preview.md#single-pptx-instance.
    hasActiveDevelopmentInstance = true;
    return () => {
      hasActiveDevelopmentInstance = false;
    };
  }, []);

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    committedIdentityRef.current = loadIdentity;

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      if (committedIdentityRef.current === loadIdentity) committedIdentityRef.current = null;
    };
  }, [loadIdentity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasContainer = canvasContainerRef.current;
    const generation = generationRef.current;
    if (!canvas || !canvasContainer) return;

    let terminated = false;
    let chartRefreshPending = false;
    let chartRefreshRequested = false;
    let chartListenerAttached = false;
    let handleChartRenderingComplete: (() => void) | null = null;
    let destroyPromise: Promise<void> | null = null;
    let latestRequestId = 0;
    let latestRequestedSlide = 0;
    let pendingSlideChange: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let slideCount = 0;
    let viewer: import('pptxviewjs').PPTXViewer | null = null;
    const pendingFrames = new Set<PendingAnimationFrame>();
    let latestRequest: {
      generation: number;
      id: number;
      slideIndex: number;
      size: PositiveSize;
    } | null = null;

    const ownsCurrentIdentity = () => (
      generationRef.current === generation
      && committedIdentityRef.current === loadIdentity
    );
    const isCurrent = () => !terminated && ownsCurrentIdentity();
    const clearOwnedResources = () => {
      latestRequest = null;
      pendingSlideChange = null;
      chartRefreshPending = false;
      chartRefreshRequested = false;
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (chartListenerAttached && handleChartRenderingComplete) {
        window.removeEventListener('chartRenderingComplete', handleChartRenderingComplete);
      }
      chartListenerAttached = false;
      handleChartRenderingComplete = null;
      for (const pendingFrame of pendingFrames) {
        cancelAnimationFrame(pendingFrame.id);
        pendingFrame.resolve(false);
      }
      pendingFrames.clear();
      if (renderNavigationRef.current === renderNavigation) renderNavigationRef.current = null;
    };
    const destroyViewerInOrder = () => {
      if (destroyPromise) return destroyPromise;
      const instance = viewer;
      if (!instance) return Promise.resolve();
      viewer = null;
      destroyPromise = schedulePptxOperation(() => {
        instance.destroy();
      }).catch(() => undefined);
      return destroyPromise;
    };
    const terminate = (status?: 'error' | 'tooLarge', size?: number) => {
      if (terminated) return destroyPromise ?? Promise.resolve();
      terminated = true;
      clearOwnedResources();
      const disposal = destroyViewerInOrder();
      if (status) {
        const publish = () => {
          if (!ownsCurrentIdentity()) return;
          setState(status === 'tooLarge'
            ? { identity: loadIdentity, status, size }
            : { identity: loadIdentity, status });
          if (status === 'tooLarge') onTooLargeRef.current?.(size);
        };
        if (viewer || destroyPromise) void disposal.then(publish, publish);
        else publish();
      }
      return disposal;
    };
    const setCurrentState = (nextState: ViewerState) => {
      if (isCurrent()) setState(nextState);
    };
    const enqueueRender = (
      slideIndex: number,
      size: PositiveSize,
      slideCount: number,
      notifySlideChange: boolean,
    ) => {
      if (!viewer || !isCurrent()) return Promise.resolve(false);

      latestRequestedSlide = slideIndex;
      if (notifySlideChange) pendingSlideChange = slideIndex;
      const request = {
        generation,
        id: ++latestRequestId,
        slideIndex,
        size,
      };
      latestRequest = request;
      if (isCurrent()) {
        setState((currentState) => (
          currentState.identity === loadIdentity && currentState.status === 'ready'
            ? { ...currentState, rendering: true }
            : {
              identity: loadIdentity,
              status: 'ready',
              currentSlideIndex: slideIndex,
              rendering: true,
              slideCount,
            }
        ));
      }

      const instance = viewer;
      if (!instance) return Promise.resolve(false);
      const renderResult = schedulePptxOperation(async () => {
        if (!isCurrent() || latestRequest !== request || request.generation !== generation) return false;

        canvas.style.width = `${request.size.width}px`;
        canvas.style.height = `${request.size.height}px`;
        await instance.render(canvas, { slideIndex: request.slideIndex });
        if (!isCurrent() || latestRequest !== request) return false;

        setCurrentState({
          identity: loadIdentity,
          status: 'ready',
          currentSlideIndex: request.slideIndex,
          rendering: false,
          slideCount,
        });
        if (pendingSlideChange === request.slideIndex) {
          pendingSlideChange = null;
          onSlideIndexChangeRef.current?.(request.slideIndex);
        }
        return true;
      }).catch(() => {
        if (isCurrent()) {
          if (pendingSlideChange === request.slideIndex) pendingSlideChange = null;
          void terminate('error');
        }
        return false;
      });
      return renderResult;
    };
    const renderNavigation = (slideIndex: number, size: PositiveSize) => {
      if (slideCount > 0) void enqueueRender(slideIndex, size, slideCount, true);
    };
    renderNavigationRef.current = renderNavigation;

    setState({ identity: loadIdentity, status: 'loading' });

    void (async () => {
      try {
        if (attachmentFileRef && workspaceFileRef) {
          void terminate('error');
          return;
        }

        const result = attachmentFileRef
          ? await readAttachmentBinary(attachmentFileRef, FILE_PREVIEW_MAX_OFFICE_BYTES)
          : workspaceFileRef
            ? await readWorkspaceBinary({ ...workspaceFileRef, maxBytes: FILE_PREVIEW_MAX_OFFICE_BYTES })
            : await readBinaryFile(filePath, { maxBytes: FILE_PREVIEW_MAX_OFFICE_BYTES });
        if (!isCurrent()) return;
        if (!result.ok && result.error === 'tooLarge') {
          void terminate('tooLarge', result.size);
          return;
        }
        if (!result.ok || !result.data || result.data.byteLength === 0) {
          void terminate('error');
          return;
        }
        const bytes = result.data;

        const { PPTXViewer } = await import('pptxviewjs');
        if (!isCurrent()) return;
        await schedulePptxOperation(() => {
          if (!isCurrent()) return;
          viewer = new PPTXViewer({
            canvas,
            enableThumbnails: false,
            slideSizeMode: 'fit',
            backgroundColor: '#ffffff',
            autoChartRerenderDelayMs: 0,
          });
        });
        const instance = viewer as import('pptxviewjs').PPTXViewer | null;
        if (!isCurrent() || !instance) {
          void destroyViewerInOrder();
          return;
        }
        await schedulePptxOperation(async () => {
          if (!isCurrent()) return;
          await instance.loadFile(bytes);
        });
        if (!isCurrent()) {
          void destroyViewerInOrder();
          return;
        }

        slideCount = await schedulePptxOperation(() => (
          isCurrent() ? instance.getSlideCount() : 0
        ));
        if (!isCurrent()) return;
        if (slideCount <= 0) throw new Error('Presentation contains no slides');

        const enqueueCurrentRefresh = () => {
          const size = readPositiveSize(canvasContainer);
          if (!size) return Promise.resolve(false);
          return enqueueRender(latestRequestedSlide, size, slideCount, false);
        };
        handleChartRenderingComplete = () => {
          if (!isCurrent()) return;
          if (chartRefreshPending) {
            chartRefreshRequested = true;
            return;
          }
          chartRefreshPending = true;
          void (async () => {
            try {
              do {
                chartRefreshRequested = false;
                await enqueueCurrentRefresh();
              } while (isCurrent() && chartRefreshRequested);
            } finally {
              chartRefreshPending = false;
            }
          })();
        };
        window.addEventListener('chartRenderingComplete', handleChartRenderingComplete);
        chartListenerAttached = true;

        const initialSize = await waitForPositiveSize(canvasContainer, pendingFrames);
        if (!isCurrent()) return;
        if (!initialSize) throw new Error('Presentation preview has no renderable size');

        await enqueueRender(0, initialSize, slideCount, true);
        if (!isCurrent()) return;
        const requestedInitialSlide = Number.isFinite(initialSlideIndexRef.current)
          ? Math.trunc(initialSlideIndexRef.current)
          : 0;
        const restoredSlideIndex = Math.min(
          slideCount - 1,
          Math.max(0, requestedInitialSlide),
        );
        if (restoredSlideIndex !== 0) {
          const restoreSize = readPositiveSize(canvasContainer);
          if (!restoreSize) throw new Error('Presentation preview has no renderable size');
          await enqueueRender(restoredSlideIndex, restoreSize, slideCount, true);
          if (!isCurrent()) return;
        }

        resizeObserver = new ResizeObserver(() => {
          if (!isCurrent()) return;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            resizeTimer = null;
            void enqueueCurrentRefresh();
          }, 100);
        });
        resizeObserver.observe(canvasContainer);
      } catch {
        if (isCurrent()) void terminate('error');
      }
    })();

    return () => {
      void terminate();
    };
  }, [attachmentFileRef, filePath, loadIdentity, workspaceFileRef]);

  const handlePrevious = () => {
    if (state.status !== 'ready' || state.rendering || state.currentSlideIndex <= 0) return;
    const size = readPositiveSize(canvasContainerRef.current);
    if (!size) return;
    renderNavigationRef.current?.(state.currentSlideIndex - 1, size);
  };
  const handleNext = () => {
    if (
      state.status !== 'ready'
      || state.rendering
      || state.currentSlideIndex >= state.slideCount - 1
    ) return;
    const size = readPositiveSize(canvasContainerRef.current);
    if (!size) return;
    renderNavigationRef.current?.(state.currentSlideIndex + 1, size);
  };

  return (
    <div
      data-testid="pptx-viewer"
      className={cn('relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-input/35', className)}
    >
      <div
        ref={canvasContainerRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <canvas
          key={loadIdentity}
          ref={canvasRef}
          data-testid="pptx-canvas"
          aria-label={fileName}
          className="block max-h-full max-w-full bg-white shadow-sm"
        />
      </div>
      {state.status === 'ready' && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-black/10 bg-surface-input/40 px-2 py-1 text-xs text-muted-foreground dark:border-white/10">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handlePrevious}
            disabled={state.rendering || state.currentSlideIndex <= 0}
            aria-label={t('filePreview.pptx.previous', 'Previous slide')}
            title={t('filePreview.pptx.previous', 'Previous slide')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-16 text-center tabular-nums">
            {t('filePreview.pptx.slidePosition', {
              defaultValue: '{{current}} / {{total}}',
              current: state.currentSlideIndex + 1,
              total: state.slideCount,
            })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleNext}
            disabled={state.rendering || state.currentSlideIndex >= state.slideCount - 1}
            aria-label={t('filePreview.pptx.next', 'Next slide')}
            title={t('filePreview.pptx.next', 'Next slide')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      {state.status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35">
          <LoadingSpinner />
        </div>
      )}
      {state.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35 px-6 text-center text-sm text-destructive">
          {t('filePreview.pptx.loadFailed', 'Presentation failed to load')}
        </div>
      )}
      {state.status === 'tooLarge' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-input/35 px-6 text-center text-sm text-muted-foreground">
          {t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
        </div>
      )}
    </div>
  );
}
