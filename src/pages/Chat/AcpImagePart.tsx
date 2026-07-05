import { ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RenderPart } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';

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

export function isSafeAcpImageSource(source: string): boolean {
  return safeImageSource(source) != null;
}

export function AcpImagePart({ part, className }: { part: ImageRenderPart; className?: string }) {
  const { t } = useTranslation('chat');
  const src = safeImageSource(part.source);

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
        'inline-flex max-w-full overflow-hidden rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10',
        className,
      )}
    >
      <img
        src={src}
        alt={part.alt || t('acp.image')}
        className="block max-h-[420px] max-w-full object-contain"
      />
    </figure>
  );
}
