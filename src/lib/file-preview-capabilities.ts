import {
  FILE_PREVIEW_MAX_BINARY_BYTES,
  FILE_PREVIEW_MAX_TEXT_BYTES,
} from '@shared/file-preview/limits';
import type { AttachmentAccessTarget } from '@/lib/acp/timeline-types';
import {
  classifyFileExt,
  supportsInlineDocumentPreview,
  supportsRichDocumentPreview,
} from '@/lib/generated-files';

export type FilePreviewKind = 'text' | 'rich';
export type RichFilePreviewKind = 'image' | 'pdf' | 'sheet';
export type AttachmentOpenMode = 'preview' | 'system';

const TEXT_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/toml',
  'application/xml',
  'application/yaml',
]);

const SYSTEM_OPEN_ONLY_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.rar', '.7z',
  '.doc', '.docx', '.ppt', '.pptx',
  '.aac', '.aiff', '.opus', '.wma',
  '.3gp', '.flv', '.m4v', '.mpeg', '.mpg', '.ogv', '.wmv',
]);

function normalizedMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
}

function isSystemOpenOnlyExtension(ext: string): boolean {
  const contentType = classifyFileExt(ext);
  return SYSTEM_OPEN_ONLY_EXTENSIONS.has(ext)
    || contentType === 'audio'
    || contentType === 'video';
}

export function richFilePreviewKind(input: { ext: string; mimeType: string }): RichFilePreviewKind | null {
  const ext = input.ext.toLowerCase();
  const mimeType = normalizedMimeType(input.mimeType);
  const contentType = classifyFileExt(ext);

  if (isSystemOpenOnlyExtension(ext)) return null;
  if (contentType === 'snapshot') return 'image';
  if (ext === '.pdf') return 'pdf';
  if (supportsRichDocumentPreview(ext)) return 'sheet';
  if (contentType === 'code' || supportsInlineDocumentPreview(ext) || ext === '.csv') return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType === 'application/vnd.ms-excel') return 'sheet';
  return null;
}

export function filePreviewKind(input: { ext: string; mimeType: string }): FilePreviewKind | null {
  const ext = input.ext.toLowerCase();
  const mimeType = normalizedMimeType(input.mimeType);
  const contentType = classifyFileExt(ext);

  if (isSystemOpenOnlyExtension(ext)) return null;
  if (richFilePreviewKind(input)) return 'rich';
  if (
    contentType === 'code'
    || supportsInlineDocumentPreview(ext)
    || ext === '.csv'
    || mimeType.startsWith('text/')
    || TEXT_APPLICATION_MIME_TYPES.has(mimeType)
  ) return 'text';
  return null;
}

export function isFilePreviewWithinSizeLimit(kind: FilePreviewKind, size: number): boolean {
  const limit = kind === 'rich' ? FILE_PREVIEW_MAX_BINARY_BYTES : FILE_PREVIEW_MAX_TEXT_BYTES;
  return Number.isFinite(size) && size >= 0 && size <= limit;
}

export function attachmentOpenMode(input: {
  ext: string;
  mimeType: string;
  size: number;
  target: AttachmentAccessTarget;
}): AttachmentOpenMode {
  if (input.target.kind === 'remote') return 'system';
  const kind = filePreviewKind(input);
  return kind && isFilePreviewWithinSizeLimit(kind, input.size) ? 'preview' : 'system';
}
