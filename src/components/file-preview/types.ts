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
   * From chat extraction only.  Drives the badge in the changes list and is
   * not used by the diff view itself (which derives "before/after" from
   * `fullContent` / `edits` directly, WorkBuddy-style).
   */
  action?: 'created' | 'modified';
  /**
   * Full new content of the file when the tool payload provides it (Write
   * family).  The diff view renders this as `null vs fullContent`, i.e. a
   * "new file" diff with an empty left pane.
   */
  fullContent?: string;
  /**
   * Edit operations from Edit / StrReplace / MultiEdit.  The diff view
   * renders these directly as a snippet diff (left = joined `op.old`,
   * right = joined `op.new`) — exactly what the AI changed, no disk
   * reads, no reverse-application.
   */
  edits?: FileEditOp[];
}
