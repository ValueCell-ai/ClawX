import { useLayoutEffect, useRef, useState } from 'react';
import { useHtmlPreview } from '@/stores/html-preview';
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { WebBrowserHost } from './WebBrowserHost';

export function HtmlPreviewAnchor({ file, active }: { file: FilePreviewTarget; active: boolean }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [owner] = useState(() => Symbol('html-reader'));
  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    useHtmlPreview.getState().register({ owner, file, anchor: anchorRef.current, active });
    return () => useHtmlPreview.getState().unregister(owner);
  }, [file, active, owner]);

  return (
    <div
      ref={anchorRef}
      data-testid="html-preview-anchor"
      className="relative h-full min-h-0 w-full"
    ><WebBrowserHost owner={owner} /></div>
  );
}
