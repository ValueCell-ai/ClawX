import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { buildAttachmentPreviewTarget } from '@/components/file-preview/build-preview-target';
import { formatFileSize } from '@/components/file-preview/format';
import type { AttachmentRenderPart } from '@/lib/acp/timeline-types';
import { attachmentOpenMode } from '@/lib/file-preview-capabilities';
import { basenameOf, extnameOf } from '@/lib/generated-files';
import { hostApi } from '@/lib/host-api';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { AcpFileCard } from './AcpFileCard';

type AttachmentTone = 'assistant' | 'user';

function filePathFromUri(uri: string): string {
  if (/^file:\/\/\//i.test(uri)) {
    try {
      return decodeURIComponent(uri.slice(7));
    } catch {
      return uri.slice(7);
    }
  }
  if (/^file:\/\/localhost\//i.test(uri)) {
    try {
      return decodeURIComponent(uri.slice(16));
    } catch {
      return uri.slice(16);
    }
  }
  return uri;
}

function AcpUserImageAttachment({
  part,
  name,
  ariaLabel,
  activate,
}: {
  part: AttachmentRenderPart & { access: Extract<AttachmentRenderPart['access'], { status: 'available' }> };
  name: string;
  ariaLabel: string;
  activate: () => Promise<void>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    if (part.access.target.kind !== 'local') return;
    let cancelled = false;

    void hostApi.media
      .thumbnails({
        paths: [
          {
            attachmentFileRef: part.access.target.ref,
            key: part.access.identity,
            mimeType: part.access.mimeType,
          },
        ],
      })
      .then((result) => {
        if (cancelled) return;
        setThumbnailUrl(result[part.access.identity]?.preview ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [part.access]);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={() => void activate()}
      className="group/user-image relative h-18 w-auto max-w-full overflow-hidden rounded-xl border border-black/10 bg-surface-modal text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-white/10"
    >
      {thumbnailUrl && (
        <img
          data-testid="acp-user-image-attachment"
          src={thumbnailUrl}
          alt={name}
          className="h-full w-full object-cover"
        />
      )}
      <span
        data-testid="acp-user-image-overlay"
        className="absolute inset-0 flex items-end bg-black/0 p-2.5 transition-colors group-hover/user-image:bg-black/50 group-focus-visible/user-image:bg-black/50"
      >
        <span
          data-testid="acp-user-image-filename"
          className="w-full truncate text-xs font-medium text-white opacity-0 drop-shadow transition-opacity group-hover/user-image:opacity-100 group-focus-visible/user-image:opacity-100"
        >
          {name}
        </span>
      </span>
    </button>
  );
}

export function AcpAttachmentPart({ part, tone = 'assistant' }: { part: AttachmentRenderPart; tone?: AttachmentTone }) {
  const { t } = useTranslation('chat');
  const name = basenameOf(part.reference.name) || part.reference.name;
  const pending = part.access.status === 'pending';
  const unavailable = part.access.status === 'unavailable';
  const disabled = pending || unavailable;
  const size = part.access.status === 'available' ? part.access.size : part.reference.size;
  const displayPath = part.reference.displayPath ?? filePathFromUri(part.reference.uri);
  const mode =
    part.access.status === 'available'
      ? attachmentOpenMode({
          ext: extnameOf(name),
          mimeType: part.access.mimeType,
          size: part.access.size,
          target: part.access.target,
        })
      : null;
  const actionLabel = pending
    ? t('acp.attachment.loading')
    : unavailable
      ? t('acp.attachment.unavailable')
      : t(mode === 'preview' ? 'acp.attachment.preview' : 'acp.attachment.open', { name });
  const ariaLabel = disabled ? `${actionLabel}: ${name}` : actionLabel;
  const userDisplayPath = tone === 'user' ? part.reference.displayPath : undefined;
  const openWithFileRef =
    tone === 'assistant' &&
    part.access.status === 'available' &&
    part.access.target.kind === 'local' &&
    mode === 'preview'
      ? part.access.target.ref
      : null;

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

  if (
    tone === 'user' &&
    part.access.status === 'available' &&
    part.access.target.kind === 'local' &&
    part.access.mimeType.startsWith('image/')
  ) {
    return (
      <AcpUserImageAttachment
        part={
          part as AttachmentRenderPart & { access: Extract<AttachmentRenderPart['access'], { status: 'available' }> }
        }
        name={name}
        ariaLabel={ariaLabel}
        activate={activate}
      />
    );
  }

  const attachmentContent = (
    <>
      <Paperclip data-testid="acp-attachment-icon" className="h-4 w-4 shrink-0" aria-hidden="true" />
      {userDisplayPath && !disabled ? (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="max-w-[50%] shrink-0 truncate font-medium text-foreground">{name}</span>
          <span
            data-testid="acp-user-attachment-path"
            className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
            title={userDisplayPath}
          >
            {userDisplayPath}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{name}</span>
          {disabled ? (
            <span className="block truncate text-2xs text-muted-foreground">{actionLabel}</span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-1 text-2xs text-muted-foreground">
              <span data-testid="acp-attachment-path" className="min-w-0 w-auto truncate" title={displayPath}>
                {displayPath}
              </span>
              {size ? <span className="shrink-0">·</span> : null}
              {size ? <span className="shrink-0 whitespace-nowrap">{formatFileSize(size)}</span> : null}
            </span>
          )}
        </span>
      )}
    </>
  );

  return (
    <AcpFileCard
      variant="standalone"
      primaryAriaLabel={ariaLabel}
      primaryDisabled={disabled}
      onPrimary={() => void activate()}
      openWith={openWithFileRef
        ? { target: { kind: 'attachment', ref: openWithFileRef }, name }
        : undefined}
    >
      {attachmentContent}
    </AcpFileCard>
  );
}
