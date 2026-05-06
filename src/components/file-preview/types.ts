/**
 * Shared types for the file preview pipeline.
 *
 * Lives outside `FilePreviewOverlay.tsx` so callers (chat panel, workspace
 * tree, skills page, …) can import the type without pulling in the Sheet /
 * Monaco component graph.
 */
import type { FileContentType, FileEditOp, GeneratedFileBaseline } from '@/lib/generated-files';

export interface FilePreviewTarget {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  /** Known file size from chat attachment metadata, when available. */
  size?: number;
  /**
   * From chat extraction only.  Drives the badge in the changes list and is
   * not used by the diff view itself (which derives "before/after" from
   * `fullContent` / `edits` directly, WorkBuddy-style).
   */
  action?: 'created' | 'modified';
  /**
   * Full new content of the file when the tool payload provides it (Write
   * family).
   */
  fullContent?: string;
  /**
   * Content of the file *before* the AI's write, captured from disk when
   * the tool_use was first detected in the stream.
   *
   * - `ok`         → render a real before/after diff
   * - `missing`    → render a new-file diff (empty left pane)
   * - `unavailable`→ avoid pretending the file was new; show diff unavailable
   */
  baseline?: GeneratedFileBaseline;
  /**
   * Edit operations from Edit / StrReplace / MultiEdit.  The diff view
   * renders these directly as a snippet diff (left = joined `op.old`,
   * right = joined `op.new`) — exactly what the AI changed, no disk
   * reads, no reverse-application.
   */
  edits?: FileEditOp[];
}
