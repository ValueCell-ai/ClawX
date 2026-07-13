import { Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { buildAttachmentPreviewTarget } from '@/components/file-preview/build-preview-target';
import { formatFileSize } from '@/components/file-preview/format';
import type { AttachmentRenderPart } from '@/lib/acp/timeline-types';
import { attachmentOpenMode } from '@/lib/file-preview-capabilities';
import { basenameOf, extnameOf } from '@/lib/generated-files';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useArtifactPanel } from '@/stores/artifact-panel';

export function AcpAttachmentPart({ part }: { part: AttachmentRenderPart }) {
  const { t } = useTranslation('chat');
  const name = basenameOf(part.reference.name) || part.reference.name;
  const pending = part.access.status === 'pending';
  const unavailable = part.access.status === 'unavailable';
  const disabled = pending || unavailable;
  const size = part.access.status === 'available' ? part.access.size : part.reference.size;
  const secondary = size
    ? t('acp.attachment.mimeSize', { size: formatFileSize(size) })
    : '';
  const mode = part.access.status === 'available'
    ? attachmentOpenMode({ ext: extnameOf(name), mimeType: part.access.mimeType, size: part.access.size, target: part.access.target })
    : null;
  const actionLabel = pending
    ? t('acp.attachment.loading')
    : unavailable
      ? t('acp.attachment.unavailable')
      : t(mode === 'preview' ? 'acp.attachment.preview' : 'acp.attachment.open', { name });
  const ariaLabel = disabled ? `${actionLabel}: ${name}` : actionLabel;

  const activate = async () => {
    if (part.access.status !== 'available') return;
    if (mode === 'preview') {
      useArtifactPanel.getState().openPreview(buildAttachmentPreviewTarget(part));
      return;
    }
    try {
      const result = await hostApi.files.openAttachment(part.access.target.ref);
      if (!result.ok) toast.error(t('acp.attachment.openFailed'));
    } catch {
      toast.error(t('acp.attachment.openFailed'));
    }
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => void activate()}
      className={cn(
        'flex w-full max-w-full items-center gap-3 rounded-xl border border-black/10 bg-surface-modal px-3 py-2 text-left text-sm dark:border-white/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        disabled
          ? 'cursor-not-allowed text-muted-foreground opacity-70'
          : 'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      <Paperclip data-testid="acp-attachment-icon" className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{name}</span>
        <span className="block truncate text-2xs text-muted-foreground">
          {disabled ? actionLabel : secondary}
        </span>
      </span>
    </button>
  );
}
