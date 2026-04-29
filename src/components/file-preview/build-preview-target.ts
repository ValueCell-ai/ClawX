/**
 * Build a `FilePreviewTarget` from a raw filesystem path, applying
 * mime / content-type defaults.  Lives outside `FilePreviewOverlay.tsx`
 * so importing the helper doesn't bring in the Sheet/Monaco component
 * graph (and so React Fast Refresh stays happy).
 */
import { classifyFileExt, extnameOf, getMimeTypeForExt } from '@/lib/generated-files';
import type { FilePreviewTarget } from './FilePreviewOverlay';

export function buildPreviewTarget(filePath: string, fileName?: string): FilePreviewTarget {
  const ext = extnameOf(filePath);
  const name = fileName || (filePath.replace(/\\/g, '/').split('/').pop() ?? filePath);
  return {
    filePath,
    fileName: name,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
  };
}
