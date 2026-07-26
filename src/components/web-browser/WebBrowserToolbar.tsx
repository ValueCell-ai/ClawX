import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  Database,
  Ellipsis,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canOpenWebBrowserExternally } from '@shared/web-browser';
import type { WebBrowserAddressErrorCode } from '@shared/web-browser';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WebBrowserAddressControl } from './WebBrowserAddressControl';

export interface WebBrowserToolbarProps {
  title: string;
  url: string;
  faviconUrl: string | null;
  addressNavigationId?: number;
  canGoBack: boolean;
  canGoForward: boolean;
  visible: boolean;
  crashed: boolean;
  clearingCookies: boolean;
  clearingSiteData: boolean;
  onNavigate: (url: string) => void | Promise<void>;
  onAddressError: (error: WebBrowserAddressErrorCode) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onForceRefresh: () => void;
  onClearCookies: () => void;
  onClearSiteData: () => void;
  onOpenExternal: () => void;
}

interface ToolbarButtonProps {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

interface MoreMenuProps {
  available: boolean;
  url: string;
  moreLabel: string;
  clearingCookies: boolean;
  clearingSiteData: boolean;
  onForceRefresh: () => void;
  onClearCookies: () => void;
  onClearSiteData: () => void;
  onOpenExternal: () => void;
}

function ToolbarButton({
  label,
  testId,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          className="h-8 w-8 shrink-0"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MoreMenu({
  available,
  url,
  moreLabel,
  clearingCookies,
  clearingSiteData,
  onForceRefresh,
  onClearCookies,
  onClearSiteData,
  onOpenExternal,
}: MoreMenuProps): React.ReactElement {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={available && open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-testid="web-browser-more"
              aria-label={moreLabel}
              className="h-8 w-8 shrink-0"
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{moreLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid="web-browser-force-refresh" onSelect={onForceRefresh}>
          <RefreshCw className="mr-2 h-4 w-4 shrink-0" />
          {t('artifactPanel.webBrowser.actions.forceRefresh')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="web-browser-clear-cookies"
          disabled={clearingCookies}
          onSelect={onClearCookies}
        >
          <Cookie className="mr-2 h-4 w-4 shrink-0" />
          {t('artifactPanel.webBrowser.actions.clearCookies')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="web-browser-clear-site-data"
          disabled={clearingSiteData}
          onSelect={onClearSiteData}
        >
          <Database className="mr-2 h-4 w-4 shrink-0" />
          {t('artifactPanel.webBrowser.actions.clearSiteData')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="web-browser-open-external"
          disabled={!canOpenWebBrowserExternally(url)}
          onSelect={onOpenExternal}
        >
          <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
          {t('artifactPanel.webBrowser.actions.openExternal')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WebBrowserToolbar({
  title,
  url,
  faviconUrl,
  addressNavigationId,
  canGoBack,
  canGoForward,
  visible,
  crashed,
  clearingCookies,
  clearingSiteData,
  onNavigate,
  onAddressError,
  onBack,
  onForward,
  onRefresh,
  onForceRefresh,
  onClearCookies,
  onClearSiteData,
  onOpenExternal,
}: WebBrowserToolbarProps): React.ReactElement {
  const { t } = useTranslation('chat');
  const backLabel = t('artifactPanel.webBrowser.actions.back');
  const forwardLabel = t('artifactPanel.webBrowser.actions.forward');
  const refreshLabel = t('artifactPanel.webBrowser.actions.refresh');
  const moreLabel = t('artifactPanel.webBrowser.actions.more');

  const menuAvailable = visible && !crashed;

  return (
    <div
      data-testid="web-browser-toolbar"
      className="flex min-w-0 items-center gap-1 border-b border-border bg-background p-1.5"
    >
      <ToolbarButton
        label={backLabel}
        testId="web-browser-back"
        disabled={!canGoBack}
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={forwardLabel}
        testId="web-browser-forward"
        disabled={!canGoForward}
        onClick={onForward}
      >
        <ArrowRight className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label={refreshLabel}
        testId="web-browser-refresh"
        onClick={onRefresh}
      >
        <RefreshCw className="h-4 w-4" />
      </ToolbarButton>

      <WebBrowserAddressControl
        key={addressNavigationId ?? 0}
        title={title}
        url={url}
        faviconUrl={faviconUrl}
        onNavigate={onNavigate}
        onAddressError={onAddressError}
      />

      <MoreMenu
        key={menuAvailable ? 'available' : 'unavailable'}
        available={menuAvailable}
        url={url}
        moreLabel={moreLabel}
        clearingCookies={clearingCookies}
        clearingSiteData={clearingSiteData}
        onForceRefresh={onForceRefresh}
        onClearCookies={onClearCookies}
        onClearSiteData={onClearSiteData}
        onOpenExternal={onOpenExternal}
      />
    </div>
  );
}
