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

export interface GeneratedFile {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  action: 'created' | 'modified';
  /** Original content before the edit (set for Edit/MultiEdit/StrReplace). */
  oldContent?: string;
  /** New content after the edit (set when known). */
  newContent?: string;
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
  for (const key of ['content', 'contents', 'text', 'body', 'data', 'new_content']) {
    const value = rec[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function pickEditPair(input: unknown): { oldContent?: string; newContent?: string } | null {
  const rec = asRecord(input);
  if (!rec) return null;
  // Single-edit shape: { old_string, new_string }
  const oldStr = typeof rec.old_string === 'string'
    ? rec.old_string
    : typeof rec.oldString === 'string'
      ? rec.oldString
      : typeof rec.find === 'string'
        ? rec.find
        : undefined;
  const newStr = typeof rec.new_string === 'string'
    ? rec.new_string
    : typeof rec.newString === 'string'
      ? rec.newString
      : typeof rec.replace === 'string'
        ? rec.replace
        : undefined;
  if (oldStr !== undefined || newStr !== undefined) {
    return { oldContent: oldStr, newContent: newStr };
  }
  // MultiEdit shape: { edits: [{ old_string, new_string }, ...] }
  const edits = rec.edits;
  if (Array.isArray(edits) && edits.length > 0) {
    const olds: string[] = [];
    const news: string[] = [];
    for (const edit of edits as Array<Record<string, unknown>>) {
      const o = typeof edit.old_string === 'string'
        ? edit.old_string
        : typeof edit.oldString === 'string'
          ? edit.oldString
          : '';
      const n = typeof edit.new_string === 'string'
        ? edit.new_string
        : typeof edit.newString === 'string'
          ? edit.newString
          : '';
      olds.push(o);
      news.push(n);
    }
    return {
      oldContent: olds.length > 0 ? olds.join('\n--- next edit ---\n') : undefined,
      newContent: news.length > 0 ? news.join('\n--- next edit ---\n') : undefined,
    };
  }
  return null;
}

function buildGeneratedFile(
  filePath: string,
  action: 'created' | 'modified',
  pair: { oldContent?: string; newContent?: string } | undefined,
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
    oldContent: pair?.oldContent,
    newContent: pair?.newContent,
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
        const next = buildGeneratedFile(
          filePath,
          existing?.action === 'modified' ? 'modified' : 'created',
          { oldContent: existing?.oldContent, newContent },
          i,
        );
        map.set(filePath, next);
        continue;
      }

      if (isEdit) {
        const pair = pickEditPair(input) ?? undefined;
        const next = buildGeneratedFile(
          filePath,
          'modified',
          {
            oldContent: pair?.oldContent ?? existing?.oldContent,
            newContent: pair?.newContent ?? existing?.newContent,
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
