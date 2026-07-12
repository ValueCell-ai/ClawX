/**
 * Build a `FilePreviewTarget` from a raw filesystem path, applying
 * mime / content-type defaults.  Lives outside `FilePreviewOverlay.tsx`
 * so importing the helper doesn't bring in the Sheet/Monaco component
 * graph (and so React Fast Refresh stays happy).
 */
import { classifyFileExt, extnameOf, getMimeTypeForExt } from '@/lib/generated-files';
import type { WorkspaceFileRef } from '@/lib/file-preview-client';
import type { FilePreviewTarget } from './types';

type WorkspacePreviewMetadata = Partial<Omit<
  FilePreviewTarget,
  'workspaceFileRef' | 'filePath' | 'fileName' | 'ext' | 'mimeType' | 'contentType'
>>;

export function buildPreviewTarget(filePath: string, fileName?: string, size?: number): FilePreviewTarget {
  const ext = extnameOf(filePath);
  const name = fileName || (filePath.replace(/\\/g, '/').split('/').pop() ?? filePath);
  return {
    filePath,
    fileName: name,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
    size,
  };
}

export function buildWorkspacePreviewTarget(
  ref: WorkspaceFileRef,
  metadata: WorkspacePreviewMetadata = {},
): FilePreviewTarget {
  const filePath = ref.relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const ext = extnameOf(filePath);
  return {
    ...metadata,
    workspaceFileRef: ref,
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
  };
}
