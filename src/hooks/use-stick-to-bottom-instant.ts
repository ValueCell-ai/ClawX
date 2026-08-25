import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

const AT_BOTTOM_OFFSET_PX = 2;

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

  const { scrollRef, contentRef, scrollToBottom, state, stopScroll } = result;
  const scrollEscapeCleanupRef = useRef<(() => void) | null>(null);
  const manuallyPausedRef = useRef(false);

  // Keep the latest "should we pin?" input available inside the ResizeObserver
  // callback without re-creating the observer on every render. The library's
  // mutable state is read directly because it records an escape synchronously;
  // its rendered `escapedFromLock` value can lag behind a streaming resize.
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Instantly glue the scrollbar to the bottom. The library only animates on
  // *positive* resizes and ignores *negative* ones; this covers both so the
  // bar stays at the very bottom through promotion/demotion, graph collapse,
  // and indicator swaps during a run.
  const pinToBottom = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    if (!activeRef.current || manuallyPausedRef.current || state.escapedFromLock) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [scrollRef, state]);

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
      let lastScrollHeight = element.scrollHeight;
      const handleScroll = () => {
        const scrollTop = element.scrollTop;
        const scrollHeight = element.scrollHeight;
        const distanceFromBottom = scrollHeight - element.clientHeight - scrollTop;

        if (distanceFromBottom <= AT_BOTTOM_OFFSET_PX) {
          manuallyPausedRef.current = false;
        } else if (
          activeRef.current
          && scrollTop < lastScrollTop
          && scrollHeight >= lastScrollHeight
        ) {
          // Pause immediately on even a small upward movement. Waiting until the
          // user is far from the bottom lets the next streaming resize pull the
          // viewport back down before the user can escape. Ignore height shrink,
          // which can lower scrollTop without any user interaction.
          manuallyPausedRef.current = true;
          stopScroll();
        }

        lastScrollTop = scrollTop;
        lastScrollHeight = scrollHeight;
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
      manuallyPausedRef.current = false;
      lastKeyRef.current = resetKey;
    }
  }, [resetKey]);

  const resumeAndScrollToBottom = useCallback<typeof scrollToBottom>((options) => {
    manuallyPausedRef.current = false;
    return scrollToBottom(options);
  }, [scrollToBottom]);

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

  return {
    ...result,
    scrollRef: combinedScrollRef,
    contentRef: combinedContentRef,
    scrollToBottom: resumeAndScrollToBottom,
  };
}
