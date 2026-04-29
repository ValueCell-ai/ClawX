/**
 * Shared types for the file preview pipeline.
 *
 * Lives outside `FilePreviewOverlay.tsx` so callers (chat panel, workspace
 * tree, skills page, …) can import the type without pulling in the Sheet /
 * Monaco component graph.
 */
import type { FileContentType, FileEditOp } from '@/lib/generated-files';

export interface FilePreviewTarget {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  /**
   * Full new content of the file at the time of the edit (set by `Write`-
   * family tools).  When present we can show a "before vs after" diff
   * even if the file no longer exists on disk.
   */
  fullContent?: string;
  /**
   * Edit ops applied during the current run, used to reconstruct the
   * pre-edit content via reverse-application against the on-disk content.
   */
  edits?: FileEditOp[];
}
