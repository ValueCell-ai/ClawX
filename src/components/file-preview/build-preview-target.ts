/**
 * Build a `FilePreviewTarget` from a raw filesystem path, applying
 * mime / content-type defaults.  Lives outside `FilePreviewOverlay.tsx`
 * so importing the helper doesn't bring in the Sheet/Monaco component
 * graph (and so React Fast Refresh stays happy).
 */
import { classifyFileExt, extnameOf, getMimeTypeForExt } from '@/lib/generated-files';
import type { AttachmentRenderPart } from '@/lib/acp/timeline-types';
import { richFilePreviewKind } from '@/lib/file-preview-capabilities';
import type { WorkspaceFileRef } from '@/lib/file-preview-client';
import type { FilePreviewTarget } from './types';

function filePathFromUri(uri: string): string {
  if (/^file:\/\/\//i.test(uri)) {
    try { return decodeURIComponent(uri.slice(7)); } catch { return uri.slice(7); }
  }
  if (/^file:\/\/localhost\//i.test(uri)) {
    try { return decodeURIComponent(uri.slice(16)); } catch { return uri.slice(16); }
  }
  return uri;
}

export function previewDisplayPath(
  file: Pick<FilePreviewTarget, 'filePath' | 'attachmentFileRef' | 'workspaceFileRef'>,
): string {
  if (file.attachmentFileRef) {
    return filePathFromUri(file.attachmentFileRef.uri);
  }
  if (file.workspaceFileRef) {
    const root = file.workspaceFileRef.workspaceRoot.replace(/\\/g, '/');
    const rel = file.workspaceFileRef.relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
    return rel ? `${root}/${rel}` : root;
  }
  return file.filePath;
}

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

export function buildAttachmentPreviewTarget(attachment: AttachmentRenderPart): FilePreviewTarget {
  if (attachment.access.status !== 'available' || attachment.access.target.kind !== 'local') {
    throw new Error('Attachment is not available for preview');
  }
  const fileName = attachment.reference.name;
  const ext = extnameOf(fileName);
  const mimeType = attachment.access.mimeType || getMimeTypeForExt(ext);
  const richPreview = richFilePreviewKind({ ext, mimeType });
  return {
    attachmentFileRef: attachment.access.target.ref,
    filePath: fileName,
    fileName,
    ext,
    mimeType,
    contentType: richPreview === 'image'
      ? 'snapshot'
      : richPreview === 'pdf' || richPreview === 'sheet'
        ? 'document'
        : classifyFileExt(ext),
    size: attachment.access.size,
  };
}
