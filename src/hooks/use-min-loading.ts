import { useState, useRef, useEffect } from 'react';

/**
 * A hook that ensures a loading state remains true for at least a minimum duration (e.g., 1000ms),
 * preventing flickering for very fast loading times.
 *
 * @param isLoading - The actual loading state from the data source
 * @param minDurationMs - Minimum duration to show loading (default: 1000)
 */
export function useMinLoading(isLoading: boolean, minDurationMs: number = 500) {
  const [showLoading, setShowLoading] = useState(isLoading);
  const startTime = useRef<number>(0);

  // Guarantee that the loading UI activates immediately without any asynchronous delay
  if (isLoading && !showLoading) {
    setShowLoading(true);
  }

  // Record the actual timestamp in an effect to respect React purity rules
  useEffect(() => {
    if (isLoading && startTime.current === 0) {
      startTime.current = Date.now();
    }
  }, [isLoading]);

  useEffect(() => {
    let timeout: NodeJS.Timeout;

    if (!isLoading && showLoading) {
      const elapsed = startTime.current > 0 ? Date.now() - startTime.current : 0;
      const remaining = Math.max(0, minDurationMs - elapsed);

      timeout = setTimeout(() => {
        setShowLoading(false);
        startTime.current = 0;
      }, remaining);
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [isLoading, showLoading, minDurationMs]);

  return isLoading || showLoading;
}
