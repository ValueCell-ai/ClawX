import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowUpRight, Bot, Check, FolderOpen, MessageCircle, MoreHorizontal, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { agentInstructionsSummary, type AgentWorkspaceSnapshot } from '@/lib/agent-workspace';
import { CHANNEL_NAMES, type ChannelType } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import type { ChatSession } from '@shared/chat/types';
import { cn } from '@/lib/utils';
import { CreateAgentDialog } from './CreateAgentDialog';
import { AgentDetails } from './AgentDetails';
import { useAgentWorkspaces } from './useAgentWorkspaces';

export function Agents() {
  const { t } = useTranslation('agents');
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore(state => state.status);
  const refreshProviderSnapshot = useProviderStore(state => state.refreshProviderSnapshot);
  const lastGatewayStateRef = useRef(gatewayStatus.state);
  const { agents, loading, error, fetchAgents, createAgent, deleteAgent } = useAgentsStore();
  const sessions = useChatStore(state => state.sessions);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(() => agents.length > 0);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [lastOpenedAgent, setLastOpenedAgent] = useState<AgentSummary | null>(null);
  const [detailVisit, setDetailVisit] = useState(0);
  const [agentToDelete, setAgentToDelete] = useState<AgentSummary | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { snapshots, refresh: refreshWorkspaces } = useAgentWorkspaces(agents);
  const fetchChannelAccounts = useCallback(async () => {
    try { setChannelGroups((await hostApi.channels.accounts()).channels || []); }
    catch { /* Retain the last usable snapshot during refresh failures. */ }
  }, []);
  useEffect(() => {
    let mounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial asynchronous host snapshots
    void Promise.all([fetchAgents(), fetchChannelAccounts(), refreshProviderSnapshot()]).finally(() => {
      if (mounted) setHasCompletedInitialLoad(true);
    });
    return () => { mounted = false; };
  }, [fetchAgents, fetchChannelAccounts, refreshProviderSnapshot]);
  useEffect(() => hostEvents.onGatewayChannelStatus(() => { void fetchChannelAccounts(); }), [fetchChannelAccounts]);
  useEffect(() => {
    const previous = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh asynchronous channel data after reconnect
    if (previous !== 'running' && gatewayStatus.state === 'running') void fetchChannelAccounts();
  }, [gatewayStatus.state, fetchChannelAccounts]);
  const activeAgent = useMemo(() => agents.find(agent => agent.id === activeAgentId) ?? null, [agents, activeAgentId]);
  const detailAgent = activeAgent || agents.find(agent => agent.id === lastOpenedAgent?.id) || lastOpenedAgent;
  const workspaceFor = (agent: AgentSummary) => snapshots[agent.id]?.workspace === agent.workspace ? snapshots[agent.id] : undefined;
  const refresh = () => { void Promise.all([fetchAgents(), fetchChannelAccounts()]); refreshWorkspaces(); };
  const openDetails = (agent: AgentSummary, trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setLastOpenedAgent(agent);
    setDetailVisit(value => value + 1);
    setActiveAgentId(agent.id);
  };
  const startTask = (agent: AgentSummary) => {
    void useSettingsStore.getState().setChatWorkspacePath(agent.workspace);
    useChatStore.getState().newSession({ agentId: agent.id, preserveDraft: true });
    navigate('/');
  };
  return <div data-testid="agents-page" className="flex h-[calc(100%+3rem)] flex-col -m-6 overflow-hidden dark:bg-background">
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-6 md:p-8">
      <div className="mb-6 flex shrink-0 flex-col justify-between gap-4 md:flex-row md:items-start">
        <div><h1 className="mb-1 font-sans text-2xl font-medium tracking-normal text-foreground">{t('title')}</h1><p className="text-sm text-muted-foreground">{t('subtitle')}</p></div>
        <div className="flex flex-wrap items-center gap-3 md:mt-2"><Button variant="outline" onClick={refresh} className="h-9 px-3 text-sm shadow-none"><RefreshCw className={cn('mr-2 h-3.5 w-3.5', loading && hasCompletedInitialLoad && 'animate-spin')} />{t('refresh')}</Button><Button data-testid="agents-add-button" onClick={() => setShowAddDialog(true)} className="h-9 px-3 text-sm shadow-none"><Plus className="mr-2 h-3.5 w-3.5" />{t('addAgent')}</Button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto -mr-2 pr-2">
        {error && <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
        {loading && !hasCompletedInitialLoad ? <div className="flex h-full items-center justify-center"><LoadingSpinner size="lg" /></div> : <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="agents-roster">
            {agents.map((agent, index) => <AgentCard key={agent.id} agent={agent} index={index} workspace={workspaceFor(agent)} sessions={sessions} channelGroups={channelGroups} onManage={trigger => openDetails(agent, trigger)} onStart={() => startTask(agent)} onDelete={() => setAgentToDelete(agent)} />)}
          </div>
          {agents.length > 0 && <p className="mt-5 text-xs leading-relaxed text-muted-foreground">{t('card.continuityHint')}</p>}
        </>}
      </div>
    </div>
    <CreateAgentDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} onCreate={async (name, options) => { await createAgent(name, options); setShowAddDialog(false); toast.success(t('toast.agentCreated')); }} />
    {detailAgent && <AgentDetails key={detailVisit} open={!!activeAgent} agent={detailAgent} workspace={workspaceFor(detailAgent)} channelGroups={channelGroups} onClose={() => setActiveAgentId(null)} onReturnFocus={() => returnFocusRef.current?.focus()} onWorkspaceSaved={refreshWorkspaces} />}
    <ConfirmDialog open={!!agentToDelete} title={t('deleteDialog.title')} message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''} confirmLabel={t('deleteDialog.confirm')} cancelLabel={t('common:actions.cancel')} variant="destructive" onCancel={() => setAgentToDelete(null)} onConfirm={async () => {
      if (!agentToDelete) return;
      try { await deleteAgent(agentToDelete.id); setAgentToDelete(null); if (activeAgentId === agentToDelete.id) setActiveAgentId(null); toast.success(t('toast.agentDeleted')); }
      catch (error) { toast.error(t('toast.agentDeleteFailed', { error: String(error) })); }
    }} />
  </div>;
}

function AgentCard({ agent, index, workspace, sessions, channelGroups, onManage, onStart, onDelete }: {
  agent: AgentSummary; index: number; workspace?: AgentWorkspaceSnapshot; sessions: ChatSession[]; channelGroups: ChannelGroupItem[];
  onManage: (trigger: HTMLElement) => void; onStart: () => void; onDelete: () => void;
}) {
  const { t, i18n } = useTranslation('agents');
  const menuRef = useRef<HTMLButtonElement>(null);
  const ownedSessions = sessions.filter(session => session.key.split(':')[1] === agent.id && !session.createdLocally);
  const lastActive = Math.max(0, ...ownedSessions.map(session => Number.isFinite(session.updatedAt) ? session.updatedAt! : 0));
  const busy = ownedSessions.some(session => session.hasActiveRun);
  const bound = channelGroups.flatMap(group => group.accounts.filter(account => account.agentId === agent.id).map(account => `${CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType} · ${account.name || account.accountId}`));
  const directory = agent.workspace.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || agent.workspace;
  const summary = workspace?.instructions ? agentInstructionsSummary(workspace.instructions) : '';
  const colors = ['bg-blue-500/10 text-blue-700 dark:text-blue-400', 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', 'bg-violet-500/10 text-violet-700 dark:text-violet-400'];
  return <article data-testid={`agent-card-${agent.id}`} className="flex flex-col rounded-xl border border-border bg-surface-modal p-4 transition-colors hover:border-foreground/20">
    <div className="flex items-start gap-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', colors[index % colors.length])}><Bot className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1 pt-0.5"><h2 className="flex h-6 items-center gap-2 text-base font-medium"><button type="button" data-testid={`agent-manage-${agent.id}`} className="min-w-0 truncate rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => onManage(event.currentTarget)} aria-label={t('card.openDetails', { name: agent.name })}>{agent.name}</button>{agent.isDefault && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground dark:bg-white/10"><Check className="h-2.5 w-2.5" />{t('defaultBadge')}</span>}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.inheritedModel ? t('card.defaultModel', { model: agent.modelDisplay }) : agent.modelDisplay}</p></div>
      <Menu.Root><Menu.Trigger asChild><Button ref={menuRef} variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" data-testid={`agent-menu-${agent.id}`} aria-label={t('card.actions', { name: agent.name })} title={t('card.actions', { name: agent.name })}><MoreHorizontal className="h-4 w-4" /></Button></Menu.Trigger><Menu.Portal><Menu.Content align="end" sideOffset={6} className="clawx-menu-list min-w-40 rounded-xl border border-border bg-surface-modal p-1.5 shadow-xl"><Menu.Item className="clawx-menu-item flex items-center gap-2 text-sm" onSelect={() => { if (menuRef.current) onManage(menuRef.current); }}><Settings2 className="h-3.5 w-3.5" />{t('settings')}</Menu.Item>{!agent.isDefault && <Menu.Item data-testid={`agent-delete-${agent.id}`} className="clawx-menu-item flex items-center gap-2 text-sm text-destructive" onSelect={onDelete}><Trash2 className="h-3.5 w-3.5" />{t('deleteAgent')}</Menu.Item>}</Menu.Content></Menu.Portal></Menu.Root>
    </div>
    <p className="mt-3 min-h-10 text-sm leading-5 text-muted-foreground line-clamp-2" title={summary || undefined}>{summary || t(!workspace ? 'profile.loadingFiles' : workspace.error ? 'card.workspaceUnavailable' : 'card.emptyWorkStyle')}</p>
    <div className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={agent.workspace}><FolderOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{directory}</span>{bound.length > 0 && <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 truncate" title={bound.join(', ')}><MessageCircle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{bound.join(', ')}</span></span>}</div>
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3"><span className="min-w-0 truncate text-xs text-muted-foreground">{busy ? t('card.working') : lastActive > 0 ? t('card.recentActivity', { date: new Intl.DateTimeFormat(i18n?.language || 'en', { month: 'short', day: 'numeric' }).format(lastActive) }) : t('card.readyHint')}</span><Button variant="ghost" className="h-8 shrink-0 gap-1 rounded-lg px-2.5 text-xs font-medium text-primary hover:bg-primary/5 hover:text-primary" data-testid={`agent-start-${agent.id}`} onClick={onStart}>{t('card.startTask')}<ArrowUpRight className="h-3.5 w-3.5" /></Button></div>
  </article>;
}

export default Agents;
