/**
 * Chat Toolbar
 * Session-level attached agents, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Brain, Bot, Plus, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useChatMetaStore } from '@/stores/chatMeta';
import { useAgentsStore } from '@/stores/agents';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getAttachedAgentIds } from '@/lib/routing';

export function ChatToolbar() {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const chatMeta = useChatMetaStore((s) => s.meta);
  const setAttachedAgents = useChatMetaStore((s) => s.setAttachedAgents);
  const { t } = useTranslation('chat');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentAgentName = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId)?.name ?? currentAgentId,
    [agents, currentAgentId],
  );
  const attachedAgentIds = useMemo(
    () => getAttachedAgentIds(currentAgentId, chatMeta[currentSessionKey]?.attachedAgentIds),
    [chatMeta, currentAgentId, currentSessionKey],
  );
  const availableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const attachedAgents = useMemo(
    () => availableAgents.filter((agent) => attachedAgentIds.includes(agent.id)),
    [attachedAgentIds, availableAgents],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pickerOpen]);

  const toggleAgent = (agentId: string) => {
    const nextAgentIds = attachedAgentIds.includes(agentId)
      ? attachedAgentIds.filter((id) => id !== agentId)
      : [...attachedAgentIds, agentId];
    setAttachedAgents(currentSessionKey, nextAgentIds);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-foreground/80 dark:border-white/10 dark:bg-white/5">
        <Bot className="h-3.5 w-3.5 text-primary" />
        <span>{t('toolbar.currentAgent', { agent: currentAgentName })}</span>
      </div>
      <div ref={pickerRef} className="relative flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 rounded-full border border-black/10 bg-white/70 px-3 text-[12px] font-medium text-foreground/80 hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Agent
        </Button>
        {attachedAgents.length > 0 && (
          <div className="hidden md:flex flex-wrap items-center gap-1.5">
            {attachedAgents.map((agent) => (
              <Badge
                key={agent.id}
                variant="secondary"
                className="flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/75 dark:border-white/10 dark:bg-white/[0.08]"
              >
                <span>{agent.name}</span>
                <button
                  type="button"
                  onClick={() => toggleAgent(agent.id)}
                  className="rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Remove ${agent.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {pickerOpen && (
          <div className="absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-card">
            <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
              Attach one or more existing agents to this conversation. The current chat remains the primary thread and attached agents reply afterward in the same window.
            </div>
            <div className="max-h-72 overflow-y-auto">
              {availableAgents.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted-foreground">
                  No additional agents available yet.
                </div>
              ) : (
                availableAgents.map((agent) => {
                  const selected = attachedAgentIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className={cn(
                        'flex w-full items-start justify-between rounded-xl px-3 py-2 text-left transition-colors',
                        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-foreground">{agent.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{agent.modelDisplay}</span>
                      </span>
                      <span className="ml-3 flex h-5 w-5 items-center justify-center rounded-full border border-black/10 text-muted-foreground dark:border-white/10">
                        {selected && <Check className="h-3 w-3 text-primary" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
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
