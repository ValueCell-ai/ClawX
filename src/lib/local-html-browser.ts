import type { AttachmentFileRef, WorkspaceFileRef } from '@/lib/host-api';
import { extnameOf, isHtmlPreviewExt } from '@/lib/generated-files';

export type LocalHtmlBrowserTarget =
  | { kind: 'attachment'; ref: AttachmentFileRef }
  | { kind: 'workspace'; ref: WorkspaceFileRef };

export function absolutePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encodedPath = absolutePath
    .split('/')
    .map((segment, index) => {
      if (index === 0) return '';
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join('/');
  return `file://${encodedPath}`;
}

export function localHtmlBrowserUrl(target: LocalHtmlBrowserTarget, name: string): string | null {
  if (!isHtmlPreviewExt(extnameOf(name))) return null;
  if (target.kind === 'workspace') {
    const root = target.ref.workspaceRoot.replace(/[\\/]+$/, '');
    const relativePath = target.ref.relativePath.replace(/^[\\/]+/, '');
    return absolutePathToFileUrl(`${root}/${relativePath}`);
  }
  try {
    const url = new URL(target.ref.uri);
    if (url.protocol !== 'file:') return null;
    if (!url.hostname) return url.href;
    if (url.hostname.toLowerCase() !== 'localhost') return null;
    return absolutePathToFileUrl(decodeURIComponent(url.pathname));
  } catch {
    return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(target.ref.uri)
      ? absolutePathToFileUrl(target.ref.uri)
      : null;
  }
}

export function htmlPreviewFileUrl(file: {
  attachmentFileRef?: AttachmentFileRef;
  workspaceFileRef?: WorkspaceFileRef;
  filePath: string;
  fileName: string;
  ext: string;
}): string | null {
  if (!isHtmlPreviewExt(file.ext)) return null;
  if (file.attachmentFileRef) {
    return localHtmlBrowserUrl(
      { kind: 'attachment', ref: file.attachmentFileRef },
      file.fileName,
    );
  }
  if (file.workspaceFileRef) {
    return localHtmlBrowserUrl(
      { kind: 'workspace', ref: file.workspaceFileRef },
      file.fileName,
    );
  }
  return absolutePathToFileUrl(file.filePath);
}
