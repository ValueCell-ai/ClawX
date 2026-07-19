import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AppWindow, ChevronDown, FolderOpen, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { buildAttachmentPreviewTarget } from '@/components/file-preview/build-preview-target';
import { formatFileSize } from '@/components/file-preview/format';
import type { AttachmentRenderPart } from '@/lib/acp/timeline-types';
import { attachmentOpenMode } from '@/lib/file-preview-capabilities';
import { basenameOf, extnameOf } from '@/lib/generated-files';
import { hostApi, type AttachmentFileRef, type AttachmentOpenHandler } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useArtifactPanel } from '@/stores/artifact-panel';

type AttachmentTone = 'assistant' | 'user';
const MAX_ICON_DATA_URL_LENGTH = 65_536;

function validIconDataUrl(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length <= MAX_ICON_DATA_URL_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
  );
}

function attachmentFileRefKey(ref: AttachmentFileRef): string {
  return JSON.stringify([
    ref.sessionKey,
    ref.generation,
    ref.uri,
    ref.stagingId,
    ref.transcriptMessageId,
  ]);
}

function ApplicationIcon({ iconDataUrl }: { iconDataUrl?: string }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);

  if (!validIconDataUrl(iconDataUrl) || failedIcon === iconDataUrl) {
    return (
      <AppWindow
        data-testid="acp-attachment-open-with-generic-icon"
        className="h-8 w-8 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      data-testid="acp-attachment-open-with-native-icon"
      src={iconDataUrl}
      alt=""
      className="h-8 w-8 shrink-0 object-contain"
      onError={() => setFailedIcon(iconDataUrl)}
    />
  );
}

function AcpAttachmentOpenWith({ fileRef, name }: { fileRef: AttachmentFileRef; name: string }) {
  const { t, i18n } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const refKey = attachmentFileRefKey(fileRef);
  const [discovery, setDiscovery] = useState<{
    refKey: string;
    loading: boolean;
    handlers: AttachmentOpenHandler[];
  }>(() => ({ refKey, loading: false, handlers: [] }));
  const requestToken = useRef(0);
  const platform = window.electron.platform;
  const { generation, sessionKey, stagingId, transcriptMessageId, uri } = fileRef;
  const activeDiscovery = discovery.refKey === refKey
    ? discovery
    : { refKey, loading: open && platform !== 'linux', handlers: [] };
  const { handlers, loading } = activeDiscovery;

  useEffect(() => {
    if (!open) return;

    const token = ++requestToken.current;
    void Promise.resolve()
      .then(async () => {
        if (requestToken.current !== token) return;
        setDiscovery({ refKey, loading: platform !== 'linux', handlers: [] });
        if (platform === 'linux') {
          return;
        }

        const requestRef: AttachmentFileRef = {
          sessionKey,
          generation,
          uri,
          ...(stagingId === undefined ? {} : { stagingId }),
          ...(transcriptMessageId === undefined ? {} : { transcriptMessageId }),
        };
        try {
          const result = await hostApi.files.listAttachmentOpenHandlers(requestRef);
          if (requestToken.current !== token) return;
          const nextHandlers = result.ok ? result.handlers : [];
          const collator = new Intl.Collator(i18n.language);
          setDiscovery({
            refKey,
            loading: false,
            handlers: [...nextHandlers].sort((left, right) => {
              if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
              return collator.compare(left.name, right.name);
            }),
          });
        } catch {
          if (requestToken.current === token) setDiscovery({ refKey, loading: false, handlers: [] });
        }
      });

    return () => {
      if (requestToken.current === token) requestToken.current += 1;
    };
  }, [
    generation,
    i18n.language,
    open,
    platform,
    refKey,
    sessionKey,
    stagingId,
    transcriptMessageId,
    uri,
  ]);

  useEffect(() => () => {
    requestToken.current += 1;
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDiscovery({ refKey, loading: platform !== 'linux', handlers: [] });
    } else {
      requestToken.current += 1;
      setDiscovery((current) => (
        current.refKey === refKey ? { ...current, loading: false } : current
      ));
    }
    setOpen(nextOpen);
  };

  const openWith = async (handlerId: string, handlerRefKey: string) => {
    if (handlerRefKey !== refKey) return;
    try {
      const result = await hostApi.files.openAttachmentWith({ ref: fileRef, handlerId });
      if (!result.ok) toast.error(t('acp.attachment.openWithFailed'));
    } catch {
      toast.error(t('acp.attachment.openWithFailed'));
    }
  };

  const reveal = async () => {
    try {
      const result = await hostApi.files.revealAttachment(fileRef);
      if (!result.ok) toast.error(t('acp.attachment.revealFailed'));
    } catch {
      toast.error(t('acp.attachment.revealFailed'));
    }
  };

  const revealLabel = platform === 'darwin'
    ? t('acp.attachment.showInFinder')
    : platform === 'win32'
      ? t('acp.attachment.showInExplorer')
      : t('acp.attachment.showInFileManager');
  const hasApplicationSection = loading || handlers.length > 0;
  const itemClassName = cn(
    'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
    'data-[highlighted]:bg-black/5 data-[highlighted]:text-foreground dark:data-[highlighted]:bg-white/10',
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-testid="acp-attachment-open-with-trigger"
          aria-label={t('acp.attachment.openWithFile', { name })}
          className={cn(
            'flex shrink-0 items-center gap-1 self-stretch rounded-r-xl border-l border-black/10 px-2 text-xs text-muted-foreground dark:border-white/10',
            'transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
            'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <span>{t('acp.attachment.openWith')}</span>
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-testid="acp-attachment-open-with-menu"
          align="end"
          sideOffset={4}
          className="z-50 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-black/10 bg-surface-modal p-1 text-foreground shadow-lg dark:border-white/10"
        >
          {loading && (
            <DropdownMenu.Item
              disabled
              data-testid="acp-attachment-open-with-loading"
              className={cn(itemClassName, 'text-muted-foreground')}
            >
              <AppWindow className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('acp.attachment.searchingApplications')}</span>
            </DropdownMenu.Item>
          )}
          {!loading && handlers.map((handler) => (
            <DropdownMenu.Item
              key={handler.handlerId}
              data-testid="acp-attachment-open-with-app"
              className={itemClassName}
              onSelect={() => void openWith(handler.handlerId, activeDiscovery.refKey)}
            >
              <ApplicationIcon key={handler.iconDataUrl ?? 'generic'} iconDataUrl={handler.iconDataUrl} />
              <span className="truncate">{handler.name}</span>
            </DropdownMenu.Item>
          ))}
          {hasApplicationSection && (
            <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
          )}
          <DropdownMenu.Item
            data-testid="acp-attachment-reveal"
            className={itemClassName}
            onSelect={() => void reveal()}
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{revealLabel}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

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

  if (openWithFileRef) {
    return (
      <div className="flex w-full max-w-full rounded-xl border border-black/10 bg-surface-modal text-left text-sm dark:border-white/10">
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => void activate()}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-l-xl px-3 py-2 text-left',
            'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
            'focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          {attachmentContent}
        </button>
        <AcpAttachmentOpenWith fileRef={openWithFileRef} name={name} />
      </div>
    );
  }

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
      {attachmentContent}
    </button>
  );
}
