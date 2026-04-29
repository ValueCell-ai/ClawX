/**
 * Generated files extraction.
 *
 * Inspects a run segment of chat messages (the slice from a user trigger
 * to its terminating assistant reply) and surfaces files the AI wrote /
 * edited via tool calls.  Used by `GeneratedFilesPanel` to render
 * inline file cards under each run, and by `FilePreviewOverlay` to
 * power the diff view.
 */
import type { ContentBlock, RawMessage } from '@/stores/chat';

export type FileContentType =
  | 'snapshot'
  | 'code'
  | 'document'
  | 'video'
  | 'audio'
  | 'other';

/** A single (old_string -> new_string) replacement extracted from an edit tool. */
export interface FileEditOp {
  old: string;
  new: string;
}

export interface GeneratedFile {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  action: 'created' | 'modified';
  /**
   * Full new content of the file when known (only set by `Write`-family
   * tools that provide the whole document in their input).
   */
  fullContent?: string;
  /**
   * Ordered list of edits applied to this file during the run (Edit /
   * StrReplace / MultiEdit).  The diff view renders these directly as a
   * snippet diff (joined `old` vs joined `new`), matching WorkBuddy /
   * Codex behaviour.
   */
  edits?: FileEditOp[];
  /** Index of the latest tool call that touched this file (for stable ordering). */
  lastSeenIndex: number;
}

const WRITE_TOOLS = new Set([
  'Write',
  'write_file',
  'create_file',
  'WriteFile',
  'createFile',
  'write',
]);

const EDIT_TOOLS = new Set([
  'Edit',
  'edit',
  'edit_file',
  'EditFile',
  'StrReplace',
  'str_replace',
  'str_replace_editor',
  'MultiEdit',
  'multi_edit',
  'multiEdit',
]);

const FILE_PATH_KEYS = ['file_path', 'filepath', 'path', 'fileName', 'file_name', 'target_path'];

/** Best-effort detector that mirrors the buckets WorkBuddy uses internally. */
const SNAPSHOT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);
const DOCUMENT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.ps1',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sql', '.lua', '.r', '.dart',
]);

const EXT_MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
};

export function getMimeTypeForExt(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function classifyFileExt(ext: string): FileContentType {
  const lower = ext.toLowerCase();
  if (SNAPSHOT_EXTS.has(lower)) return 'snapshot';
  if (VIDEO_EXTS.has(lower)) return 'video';
  if (AUDIO_EXTS.has(lower)) return 'audio';
  if (DOCUMENT_EXTS.has(lower)) return 'document';
  if (CODE_EXTS.has(lower)) return 'code';
  return 'other';
}

export function basenameOf(path: string): string {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  const last = norm.lastIndexOf('/');
  return last >= 0 ? norm.slice(last + 1) : norm;
}

export function extnameOf(path: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot);
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  return input as Record<string, unknown>;
}

function pickFilePath(input: unknown): string | null {
  const rec = asRecord(input);
  if (!rec) return null;
  for (const key of FILE_PATH_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickWriteContent(input: unknown): string | undefined {
  const rec = asRecord(input);
  if (!rec) return undefined;
  for (const key of [
    'content',
    'contents',
    'text',
    'body',
    'data',
    'new_content',
    'new_string',
    'newString',
    'string',
    'source',
  ]) {
    const value = rec[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// Aliases mirror WorkBuddy's tool-arg normaliser so we accept whichever
// naming convention the agent emits (Codex, Claude, Cursor, Cline …).
const OLD_KEYS = [
  'old_string', 'oldString', 'old_str', 'oldStr',
  'old_text', 'oldText',
  'old', 'oldContent', 'before', 'find', 'search',
];
const NEW_KEYS = [
  'new_string', 'newString', 'new_str', 'newStr',
  'new_text', 'newText',
  'new', 'newContent', 'after', 'replace', 'replacement',
];

function pickStringByKeys(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function pickEditOps(input: unknown): FileEditOp[] {
  const rec = asRecord(input);
  if (!rec) return [];
  const ops: FileEditOp[] = [];
  const singleOld = pickStringByKeys(rec, OLD_KEYS);
  const singleNew = pickStringByKeys(rec, NEW_KEYS);
  if (singleOld !== undefined || singleNew !== undefined) {
    ops.push({ old: singleOld ?? '', new: singleNew ?? '' });
  }
  const edits = rec.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits as Array<Record<string, unknown>>) {
      const o = pickStringByKeys(edit, OLD_KEYS) ?? '';
      const n = pickStringByKeys(edit, NEW_KEYS) ?? '';
      if (o !== '' || n !== '') ops.push({ old: o, new: n });
    }
  }
  return ops;
}

function buildGeneratedFile(
  filePath: string,
  action: 'created' | 'modified',
  parts: { fullContent?: string; edits?: FileEditOp[] } | undefined,
  index: number,
): GeneratedFile {
  const fileName = basenameOf(filePath);
  const ext = extnameOf(filePath);
  return {
    filePath,
    fileName,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
    action,
    fullContent: parts?.fullContent,
    edits: parts?.edits,
    lastSeenIndex: index,
  };
}

/**
 * Walk the messages in `[triggerIndex, segmentEnd]` (inclusive) and
 * collect the unique files written or edited by tool calls in that
 * window.  Deduplicates by `filePath`; if the file is touched by both
 * a `Write` and a later `Edit`, the action is upgraded to `'modified'`
 * but the diff content is kept from the last edit.
 */
export function extractGeneratedFiles(
  messages: RawMessage[],
  triggerIndex: number,
  segmentEnd: number,
): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  const start = Math.max(0, Math.min(triggerIndex + 1, messages.length));
  const end = Math.max(start - 1, Math.min(segmentEnd, messages.length - 1));

  for (let i = start; i <= end; i += 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as ContentBlock[]) {
      if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
      const name = typeof block.name === 'string' ? block.name : '';
      if (!name) continue;
      const input = block.input ?? block.arguments;
      const filePath = pickFilePath(input);
      if (!filePath) continue;

      const isWrite = WRITE_TOOLS.has(name);
      const isEdit = EDIT_TOOLS.has(name);
      const looksLikeFile = isWrite || isEdit || /\.[a-z0-9]{1,8}$/i.test(basenameOf(filePath));
      if (!isWrite && !isEdit && !looksLikeFile) continue;

      const existing = map.get(filePath);

      if (isWrite) {
        const newContent = pickWriteContent(input);
        // Write replaces the whole document — drop any earlier edits we
        // accumulated and use the snapshot directly.
        const next = buildGeneratedFile(
          filePath,
          existing ? 'modified' : 'created',
          { fullContent: newContent, edits: undefined },
          i,
        );
        map.set(filePath, next);
        continue;
      }

      if (isEdit) {
        const newOps = pickEditOps(input);
        const next = buildGeneratedFile(
          filePath,
          'modified',
          {
            fullContent: existing?.fullContent,
            edits: [...(existing?.edits ?? []), ...newOps],
          },
          i,
        );
        map.set(filePath, next);
        continue;
      }

      // Unknown tool but its input mentions a file path with extension —
      // surface as best-effort "modified" without diff content.
      if (!existing) {
        map.set(filePath, buildGeneratedFile(filePath, 'modified', undefined, i));
      } else {
        existing.lastSeenIndex = i;
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.lastSeenIndex - b.lastSeenIndex);
}

