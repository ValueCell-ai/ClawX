import { useCallback, useState } from 'react';
import { Check, Copy, Download, ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderPart } from '@/lib/acp/timeline-types';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { copyImageToClipboard } from './copy-image';

type ImageRenderPart = Extract<RenderPart, { kind: 'image' }>;

function safeImageSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (/^file:/i.test(trimmed)) return trimmed;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;
  return null;
}

function imageExtension(mimeType?: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/svg+xml') return 'svg';
  const subtype = mimeType?.match(/^image\/([a-z0-9.+-]+)$/i)?.[1];
  return subtype ? subtype.split('+')[0] : 'png';
}

function filePathFromFileUrl(source: string): string | null {
  try {
    const url = new URL(source);
    if (url.protocol !== 'file:') return null;
    const path = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

function dataUrlParts(source: string): { base64: string; mimeType: string } | null {
  const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  return match?.[1] && match[2] ? { mimeType: match[1], base64: match[2] } : null;
}

export function isSafeAcpImageSource(source: string): boolean {
  return safeImageSource(source) != null;
}

export function AcpImagePart({ part, className }: { part: ImageRenderPart; className?: string }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const src = safeImageSource(part.source);
  const mimeType = part.mimeType?.startsWith('image/') ? part.mimeType : (src ? dataUrlParts(src)?.mimeType : undefined) ?? 'image/png';
  const defaultFileName = `generated-image.${imageExtension(mimeType)}`;
  const handleCopy = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!src) return;
    const filePath = filePathFromFileUrl(src) ?? undefined;
    const ok = await copyImageToClipboard({
      preview: src,
      filePath,
      mimeType,
    });
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [src, mimeType]);
  const handleSave = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!src) return;
    const data = dataUrlParts(src);
    const filePath = filePathFromFileUrl(src);
    const payload = data
      ? { base64: data.base64, mimeType: data.mimeType, defaultFileName }
      : filePath
        ? { filePath, mimeType, defaultFileName }
        : null;
    if (!payload) return;
    const result = await hostApi.media.saveImage(payload);
    if (!result?.success) return;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }, [src, mimeType, defaultFileName]);

  if (!src) {
    return (
      <div
        data-testid="acp-image-part"
        className={cn(
          'flex items-center gap-2 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400',
          className,
        )}
      >
        <ImageIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('acp.unsupportedContent')}</span>
      </div>
    );
  }

  return (
    <figure
      data-testid="acp-image-part"
      className={cn(
        'group/acp-image relative inline-flex max-w-full overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10',
        className,
      )}
    >
      <img
        src={src}
        alt={part.alt || t('acp.image')}
        className="block max-h-[420px] max-w-full object-contain"
      />
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/acp-image:opacity-100 group-focus-within/acp-image:opacity-100">
        <button
          type="button"
          data-testid="acp-image-copy"
          aria-label={copied ? t('acp.imageCopied') : t('acp.copyImage')}
          title={copied ? t('acp.imageCopied') : t('acp.copyImage')}
          onClick={(event) => void handleCopy(event)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white shadow-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 dark:bg-white/20 dark:hover:bg-white/30"
        >
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          data-testid="acp-image-save"
          aria-label={saved ? t('acp.imageSaved') : t('acp.saveImage')}
          title={saved ? t('acp.imageSaved') : t('acp.saveImage')}
          onClick={(event) => void handleSave(event)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white shadow-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 dark:bg-white/20 dark:hover:bg-white/30"
        >
          {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </figure>
  );
}
