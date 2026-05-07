/**
 * Read-only image viewer with fit-to-window + click-to-zoom toggle.
 *
 * Renders the image directly off the disk via `file://` so we don't need
 * to base64-encode it through IPC. clawx's renderer already loads via
 * file:// in production so the protocol is allowlisted.
 */
import { useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ImageViewerProps {
  filePath: string;
  fileName: string;
  className?: string;
}

function toFileUrl(path: string): string {
  const norm = path.replace(/\\/g, '/');
  if (norm.startsWith('file://')) return norm;
  if (norm.startsWith('/')) return `file://${norm}`;
  return `file:///${norm}`;
}

export default function ImageViewer({ filePath, fileName, className }: ImageViewerProps) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className={cn('relative flex h-full w-full items-center justify-center bg-black/5 dark:bg-black/40', className)}>
      <div className="absolute right-3 top-3 z-10">
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 rounded-full shadow-md"
          onClick={() => setZoomed((v) => !v)}
          title={zoomed ? 'Zoom out' : 'Actual size'}
        >
          {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
        </Button>
      </div>
      <div className="h-full w-full overflow-auto p-6">
        <img
          src={toFileUrl(filePath)}
          alt={fileName}
          className={cn(
            'mx-auto select-none transition-transform',
            zoomed
              ? 'max-w-none cursor-zoom-out'
              : 'max-h-full max-w-full object-contain cursor-zoom-in',
          )}
          onClick={() => setZoomed((v) => !v)}
          draggable={false}
        />
      </div>
    </div>
  );
}
