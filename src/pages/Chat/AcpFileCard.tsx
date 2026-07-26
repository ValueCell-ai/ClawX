import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AppWindow, ChevronDown, FolderOpen, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  hostApi,
  type AttachmentFileRef,
  type AttachmentOpenHandler,
  type WorkspaceFileRef,
} from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { extnameOf, isHtmlPreviewExt } from '@/lib/generated-files';
import { useArtifactPanel } from '@/stores/artifact-panel';

export type AcpFileTarget =
  | { kind: 'attachment'; ref: AttachmentFileRef }
  | { kind: 'workspace'; ref: WorkspaceFileRef };

const MAX_ICON_DATA_URL_LENGTH = 65_536;

function validIconDataUrl(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length <= MAX_ICON_DATA_URL_LENGTH &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
  );
}

function fileTargetKey(target: AcpFileTarget): string {
  if (target.kind === 'workspace') {
    return JSON.stringify([target.kind, target.ref.workspaceRoot, target.ref.relativePath]);
  }
  return JSON.stringify([
    target.kind,
    target.ref.sessionKey,
    target.ref.generation,
    target.ref.uri,
    target.ref.stagingId,
    target.ref.transcriptMessageId,
  ]);
}

function absolutePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encodedPath = absolutePath
    .split('/')
    .map((segment, index) => {
      if (index === 0) return '';
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join('/');
  return `file://${encodedPath}`;
}

function builtInBrowserUrl(target: AcpFileTarget, name: string): string | null {
  if (!isHtmlPreviewExt(extnameOf(name))) return null;
  if (target.kind === 'workspace') {
    const root = target.ref.workspaceRoot.replace(/[\\/]+$/, '');
    const relativePath = target.ref.relativePath.replace(/^[\\/]+/, '');
    return absolutePathToFileUrl(`${root}/${relativePath}`);
  }
  try {
    const url = new URL(target.ref.uri);
    if (url.protocol !== 'file:') return null;
    if (!url.hostname) return url.href;
    if (url.hostname.toLowerCase() !== 'localhost') return null;
    return absolutePathToFileUrl(decodeURIComponent(url.pathname));
  } catch {
    return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(target.ref.uri)
      ? absolutePathToFileUrl(target.ref.uri)
      : null;
  }
}

function ApplicationIcon({ iconDataUrl }: { iconDataUrl?: string }) {
  const [failedIcon, setFailedIcon] = useState<string | null>(null);

  if (!validIconDataUrl(iconDataUrl) || failedIcon === iconDataUrl) {
    return (
      <AppWindow
        data-testid="acp-attachment-open-with-generic-icon"
        className="h-5 w-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      data-testid="acp-attachment-open-with-native-icon"
      src={iconDataUrl}
      alt=""
      className="h-5 w-5 shrink-0 object-contain"
      onError={() => setFailedIcon(iconDataUrl)}
    />
  );
}

export function AcpFileOpenWith({ target, name }: { target: AcpFileTarget; name: string }) {
  const { t, i18n } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const targetKey = fileTargetKey(target);
  const [discovery, setDiscovery] = useState<{
    targetKey: string;
    loading: boolean;
    handlers: AttachmentOpenHandler[];
  }>(() => ({ targetKey, loading: false, handlers: [] }));
  const requestToken = useRef(0);
  const currentTargetKey = useRef(targetKey);
  const platform = window.electron.platform;
  const browserUrl = builtInBrowserUrl(target, name);
  const targetKind = target.kind;
  const attachmentSessionKey = target.kind === 'attachment' ? target.ref.sessionKey : undefined;
  const attachmentGeneration = target.kind === 'attachment' ? target.ref.generation : undefined;
  const attachmentUri = target.kind === 'attachment' ? target.ref.uri : undefined;
  const attachmentStagingId = target.kind === 'attachment' ? target.ref.stagingId : undefined;
  const attachmentTranscriptMessageId = target.kind === 'attachment'
    ? target.ref.transcriptMessageId
    : undefined;
  const workspaceRoot = target.kind === 'workspace' ? target.ref.workspaceRoot : undefined;
  const relativePath = target.kind === 'workspace' ? target.ref.relativePath : undefined;
  const activeDiscovery = discovery.targetKey === targetKey
    ? discovery
    : { targetKey, loading: open && platform !== 'linux', handlers: [] };
  const { handlers, loading } = activeDiscovery;

  useLayoutEffect(() => {
    currentTargetKey.current = targetKey;
  }, [targetKey]);

  useEffect(() => {
    if (!open) return;

    const token = ++requestToken.current;
    void Promise.resolve().then(async () => {
      if (requestToken.current !== token) return;
      setDiscovery({ targetKey, loading: platform !== 'linux', handlers: [] });
      if (platform === 'linux') return;

      const requestTarget: AcpFileTarget = targetKind === 'attachment'
        ? {
            kind: 'attachment',
            ref: {
              sessionKey: attachmentSessionKey!,
              generation: attachmentGeneration!,
              uri: attachmentUri!,
              ...(attachmentStagingId === undefined ? {} : { stagingId: attachmentStagingId }),
              ...(attachmentTranscriptMessageId === undefined
                ? {}
                : { transcriptMessageId: attachmentTranscriptMessageId }),
            },
          }
        : {
            kind: 'workspace',
            ref: { workspaceRoot: workspaceRoot!, relativePath: relativePath! },
          };
      try {
        const result = requestTarget.kind === 'attachment'
          ? await hostApi.files.listAttachmentOpenHandlers(requestTarget.ref)
          : await hostApi.files.listWorkspaceOpenHandlers(requestTarget.ref);
        if (requestToken.current !== token) return;
        const nextHandlers = result.ok ? result.handlers : [];
        const collator = new Intl.Collator(i18n.language);
        setDiscovery({
          targetKey,
          loading: false,
          handlers: [...nextHandlers].sort((left, right) => {
            if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
            return collator.compare(left.name, right.name);
          }),
        });
      } catch {
        if (requestToken.current === token) setDiscovery({ targetKey, loading: false, handlers: [] });
      }
    });

    return () => {
      if (requestToken.current === token) requestToken.current += 1;
    };
  }, [
    attachmentGeneration,
    attachmentSessionKey,
    attachmentStagingId,
    attachmentTranscriptMessageId,
    attachmentUri,
    i18n.language,
    open,
    platform,
    relativePath,
    targetKey,
    targetKind,
    workspaceRoot,
  ]);

  useEffect(() => () => {
    requestToken.current += 1;
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDiscovery({ targetKey, loading: platform !== 'linux', handlers: [] });
    } else {
      requestToken.current += 1;
      setDiscovery((current) => (
        current.targetKey === targetKey ? { ...current, loading: false } : current
      ));
    }
    setOpen(nextOpen);
  };

  const openWith = async (handlerId: string, handlerTargetKey: string) => {
    if (handlerTargetKey !== currentTargetKey.current) return;
    try {
      const result = target.kind === 'attachment'
        ? await hostApi.files.openAttachmentWith({ ref: target.ref, handlerId })
        : await hostApi.files.openWorkspaceWith({ ref: target.ref, handlerId });
      if (!result.ok) toast.error(t('fileCard.openWithFailed'));
    } catch {
      toast.error(t('fileCard.openWithFailed'));
    }
  };

  const reveal = async () => {
    try {
      const result = target.kind === 'attachment'
        ? await hostApi.files.revealAttachment(target.ref)
        : await hostApi.files.revealWorkspaceFile(target.ref);
      if (!result.ok) toast.error(t('fileCard.revealFailed'));
    } catch {
      toast.error(t('fileCard.revealFailed'));
    }
  };

  const revealLabel = platform === 'darwin'
    ? t('fileCard.showInFinder')
    : platform === 'win32'
      ? t('fileCard.showInExplorer')
      : t('fileCard.showInFileManager');
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
          aria-label={t('fileCard.openWithFile', { name })}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-md bg-surface-input px-2 py-1.5 text-xs text-muted-foreground',
            'transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <span>{t('fileCard.openWith')}</span>
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
          {browserUrl && (
            <>
              <DropdownMenu.Item
                data-testid="acp-file-open-in-built-in-browser"
                className={itemClassName}
                onSelect={() => useArtifactPanel.getState().openWebBrowser(browserUrl)}
              >
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{t('fileCard.openInBuiltInBrowser')}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-black/10 dark:bg-white/10" />
            </>
          )}
          {loading && (
            <DropdownMenu.Item
              disabled
              data-testid="acp-attachment-open-with-loading"
              className={cn(itemClassName, 'text-muted-foreground')}
            >
              <AppWindow className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('fileCard.searchingApplications')}</span>
            </DropdownMenu.Item>
          )}
          {!loading && handlers.map((handler) => (
            <DropdownMenu.Item
              key={handler.handlerId}
              data-testid="acp-attachment-open-with-app"
              className={itemClassName}
              onSelect={() => void openWith(handler.handlerId, activeDiscovery.targetKey)}
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

export function AcpFileCard({
  variant,
  children,
  primaryAriaLabel,
  primaryTestId,
  primaryDisabled = false,
  onPrimary,
  openWith,
  trailing,
}: {
  variant: 'standalone' | 'grouped';
  children: ReactNode;
  primaryAriaLabel: string;
  primaryTestId?: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  openWith?: { target: AcpFileTarget; name: string };
  trailing?: ReactNode;
}) {
  const primary = (
    <button
      type="button"
      disabled={primaryDisabled}
      data-testid={primaryTestId}
      aria-label={primaryAriaLabel}
      onClick={onPrimary}
      className={cn(
        'flex min-w-0 flex-1 items-center text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'standalone' ? 'gap-3 rounded-lg px-2 py-1' : 'gap-2 rounded-lg px-2 py-1.5',
        primaryDisabled
          ? 'cursor-not-allowed text-muted-foreground opacity-70'
          : 'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );

  if (variant === 'standalone' && !openWith && !trailing) {
    return (
      <button
        type="button"
        disabled={primaryDisabled}
        data-testid={primaryTestId}
        aria-label={primaryAriaLabel}
        onClick={onPrimary}
        className={cn(
          'flex w-full max-w-full items-center gap-3 rounded-xl border border-black/10 bg-surface-modal px-3 py-2 text-left text-sm dark:border-white/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          primaryDisabled
            ? 'cursor-not-allowed text-muted-foreground opacity-70'
            : 'transition-colors hover:bg-black/5 dark:hover:bg-white/5',
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={cn(
      'flex min-w-0 items-center gap-1',
      variant === 'standalone'
        ? 'w-full max-w-full rounded-xl border border-black/10 bg-surface-modal p-1 pr-2 text-sm dark:border-white/10'
        : 'w-full',
    )}>
      {primary}
      {trailing}
      {openWith && <AcpFileOpenWith target={openWith.target} name={openWith.name} />}
    </div>
  );
}
