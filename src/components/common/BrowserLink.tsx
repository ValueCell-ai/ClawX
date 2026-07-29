import { type AnchorHTMLAttributes, type MouseEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ExternalLink, Globe2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeExternalWebUrl } from '@shared/web-browser';
import { hostApi } from '@/lib/host-api';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';

export interface BrowserLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export function BrowserLink({
  href,
  children,
  className,
  onClick,
  onAuxClick,
  ...props
}: BrowserLinkProps) {
  const { t } = useTranslation('chat');
  const url = normalizeExternalWebUrl(href);

  const openExternal = () => {
    if (url) void hostApi.webBrowser.openExternalUrl(url);
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    openExternal();
  };

  const handleAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onAuxClick?.(event);
    if (event.defaultPrevented || event.button !== 1) return;
    event.preventDefault();
    openExternal();
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={!url}>
        <a
          {...props}
          href={href}
          className={className}
          onClick={handleClick}
          onAuxClick={handleAuxClick}
        >
          {children}
        </a>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-testid="browser-link-menu"
          className="z-[110] min-w-52 rounded-lg border border-black/10 bg-surface-modal p-1 text-foreground shadow-lg dark:border-white/10"
        >
          <ContextMenu.Item
            data-testid="browser-link-open-in-clawx"
            className={cn(
              'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
              'data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10',
            )}
            onSelect={() => {
              if (url) useArtifactPanel.getState().openWebBrowser(url);
            }}
          >
            <Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('artifactPanel.webBrowser.linkMenu.openInClawX')}
          </ContextMenu.Item>
          <ContextMenu.Item
            data-testid="browser-link-open-in-system-browser"
            className={cn(
              'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
              'data-[highlighted]:bg-black/5 dark:data-[highlighted]:bg-white/10',
            )}
            onSelect={openExternal}
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('artifactPanel.webBrowser.linkMenu.openInSystemBrowser')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export default BrowserLink;
