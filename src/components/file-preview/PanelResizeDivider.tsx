/**
 * Drag-to-resize handle that sits between the chat column and the
 * artifact panel on the Chat page.
 *
 * On `pointerdown` we capture the pointer, attach window-level
 * `pointermove` / `pointerup` listeners, and convert the cursor X (in
 * pixels) into a panel-width percentage relative to the supplied
 * `containerRef`.  The new width is clamped via the store.
 */
import { useCallback, useEffect, useRef } from 'react';
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
        setWidthPct(pct);
      };
      const onUp = () => stopDragging();

      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [containerRef, setWidthPct, stopDragging],
  );

  // Safety: if the divider unmounts mid-drag, clean up listeners.
  useEffect(() => stopDragging, [stopDragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={ARTIFACT_PANEL_MIN_WIDTH}
      aria-valuemax={ARTIFACT_PANEL_MAX_WIDTH}
      onPointerDown={handlePointerDown}
      className={cn(
        'group relative z-10 hidden w-1.5 shrink-0 cursor-col-resize select-none lg:block',
        className,
      )}
      title="拖动调整宽度"
    >
      {/* Hairline (visible all the time) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/5 transition-colors group-hover:bg-primary/40 dark:bg-white/10"
      />
      {/* Wider hover hit-state */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover:bg-primary/40 group-hover:opacity-100"
      />
    </div>
  );
}

export default PanelResizeDivider;
