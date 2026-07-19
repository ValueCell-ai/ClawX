import { useCallback } from 'react';
import { useArtifactPanel } from '@/stores/artifact-panel';

export function WebBrowserAnchor() {
  const registerAnchor = useCallback((anchor: HTMLDivElement | null) => {
    useArtifactPanel.getState().setWebBrowserAnchor(anchor);
  }, []);

  return (
    <div
      ref={registerAnchor}
      data-testid="web-browser-anchor"
      className="h-full min-h-0 w-full"
    />
  );
}
