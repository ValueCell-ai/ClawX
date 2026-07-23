import {
  FILE_PREVIEW_MAX_BINARY_BYTES,
  FILE_PREVIEW_MAX_OFFICE_BYTES,
  FILE_PREVIEW_MAX_TEXT_BYTES,
} from '@shared/file-preview/limits';
import type { AttachmentAccessTarget } from '@/lib/acp/timeline-types';
import {
  classifyFileExt,
  isDocxPreviewExt,
  isPdfPreviewExt,
  isPptxPreviewExt,
  isSheetPreviewExt,
  supportsInlineDocumentPreview,
} from '@/lib/generated-files';

export type FilePreviewKind = 'text' | 'rich';
export type RichFilePreviewKind = 'image' | 'pdf' | 'sheet' | 'docx' | 'pptx';
export type FilePreviewLimitTarget =
  | { kind: 'text' }
  | { kind: 'rich'; richKind: RichFilePreviewKind };
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
  '.doc', '.ppt',
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
  if (isPdfPreviewExt(ext)) return 'pdf';
  if (isSheetPreviewExt(ext)) return 'sheet';
  if (isDocxPreviewExt(ext)) return 'docx';
  if (isPptxPreviewExt(ext)) return 'pptx';
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

export function filePreviewMaxBytes(target: FilePreviewLimitTarget): number {
  if (target.kind === 'text') return FILE_PREVIEW_MAX_TEXT_BYTES;
  if (target.richKind === 'docx' || target.richKind === 'pptx') return FILE_PREVIEW_MAX_OFFICE_BYTES;
  return FILE_PREVIEW_MAX_BINARY_BYTES;
}

export function isFilePreviewWithinSizeLimit(target: FilePreviewLimitTarget, size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= filePreviewMaxBytes(target);
}

export function attachmentOpenMode(input: {
  ext: string;
  mimeType: string;
  size: number;
  target: AttachmentAccessTarget;
}): AttachmentOpenMode {
  if (input.target.kind === 'remote') return 'system';
  const richKind = richFilePreviewKind(input);
  const target: FilePreviewLimitTarget | null = richKind
    ? { kind: 'rich', richKind }
    : filePreviewKind(input) === 'text'
      ? { kind: 'text' }
      : null;
  return target && isFilePreviewWithinSizeLimit(target, input.size) ? 'preview' : 'system';
}
