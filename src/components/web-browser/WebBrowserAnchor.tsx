import { useCallback } from 'react';
import { useArtifactPanel } from '@/stores/artifact-panel';

export function HtmlPreviewAnchor() {
  const registerAnchor = useCallback((anchor: HTMLDivElement | null) => {
    useArtifactPanel.getState().setHtmlPreviewAnchor(anchor);
  }, []);

  return (
    <div
      ref={registerAnchor}
      data-testid="html-preview-anchor"
      className="h-full min-h-0 w-full"
    />
  );
}
