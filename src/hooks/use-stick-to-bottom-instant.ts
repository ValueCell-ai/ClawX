import { useCallback, useEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

const ESCAPE_FROM_LOCK_OFFSET_PX = 70;

/**
 * A wrapper around useStickToBottom that ensures the initial scroll
 * to bottom happens instantly without any visible animation.
 *
 * @param resetKey - When this key changes, the scroll position will be reset to bottom instantly.
 *                   Typically this should be the conversation ID.
 * @param active   - When true (e.g. an AI run is streaming), the scroll position is pinned to the
 *                   very bottom instantly on every layout change — both growth and shrink — so
 *                   tool-heavy runs that churn the layout don't produce erratic up/down jitter.
 *                   Pinning is suppressed once the user manually scrolls up (`escapedFromLock`),
 *                   so it never fights a user reading earlier history.
 */
export function useStickToBottomInstant(resetKey?: string, active = false) {
  const lastKeyRef = useRef(resetKey);
  const hasInitializedRef = useRef(false);

  const result = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  const { scrollRef, contentRef, escapedFromLock, stopScroll } = result;
  const scrollEscapeCleanupRef = useRef<(() => void) | null>(null);

  // Keep the latest "should we pin?" inputs available inside the ResizeObserver
  // callback without re-creating the observer on every render.
  const activeRef = useRef(active);
  const escapedRef = useRef(escapedFromLock);
  useEffect(() => {
    activeRef.current = active;
    escapedRef.current = escapedFromLock;
  }, [active, escapedFromLock]);

  // Instantly glue the scrollbar to the bottom. The library only animates on
  // *positive* resizes and ignores *negative* ones; this covers both so the
  // bar stays at the very bottom through promotion/demotion, graph collapse,
  // and indicator swaps during a run.
  const pinToBottom = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    if (!activeRef.current || escapedRef.current) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [scrollRef]);

  // Combine the library's content ref with our own ResizeObserver so we can
  // react to every layout change (the library's observer only scrolls on
  // growth).
  const pinObserverRef = useRef<ResizeObserver | null>(null);
  const combinedContentRef = useCallback(
    (element: HTMLElement | null) => {
      contentRef(element);

      pinObserverRef.current?.disconnect();
      pinObserverRef.current = null;

      if (!element) return;

      const observer = new ResizeObserver(() => {
        pinToBottom();
        // A trailing frame lets the library's own scroll settle first so our
        // instant pin wins the final position.
        requestAnimationFrame(() => pinToBottom());
      });
      observer.observe(element);
      pinObserverRef.current = observer;
    },
    [contentRef, pinToBottom],
  );

  const combinedScrollRef = useCallback(
    (element: HTMLElement | null) => {
      scrollRef(element);

      scrollEscapeCleanupRef.current?.();
      scrollEscapeCleanupRef.current = null;

      if (!element) return;

      let lastScrollTop = element.scrollTop;
      const handleScroll = () => {
        // Only relevant while a run is actively pinning to the bottom.
        if (!activeRef.current) return;

        const scrollTop = element.scrollTop;
        const distanceFromBottom = element.scrollHeight - element.clientHeight - scrollTop;
        // Match the library's escape semantics: upward manual scroll only.
        // Calling stopScroll while scrolling *down* (e.g. scroll-to-latest smooth
        // animation) would cancel the animation before it reaches the bottom.
        if (distanceFromBottom > ESCAPE_FROM_LOCK_OFFSET_PX && scrollTop < lastScrollTop) {
          stopScroll();
        }
        lastScrollTop = scrollTop;
      };
      element.addEventListener("scroll", handleScroll, { passive: true });
      scrollEscapeCleanupRef.current = () => element.removeEventListener("scroll", handleScroll);
    },
    [scrollRef, stopScroll],
  );

  useEffect(() => {
    return () => {
      pinObserverRef.current?.disconnect();
      pinObserverRef.current = null;
      scrollEscapeCleanupRef.current?.();
      scrollEscapeCleanupRef.current = null;
    };
  }, []);

  // Reset initialization when key changes
  useEffect(() => {
    if (resetKey !== lastKeyRef.current) {
      hasInitializedRef.current = false;
      lastKeyRef.current = resetKey;
    }
  }, [resetKey]);

  // Scroll to bottom instantly on mount or when key changes
  useEffect(() => {
    if (hasInitializedRef.current) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    // Hide, scroll, reveal pattern to avoid visible animation
    scrollElement.style.visibility = "hidden";

    // Use double RAF to ensure content is rendered
    const frame1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Direct scroll to bottom
        scrollElement.scrollTop = scrollElement.scrollHeight;

        // Small delay to ensure scroll is applied
        setTimeout(() => {
          scrollElement.style.visibility = "";
          hasInitializedRef.current = true;
        }, 0);
      });
    });

    return () => cancelAnimationFrame(frame1);
  }, [scrollRef, resetKey]);

  return { ...result, scrollRef: combinedScrollRef, contentRef: combinedContentRef };
}
