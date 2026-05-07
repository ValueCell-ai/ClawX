/**
 * Inline PDF viewer.
 *
 * PDF bytes are loaded through the sandboxed `file:readBinary` IPC channel
 * and then exposed to Chromium's built-in PDF renderer via a Blob URL.
 * This is intentionally more conservative than hand-rendering pages with
 * pdf.js: generated PDFs commonly reference CMaps / CID fonts (for Chinese
 * text, for example), and a missing pdf.js font asset can otherwise produce
 * a "loaded but blank" canvas.  Chromium/PDFium already has the platform
 * rendering path we need here.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { readBinaryFile } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const PDF_MAX_BYTES = 50 * 1024 * 1024;
const PDF_VIEWER_PARAMS = 'toolbar=0&navpanes=0&scrollbar=1&view=FitH&zoom=page-width';
const PDF_NATIVE_VIEWER_REVEAL_DELAY_MS = 900;

export interface PdfViewerProps {
  filePath: string;
  /** Optional file name shown in screen-reader labels and titles. */
  fileName?: string;
  surface?: 'default' | 'workspace';
  className?: string;
}

type LoadState =
  | { filePath: string; status: 'loading' }
  | { filePath: string; status: 'tooLarge'; size?: number }
  | { filePath: string; status: 'error'; message: string }
  | { filePath: string; status: 'ready'; url: string };

type IframeState = {
  url: string | null;
  loaded: boolean;
  revealed: boolean;
};

function withViewerParams(url: string): string {
  // Chromium's built-in PDF viewer understands the common PDF fragment
  // parameters below. They keep the embedded preview focused on the page
  // content instead of showing the full dark toolbar + thumbnail sidebar.
  return `${url}#${PDF_VIEWER_PARAMS}`;
}

export default function PdfViewer({
  filePath,
  fileName,
  surface = 'default',
  className,
}: PdfViewerProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ filePath, status: 'loading' });
  const [iframeState, setIframeState] = useState<IframeState>({
    url: null,
    loaded: false,
    revealed: false,
  });
  const currentState: LoadState = state.filePath === filePath
    ? state
    : { filePath, status: 'loading' };
  const currentUrl = currentState.status === 'ready' ? currentState.url : null;
  const iframeRevealed = !!currentUrl && iframeState.url === currentUrl && iframeState.revealed;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const res = await readBinaryFile(filePath, { maxBytes: PDF_MAX_BYTES });
        if (cancelled) return;
        if (!res.ok || !res.data) {
          if (res.error === 'tooLarge') {
            setState({ filePath, status: 'tooLarge', size: res.size });
            return;
          }
          setState({ filePath, status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        const cloned = new Uint8Array(res.data.byteLength);
        cloned.set(res.data);
        objectUrl = URL.createObjectURL(new Blob([cloned], { type: 'application/pdf' }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setState({ filePath, status: 'ready', url: objectUrl });
      } catch (err) {
        if (cancelled) return;
        setState({
          filePath,
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
  }, [filePath]);

  useEffect(() => {
    if (!iframeState.loaded || !iframeState.url) return;
    const timer = window.setTimeout(() => {
      setIframeState((current) => (
        current.url === iframeState.url
          ? { ...current, revealed: true }
          : current
      ));
    }, PDF_NATIVE_VIEWER_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [iframeState.loaded, iframeState.url]);

  if (currentState.status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <LoadingSpinner />
      </div>
    );
  }
  if (currentState.status === 'tooLarge') {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground', className)}>
        {t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
      </div>
    );
  }
  if (currentState.status === 'error') {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive', className)}>
        <p>
          {t('filePreview.pdf.loadFailed', { defaultValue: 'PDF failed to load: {{error}}', error: currentState.message })}
        </p>
      </div>
    );
  }

  const workspaceSurface = surface === 'workspace';

  return (
    <div
      className={cn(
        'relative h-full min-h-0 overflow-hidden',
        workspaceSurface
          ? 'overflow-auto bg-[hsl(var(--muted)/0.35)] p-4 dark:bg-background'
          : 'bg-white',
        className,
      )}
    >
      {!iframeRevealed && (
        <div
          className={cn(
            'absolute inset-0 z-10 flex items-center justify-center',
            workspaceSurface ? 'bg-[hsl(var(--muted)/0.35)] dark:bg-background' : 'bg-white',
          )}
        >
          <LoadingSpinner />
        </div>
      )}
      <div
        className={cn(
          'mx-auto min-h-0',
          workspaceSurface ? 'w-full max-w-[820px]' : 'h-full w-full',
        )}
        style={workspaceSurface ? { aspectRatio: '1 / 1.414' } : undefined}
      >
        <iframe
          src={withViewerParams(currentState.url)}
          title={fileName ?? t('filePreview.pdf.title', 'PDF preview')}
          className={cn(
            'h-full w-full border-0 bg-white transition-opacity duration-200',
            workspaceSurface && 'rounded-lg shadow-sm ring-1 ring-black/10 dark:ring-white/10',
            iframeRevealed ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => {
            setIframeState({
              url: currentState.url,
              loaded: true,
              revealed: false,
            });
          }}
        />
      </div>
    </div>
  );
}
