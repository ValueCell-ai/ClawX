/**
 * Drag-to-resize handle that sits between the chat column and the
 * artifact panel on the Chat page.
 *
 * On `pointerdown` we capture the pointer, attach window-level
 * `pointermove` / `pointerup` listeners, and convert the cursor X (in
 * pixels) into a panel-width percentage relative to the supplied
 * `containerRef`.  The new width is clamped via the store.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  ARTIFACT_PANEL_MAX_WIDTH,
  ARTIFACT_PANEL_MIN_WIDTH,
  useArtifactPanel,
} from '@/stores/artifact-panel';

export interface PanelResizeDividerProps {
  /** The flex container that holds chat-left + panel-right. */
  containerRef: React.RefObject<HTMLElement | null>;
  className?: string;
}

export function PanelResizeDivider({ containerRef, className }: PanelResizeDividerProps) {
  const setWidthPct = useArtifactPanel((s) => s.setWidthPct);
  const widthPct = useArtifactPanel((s) => s.widthPct);
  const { t } = useTranslation('chat');
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);
  const minimum = containerWidth ? Math.max(ARTIFACT_PANEL_MIN_WIDTH, 320 / containerWidth * 100) : ARTIFACT_PANEL_MIN_WIDTH;
  const maximum = containerWidth ? Math.max(minimum, Math.min(ARTIFACT_PANEL_MAX_WIDTH, (containerWidth - 280) / containerWidth * 100)) : ARTIFACT_PANEL_MAX_WIDTH;
  const currentWidth = Math.max(minimum, Math.min(maximum, widthPct));
  const resize = useCallback((value: number) => setWidthPct(Math.max(minimum, Math.min(maximum, value))), [minimum, maximum, setWidthPct]);
  // Store window listeners in refs so the up-handler can remove the
  // matching move-handler without a self-referential closure (which the
  // `react-hooks/immutability` rule flags).
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);

  const stopDragging = useCallback(() => {
    if (moveHandlerRef.current) {
      window.removeEventListener('pointermove', moveHandlerRef.current);
      moveHandlerRef.current = null;
    }
    if (upHandlerRef.current) {
      window.removeEventListener('pointerup', upHandlerRef.current);
      upHandlerRef.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on some browsers; window listeners
        // below are sufficient on their own.
      }

      const onMove = (ev: PointerEvent) => {
        const node = containerRef.current;
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0) return;
        // Right panel width = container right edge - cursor X.
        const rightWidth = rect.right - ev.clientX;
        const pct = (rightWidth / rect.width) * 100;
        resize(pct);
      };
      const onUp = () => stopDragging();

      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [containerRef, resize, stopDragging],
  );

  // Safety: if the divider unmounts mid-drag, clean up listeners.
  useEffect(() => stopDragging, [stopDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(currentWidth * 10) / 10}
      aria-label={t('workspace.resizePanel')}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); resize(currentWidth + (event.key === 'ArrowLeft' ? 2 : -2));
        } else if (event.key === 'Home') { event.preventDefault(); resize(minimum); }
        else if (event.key === 'End') { event.preventDefault(); resize(maximum); }
      }}
      onPointerDown={handlePointerDown}
      className={cn(
        'group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize select-none focus-visible:bg-primary/20 focus-visible:outline-none lg:block',
        className,
      )}
      title={t('workspace.resizePanel')}
    >
      {/* Wider hover hit-state */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover:bg-primary/40 group-hover:opacity-100"
      />
    </div>
  );
}

export default PanelResizeDivider;
