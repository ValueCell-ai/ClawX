/**
 * Generated files extraction.
 *
 * Inspects a run segment of chat messages (the slice from a user trigger
 * to its terminating assistant reply) and surfaces files the AI wrote /
 * edited via tool calls. Used by `GeneratedFilesPanel` to render inline
 * file cards under each run, and by `FilePreviewBody` / `ArtifactPanel`
 * to power the diff view.
 */
import { diffLines } from 'diff';
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

export type GeneratedFileBaseline =
  | { status: 'ok'; content: string }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: string };

export interface FileLineStats {
  added: number;
  removed: number;
}

export interface GeneratedFile {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  size?: number;
  action: 'created' | 'modified';
  /**
   * Full new content of the file when known (only set by `Write`-family
   * tools that provide the whole document in their input).
   */
  fullContent?: string;
  /**
   * Ordered list of edits applied to this file during the run (Edit /
   * StrReplace / MultiEdit). The diff view renders these directly as a
   * snippet diff (joined `old` vs joined `new`), matching WorkBuddy /
   * Codex behaviour.
   */
  edits?: FileEditOp[];
  /**
   * File content captured immediately before a Write-family tool executed.
   * `missing` means the file did not exist yet. `unavailable` means the
   * renderer could not read the existing file precisely enough to build a
   * trustworthy before/after diff (outside sandbox, binary, too large, ...).
   */
  baseline?: GeneratedFileBaseline;
  /** Index of the latest tool call that touched this file (for stable ordering). */
  lastSeenIndex: number;
}

/** Visual separator between multiple edit hunks. */
const SNIPPET_SEPARATOR = '\n\n';

/**
 * True when the chat extraction captured enough tool payload to render a
 * diff (Write `fullContent` and/or non-empty Edit ops). Entries without
 * this should not appear in generated-file UIs.
 */
export function generatedFileHasDiffPayload(file: Pick<GeneratedFile, 'fullContent' | 'edits'>): boolean {
  if (file.fullContent != null) return true;
  if (file.edits?.length) {
    return file.edits.some((op) => (op.old ?? '') !== '' || (op.new ?? '') !== '');
  }
  return false;
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

const APPLY_PATCH_TOOLS = new Set([
  'apply_patch',
  'ApplyPatch',
  'applyPatch',
]);

const STRUCTURED_PATCH_TOOLS = new Set(['Patch', 'patch']);

const FILE_PATH_KEYS = ['file_path', 'filepath', 'path', 'fileName', 'file_name', 'target_path'];

/** Best-effort detector that mirrors the buckets WorkBuddy uses internally. */
const SNAPSHOT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);
const DOCUMENT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);
const TEXT_DOCUMENT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm',
]);
const PDF_PREVIEW_EXTS = new Set(['.pdf']);
const SHEET_PREVIEW_EXTS = new Set(['.xlsx', '.xls']);
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

export function supportsInlineDocumentPreview(ext: string): boolean {
  const lower = ext.toLowerCase();
  return (
    TEXT_DOCUMENT_EXTS.has(lower)
    || PDF_PREVIEW_EXTS.has(lower)
    || SHEET_PREVIEW_EXTS.has(lower)
  );
}

/** True for binary documents we render via dedicated viewers (PDF / spreadsheet). */
export function supportsRichDocumentPreview(ext: string): boolean {
  const lower = ext.toLowerCase();
  return PDF_PREVIEW_EXTS.has(lower) || SHEET_PREVIEW_EXTS.has(lower);
}

export function isHtmlPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  const lower = ext.toLowerCase();
  return lower === '.html' || lower === '.htm';
}

export function isPdfPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return PDF_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function isSheetPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return SHEET_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function supportsInlineDiff(file: Pick<GeneratedFile, 'ext' | 'contentType'>): boolean {
  if (file.contentType === 'document') {
    if (supportsRichDocumentPreview(file.ext)) return false;
    return supportsInlineDocumentPreview(file.ext);
  }
  if (file.contentType === 'snapshot' || file.contentType === 'video' || file.contentType === 'audio') return false;
  return true;
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

type ApplyPatchFileChange = {
  filePath: string;
  action: 'created' | 'modified';
  fullContent?: string;
  edits?: FileEditOp[];
};

function readApplyPatchText(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (Array.isArray(input) && input.every((item) => typeof item === 'string')) {
    return input.join('\n');
  }
  const rec = asRecord(input);
  if (!rec) return null;
  for (const key of ['patch', 'input', 'text', 'content']) {
    const value = rec[key];
    if (typeof value === 'string' && value.includes('*** ')) return value;
  }
  return null;
}

function parseApplyPatchFiles(input: unknown): ApplyPatchFileChange[] {
  const text = readApplyPatchText(input);
  if (!text) return [];

  const changes: ApplyPatchFileChange[] = [];
  let current: ApplyPatchFileChange | null = null;
  let addLines: string[] = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];

  const flush = () => {
    if (!current) return;
    if (current.action === 'created') {
      current.fullContent = addLines.join('\n');
      if (addLines.length > 0) current.fullContent += '\n';
    } else {
      const oldText = oldLines.length > 0 ? `${oldLines.join('\n')}\n` : '';
      const newText = newLines.length > 0 ? `${newLines.join('\n')}\n` : '';
      current.edits = oldText || newText ? [{ old: oldText, new: newText }] : [];
    }
    changes.push(current);
    current = null;
    addLines = [];
    oldLines = [];
    newLines = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const addMatch = rawLine.match(/^\*\*\* Add File:\s*(.+)$/);
    const updateMatch = rawLine.match(/^\*\*\* Update File:\s*(.+)$/);
    const deleteMatch = rawLine.match(/^\*\*\* Delete File:\s*(.+)$/);
    if (addMatch || updateMatch || deleteMatch || rawLine.startsWith('*** End Patch')) {
      flush();
      if (addMatch?.[1]) {
        current = { filePath: addMatch[1].trim(), action: 'created' };
      } else if (updateMatch?.[1]) {
        current = { filePath: updateMatch[1].trim(), action: 'modified' };
      }
      continue;
    }
    if (!current) continue;
    if (current.action === 'created') {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        addLines.push(rawLine.slice(1));
      }
      continue;
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      newLines.push(rawLine.slice(1));
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      oldLines.push(rawLine.slice(1));
    }
  }
  flush();

  return changes.filter((change) => change.filePath);
}

function parseStructuredPatchFiles(input: unknown): ApplyPatchFileChange[] {
  const parsed = typeof input === 'string'
    ? (() => {
        try {
          return JSON.parse(input) as unknown;
        } catch {
          return input;
        }
      })()
    : input;
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return entries.flatMap((entry): ApplyPatchFileChange[] => {
    const record = asRecord(entry);
    if (!record) return [];
    const filePath = pickStringByKeys(record, FILE_PATH_KEYS);
    const diff = typeof record.diff === 'string' ? record.diff : undefined;
    if (!filePath || diff === undefined) return [];
    const kind = asRecord(record.kind);
    const patchType = (typeof kind?.type === 'string' ? kind.type : typeof record.kind === 'string' ? record.kind : '')
      .toLowerCase();
    if (patchType === 'add' || patchType === 'create') {
      return [{ filePath, action: 'created', fullContent: diff }];
    }
    return [{ filePath, action: 'modified', edits: [{ old: '', new: diff }] }];
  });
}

function determineWriteAction(
  existing: GeneratedFile | undefined,
  baseline: GeneratedFileBaseline | undefined,
): 'created' | 'modified' {
  if (existing?.action === 'created') return 'created';
  if (!baseline) return existing ? 'modified' : 'created';
  return baseline.status === 'missing' ? 'created' : 'modified';
}

function buildGeneratedFile(
  filePath: string,
  action: 'created' | 'modified',
  parts: { fullContent?: string; edits?: FileEditOp[]; baseline?: GeneratedFileBaseline } | undefined,
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
    baseline: parts?.baseline,
    lastSeenIndex: index,
  };
}

function normaliseEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function joinEditText(edits: FileEditOp[], side: 'old' | 'new'): string {
  return edits.map((op) => normaliseEol(op[side] ?? '')).join(SNIPPET_SEPARATOR);
}

function countLogicalLines(text: string): number {
  const normalized = normaliseEol(text);
  if (!normalized) return 0;
  const parts = normalized.split('\n');
  return normalized.endsWith('\n') ? Math.max(1, parts.length - 1) : parts.length;
}

function diffLineStats(oldText: string, newText: string): FileLineStats {
  const pieces = diffLines(normaliseEol(oldText), normaliseEol(newText));
  let added = 0;
  let removed = 0;
  for (const piece of pieces) {
    const count = typeof piece.count === 'number' ? piece.count : countLogicalLines(piece.value);
    if (piece.added) added += count;
    if (piece.removed) removed += count;
  }
  return { added, removed };
}

export function computeLineStats(file: GeneratedFile): FileLineStats | null {
  if (!supportsInlineDiff(file)) return null;

  if (file.edits?.length) {
    return diffLineStats(joinEditText(file.edits, 'old'), joinEditText(file.edits, 'new'));
  }

  if (file.fullContent == null) return null;

  if (file.baseline?.status === 'ok') {
    return diffLineStats(file.baseline.content, file.fullContent);
  }

  if (file.baseline?.status === 'missing') {
    return { added: countLogicalLines(file.fullContent), removed: 0 };
  }

  if (file.baseline?.status === 'unavailable') {
    return null;
  }

  if (file.action === 'created') {
    return { added: countLogicalLines(file.fullContent), removed: 0 };
  }

  return null;
}

/**
 * Walk the messages in `[triggerIndex, segmentEnd]` (inclusive) and
 * collect the unique files written or edited by tool calls in that
 * window. Deduplicates by `filePath`; if the file is touched by both
 * a `Write` and a later `Edit`, the action is upgraded to `'modified'`
 * but the diff content is kept from the last edit.
 */
export function extractGeneratedFiles(
  messages: RawMessage[],
  triggerIndex: number,
  segmentEnd: number,
  baselineGetter?: (filePath: string) => GeneratedFileBaseline | undefined,
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
      const isApplyPatch = APPLY_PATCH_TOOLS.has(name);
      const isStructuredPatch = STRUCTURED_PATCH_TOOLS.has(name);
      if (isApplyPatch || isStructuredPatch) {
        const patchFiles = isStructuredPatch ? parseStructuredPatchFiles(input) : parseApplyPatchFiles(input);
        for (const patchFile of patchFiles) {
          const existing = map.get(patchFile.filePath);
          map.set(patchFile.filePath, buildGeneratedFile(
            patchFile.filePath,
            patchFile.action === 'created' ? determineWriteAction(existing, { status: 'missing' }) : 'modified',
            {
              fullContent: patchFile.fullContent,
              edits: patchFile.edits,
              baseline: patchFile.action === 'created' ? { status: 'missing' } : existing?.baseline,
            },
            i,
          ));
        }
        continue;
      }

      const filePath = pickFilePath(input);
      if (!filePath) continue;

      const isWrite = WRITE_TOOLS.has(name);
      const isEdit = EDIT_TOOLS.has(name);
      const looksLikeFile = isWrite || isEdit || /\.[a-z0-9]{1,8}$/i.test(basenameOf(filePath));
      if (!isWrite && !isEdit && !looksLikeFile) continue;

      const existing = map.get(filePath);

      if (isWrite) {
        const newContent = pickWriteContent(input);
        const baseline = baselineGetter?.(filePath);
        const next = buildGeneratedFile(
          filePath,
          determineWriteAction(existing, baseline),
          { fullContent: newContent, edits: undefined, baseline },
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
            baseline: existing?.baseline,
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
