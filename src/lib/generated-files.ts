export type FileContentType =
  | 'snapshot'
  | 'code'
  | 'document'
  | 'video'
  | 'audio'
  | 'other';

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
const DOCX_PREVIEW_EXTS = new Set(['.docx']);
const PPTX_PREVIEW_EXTS = new Set(['.pptx']);
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
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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
    || DOCX_PREVIEW_EXTS.has(lower)
    || PPTX_PREVIEW_EXTS.has(lower)
  );
}

/** True for binary documents we render via dedicated viewers. */
export function supportsRichDocumentPreview(ext: string): boolean {
  const lower = ext.toLowerCase();
  return PDF_PREVIEW_EXTS.has(lower)
    || SHEET_PREVIEW_EXTS.has(lower)
    || DOCX_PREVIEW_EXTS.has(lower)
    || PPTX_PREVIEW_EXTS.has(lower);
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

export function isDocxPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return DOCX_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function isPptxPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return PPTX_PREVIEW_EXTS.has(ext.toLowerCase());
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
