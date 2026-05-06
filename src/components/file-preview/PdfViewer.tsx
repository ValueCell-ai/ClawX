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
  className?: string;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'tooLarge'; size?: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string };

function withViewerParams(url: string): string {
  // Chromium's built-in PDF viewer understands the common PDF fragment
  // parameters below. They keep the embedded preview focused on the page
  // content instead of showing the full dark toolbar + thumbnail sidebar.
  return `${url}#${PDF_VIEWER_PARAMS}`;
}

export default function PdfViewer({ filePath, fileName, className }: PdfViewerProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeRevealed, setIframeRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    setIframeLoaded(false);
    setIframeRevealed(false);

    void (async () => {
      try {
        const res = await readBinaryFile(filePath, { maxBytes: PDF_MAX_BYTES });
        if (cancelled) return;
        if (!res.ok || !res.data) {
          if (res.error === 'tooLarge') {
            setState({ status: 'tooLarge', size: res.size });
            return;
          }
          setState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        const cloned = new Uint8Array(res.data.byteLength);
        cloned.set(res.data);
        objectUrl = URL.createObjectURL(new Blob([cloned], { type: 'application/pdf' }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setState({ status: 'ready', url: objectUrl });
      } catch (err) {
        if (cancelled) return;
        setState({
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
    if (!iframeLoaded) return;
    const timer = window.setTimeout(() => {
      setIframeRevealed(true);
    }, PDF_NATIVE_VIEWER_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [iframeLoaded]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <LoadingSpinner />
      </div>
    );
  }
  if (state.status === 'tooLarge') {
    return (
      <div className={cn('flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground', className)}>
        {t('filePreview.errors.tooLarge', '文件过大，已禁用预览')}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-destructive', className)}>
        <p>
          {t('filePreview.pdf.loadFailed', { defaultValue: 'PDF 加载失败：{{error}}', error: state.message })}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full min-h-0 overflow-hidden bg-white', className)}>
      {!iframeRevealed && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
          <LoadingSpinner />
        </div>
      )}
      <iframe
        src={withViewerParams(state.url)}
        title={fileName ?? t('filePreview.pdf.title', 'PDF 预览')}
        className={cn(
          'h-full w-full border-0 bg-white transition-opacity duration-200',
          iframeRevealed ? 'opacity-100' : 'opacity-0',
        )}
        onLoad={() => setIframeLoaded(true)}
      />
    </div>
  );
}
