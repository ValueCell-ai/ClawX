/**
 * Chat Toolbar
 * Agent-aware session selector, new session, refresh, and thinking toggle.
 * Groups sessions by agent, shows agent name instead of raw session keys.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, Brain, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore, type ChatSession } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/**
 * Extract agent id from session key.
 * "agent:main:main" => "main"
 * "agent:reddit-crawler:session-123" => "reddit-crawler"
 */
function getAgentIdFromKey(key: string): string {
  if (!key.startsWith('agent:')) return 'main';
  const parts = key.split(':');
  return parts[1] || 'main';
}

/**
 * Get a display-friendly session name.
 * "agent:main:main" => "main"
 * "agent:main:session-1708123456" => "session-1708…"
 */
function getSessionLabel(session: ChatSession): string {
  if (session.displayName && !session.displayName.startsWith('agent:')) {
    return session.displayName;
  }
  const parts = session.key.split(':');
  const suffix = parts.length >= 3 ? parts.slice(2).join(':') : session.key;
  return suffix;
}

export function ChatToolbar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const refresh = useChatStore((s) => s.refresh);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const { agents, fetchAgents } = useAgentsStore();
  const { t } = useTranslation('chat');

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Build agent lookup
  const agentMap = new Map(agents.map(a => [a.id, a]));

  // Group sessions by agent
  const groupedSessions = new Map<string, ChatSession[]>();
  for (const session of sessions) {
    const agentId = getAgentIdFromKey(session.key);
    if (!groupedSessions.has(agentId)) {
      groupedSessions.set(agentId, []);
    }
    groupedSessions.get(agentId)!.push(session);
  }

  // Ensure every enabled agent appears even if it has no sessions yet
  for (const agent of agents) {
    if (agent.enabled && !groupedSessions.has(agent.id)) {
      groupedSessions.set(agent.id, []);
    }
  }

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value.startsWith('__new:')) {
      // Create new session for specific agent
      const agentId = value.replace('__new:', '');
      const newKey = `agent:${agentId}:session-${Date.now()}`;
      switchSession(newKey);
      return;
    }
    setConfirmingDelete(false);
    switchSession(value);
  };

  const handleDeleteSession = async () => {
    if (!currentSessionKey || deleting) return;

    if (!confirmingDelete) {
      // First click: show confirmation state
      setConfirmingDelete(true);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }

    // Second click: actually delete
    setDeleting(true);
    setConfirmingDelete(false);
    try {
      await window.electron.ipcRenderer.invoke('gateway:rpc', 'sessions.delete', {
        key: currentSessionKey,
      });
      toast.success(t('toolbar.sessionDeleted'));
      // Switch to default session, then reload sessions list
      switchSession('agent:main:main');
      await loadSessions();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleting(false);
    }
  };

  // Cancel delete confirmation when session changes
  useEffect(() => {
    setConfirmingDelete(false);
  }, [currentSessionKey]);

  return (
    <div className="flex items-center gap-2">
      {/* Agent + Session Selector */}
      <div className="relative">
        <select
          value={currentSessionKey}
          onChange={handleSessionChange}
          className={cn(
            'appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8',
            'text-sm text-foreground cursor-pointer min-w-[200px]',
            'focus:outline-none focus:ring-2 focus:ring-ring',
          )}
        >
          {/* Guarantee current key appears */}
          {!sessions.some(s => s.key === currentSessionKey) && (
            <option value={currentSessionKey}>
              {currentSessionKey}
            </option>
          )}

          {/* Group by agent */}
          {Array.from(groupedSessions.entries())
            .sort(([a], [b]) => {
              // main always first
              if (a === 'main') return -1;
              if (b === 'main') return 1;
              return a.localeCompare(b);
            })
            .map(([agentId, agentSessions]) => {
              const agent = agentMap.get(agentId);
              const agentLabel = agent ? `🤖 ${agent.name}` : `🤖 ${agentId}`;
              return (
                <optgroup key={agentId} label={agentLabel}>
                  {agentSessions.map(s => (
                    <option key={s.key} value={s.key}>
                      {getSessionLabel(s)}
                    </option>
                  ))}
                  {/* Quick-create option */}
                  <option value={`__new:${agentId}`}>
                    ＋ {t('toolbar.newSessionFor')} {agent?.name || agentId}
                  </option>
                </optgroup>
              );
            })}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>

      {/* New Session (for current agent) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={newSession}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.newSession')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Delete Session (clear history) — double-click to confirm */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              confirmingDelete
                ? 'bg-destructive/20 text-destructive animate-pulse'
                : 'text-muted-foreground hover:text-destructive',
            )}
            onClick={handleDeleteSession}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{confirmingDelete ? t('toolbar.clickAgainToDelete') : t('toolbar.deleteSession')}</p>
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

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
