/**
 * Shared icon picker for file cards (chat generated files + skill detail
 * dialog) and the workspace tree, so all panels render with consistent
 * iconography.
 */
import { File, FileArchive, FileCode, FileText, Film, ImageIcon, Music } from 'lucide-react';
import type { FileContentType } from '@/lib/generated-files';

export interface FilePreviewIconProps {
  contentType?: FileContentType;
  mimeType?: string;
  ext?: string;
  className?: string;
}

export function FilePreviewIcon({ contentType, mimeType, ext, className }: FilePreviewIconProps) {
  if (contentType === 'snapshot' || (mimeType && mimeType.startsWith('image/'))) {
    return <ImageIcon className={className} />;
  }
  if (contentType === 'video' || (mimeType && mimeType.startsWith('video/'))) {
    return <Film className={className} />;
  }
  if (contentType === 'audio' || (mimeType && mimeType.startsWith('audio/'))) {
    return <Music className={className} />;
  }
  if (contentType === 'document') {
    return <FileText className={className} />;
  }
  if (contentType === 'code') {
    return <FileCode className={className} />;
  }
  if (mimeType === 'application/json' || mimeType === 'application/xml' || (mimeType?.startsWith('text/'))) {
    return <FileText className={className} />;
  }
  if (ext && /\.(zip|tar|gz|7z|rar)$/i.test(ext)) {
    return <FileArchive className={className} />;
  }
  return <File className={className} />;
}
