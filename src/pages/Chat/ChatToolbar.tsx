/**
 * Chat Toolbar
 * Session selector, new session, refresh, and the workspace browser
 * entry point.  Rendered in the Header when on the Chat page.
 */
import { Suspense, lazy, useMemo, useState } from 'react';
import { RefreshCw, Bot, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const WorkspaceBrowserOverlayLazy = lazy(() =>
  import('@/components/file-preview/WorkspaceBrowserOverlay').then((m) => ({ default: m.WorkspaceBrowserOverlay })),
);

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const lastUserMessageAt = useChatStore((s) => s.lastUserMessageAt);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = currentAgent?.name ?? currentAgentId;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // Bumps a counter every time the chat run goes idle so the workspace
  // tree auto-refreshes after the AI finishes writing files.
  const refreshSignal = useMemo(() => {
    if (sending) return undefined;
    return lastUserMessageAt ?? 0;
  }, [sending, lastUserMessageAt]);

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>
      {/* Workspace browser */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setWorkspaceOpen(true)}
            disabled={!currentAgent?.workspace}
          >
            <FolderTree className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.workspace', '工作空间')}</p>
        </TooltipContent>
      </Tooltip>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>
      {currentAgent && (
        <Suspense fallback={null}>
          <WorkspaceBrowserOverlayLazy
            open={workspaceOpen}
            agent={currentAgent}
            onClose={() => setWorkspaceOpen(false)}
            runStartedAt={lastUserMessageAt ?? null}
            refreshSignal={refreshSignal}
          />
        </Suspense>
      )}
    </div>
  );
}
