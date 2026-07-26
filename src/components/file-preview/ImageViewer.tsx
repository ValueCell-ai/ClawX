/**
 * Read-only image viewer with fit-to-window + click-to-zoom toggle.
 *
 * Image bytes are loaded through the sandboxed `file:readBinary` IPC channel
 * and exposed via a Blob URL. Direct `file://` src values fail in dev (Vite
 * serves the renderer over http://) and are unreliable across platforms.
 */
import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import {
  readBinaryFile,
  readWorkspaceBinary,
  type WorkspaceFileRef,
} from '@/lib/file-preview-client';
import { cn } from '@/lib/utils';
import { getFilePreviewTargetIdentity } from './types';

const IMAGE_MAX_BYTES = 50 * 1024 * 1024;

export interface ImageViewerProps {
  filePath: string;
  fileName: string;
  workspaceFileRef?: WorkspaceFileRef;
  className?: string;
}

type LoadState =
  | { identity: string; status: 'loading' }
  | { identity: string; status: 'tooLarge'; size?: number }
  | { identity: string; status: 'error'; message: string }
  | { identity: string; status: 'ready'; url: string };

export default function ImageViewer({ filePath, fileName, workspaceFileRef, className }: ImageViewerProps) {
  const { t } = useTranslation('chat');
  const [zoomed, setZoomed] = useState(false);
  const loadIdentity = getFilePreviewTargetIdentity({ filePath, workspaceFileRef });
  const [state, setState] = useState<LoadState>({ identity: loadIdentity, status: 'loading' });
  const currentState: LoadState = state.identity === loadIdentity
    ? state
    : { identity: loadIdentity, status: 'loading' };

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const res = workspaceFileRef
          ? await readWorkspaceBinary({ ...workspaceFileRef, maxBytes: IMAGE_MAX_BYTES })
          : await readBinaryFile(filePath, { maxBytes: IMAGE_MAX_BYTES });
        if (cancelled) return;
        if (!res.ok || !res.data) {
          if (res.error === 'tooLarge') {
            setState({ identity: loadIdentity, status: 'tooLarge', size: res.size });
            return;
          }
          setState({ identity: loadIdentity, status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        const cloned = new Uint8Array(res.data.byteLength);
        cloned.set(res.data);
        objectUrl = URL.createObjectURL(new Blob([cloned], { type: res.mimeType || 'image/png' }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setState({ identity: loadIdentity, status: 'ready', url: objectUrl });
      } catch (err) {
        if (cancelled) return;
        setState({
          identity: loadIdentity,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath, loadIdentity, workspaceFileRef]);

  if (currentState.status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center bg-black/5 dark:bg-black/40', className)}>
        <LoadingSpinner />
      </div>
    );
  }

  if (currentState.status === 'tooLarge') {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground bg-black/5 dark:bg-black/40', className)}>
        {t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
      </div>
    );
  }

  if (currentState.status === 'error') {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive bg-black/5 dark:bg-black/40', className)}>
        <p>
          {t('filePreview.image.loadFailed', {
            defaultValue: 'Image failed to load: {{error}}',
            error: currentState.message,
          })}
        </p>
      </div>
    );
  }

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
          src={currentState.url}
          alt={fileName}
          data-testid="image-preview"
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
