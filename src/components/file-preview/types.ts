/**
 * Shared types for the file preview pipeline.
 *
 * Lives outside `FilePreviewOverlay.tsx` so callers (chat panel, workspace
 * tree, skills page, …) can import the type without pulling in the Sheet /
 * Monaco component graph.
 */
import type { FileContentType } from '@/lib/generated-files';
import type { AttachmentFileRef, WorkspaceFileRef } from '@/lib/file-preview-client';

export interface FilePreviewTarget {
  attachmentFileRef?: AttachmentFileRef;
  workspaceFileRef?: WorkspaceFileRef;
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  /** Known file size from chat attachment metadata, when available. */
  size?: number;
  /** From file activity metadata, when available. */
  action?: 'created' | 'modified';
}

export function getFilePreviewTargetIdentity(
  target: Pick<FilePreviewTarget, 'attachmentFileRef' | 'filePath' | 'workspaceFileRef'>,
): string {
  return target.attachmentFileRef
    ? `attachment:${JSON.stringify([
      target.attachmentFileRef.sessionKey,
      target.attachmentFileRef.generation,
      target.attachmentFileRef.uri,
      target.attachmentFileRef.stagingId,
      target.attachmentFileRef.transcriptMessageId,
    ])}`
    : target.workspaceFileRef
    ? `workspace:${JSON.stringify([
      target.workspaceFileRef.workspaceRoot,
      target.workspaceFileRef.relativePath,
    ])}`
    : `trusted:${target.filePath}`;
}
