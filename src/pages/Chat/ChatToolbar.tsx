/**
 * Chat Toolbar
 * Session selector, new session, refresh, and the workspace browser
 * entry point.  Rendered in the Header when on the Chat page.
 */
import { useMemo } from 'react';
import { RefreshCw, Bot, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_BROWSER_ENABLED } from '@/components/file-preview/workspace-browser-config';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const openBrowser = useArtifactPanel((s) => s.openBrowser);
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelTab = useArtifactPanel((s) => s.tab);
  const closePanel = useArtifactPanel((s) => s.close);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = currentAgent?.name ?? currentAgentId;

  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen && panelTab === 'browser';

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>
      {WORKSPACE_BROWSER_ENABLED && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', browserActive && 'bg-foreground/10 text-foreground')}
              onClick={() => (browserActive ? closePanel() : openBrowser())}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace', '工作空间')}
            >
              <FolderTree className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.workspace', '工作空间')}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
