import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowUpRight, Check, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import * as Menu from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ModelIcon } from '@/components/common/ModelIcon';
import { ChannelLogo } from '@/components/channels/ChannelLogo';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';
import { hostApi, type ChannelGroupItem } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
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
            {agents.map(agent => <AgentCard key={agent.id} agent={agent} sessions={sessions} channelGroups={channelGroups} onManage={trigger => openDetails(agent, trigger)} onStart={() => startTask(agent)} onDelete={() => setAgentToDelete(agent)} />)}
          </div>
        </>}
      </div>
    </div>
    <CreateAgentDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} onCreate={async (name, options) => { await createAgent(name, options); setShowAddDialog(false); toast.success(t('toast.agentCreated')); }} />
    {detailAgent && <AgentDetails key={detailVisit} open={!!activeAgent} agent={detailAgent} workspace={workspaceFor(detailAgent)} channelGroups={channelGroups} onClose={() => setActiveAgentId(null)} onReturnFocus={() => returnFocusRef.current?.focus()} onWorkspaceSaved={refreshWorkspaces} onStart={() => startTask(detailAgent)} />}
    <ConfirmDialog open={!!agentToDelete} title={t('deleteDialog.title')} message={agentToDelete ? t('deleteDialog.message', { name: agentToDelete.name }) : ''} confirmLabel={t('deleteDialog.confirm')} cancelLabel={t('common:actions.cancel')} variant="destructive" onCancel={() => setAgentToDelete(null)} onConfirm={async () => {
      if (!agentToDelete) return;
      try { await deleteAgent(agentToDelete.id); setAgentToDelete(null); if (activeAgentId === agentToDelete.id) setActiveAgentId(null); toast.success(t('toast.agentDeleted')); }
      catch (error) { toast.error(t('toast.agentDeleteFailed', { error: String(error) })); }
    }} />
  </div>;
}

function AgentCard({ agent, sessions, channelGroups, onManage, onStart, onDelete }: {
  agent: AgentSummary; sessions: ChatSession[]; channelGroups: ChannelGroupItem[];
  onManage: (trigger: HTMLElement) => void; onStart: () => void; onDelete: () => void;
}) {
  const { t, i18n } = useTranslation('agents');
  const menuRef = useRef<HTMLButtonElement>(null);
  const ownedSessions = sessions.filter(session => session.key.split(':')[1] === agent.id && !session.createdLocally);
  const lastActive = Math.max(0, ...ownedSessions.map(session => Number.isFinite(session.updatedAt) ? session.updatedAt! : 0));
  const busy = ownedSessions.some(session => session.hasActiveRun);
  const bound = channelGroups.flatMap(group => group.accounts.filter(account => account.agentId === agent.id).map(account => ({ type: group.channelType, id: account.accountId, label: `${CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType} · ${account.name || account.accountId}` })));
  const directory = agent.workspace.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || agent.workspace;
  return <article data-testid={`agent-card-${agent.id}`} className="flex flex-col rounded-xl border border-border bg-surface-modal p-4 transition-colors hover:border-foreground/20">
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-base font-medium"><button type="button" data-testid={`agent-manage-${agent.id}`} className="min-w-0 truncate rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={event => onManage(event.currentTarget)} aria-label={t('card.openDetails', { name: agent.name })}>{agent.name}</button>{agent.isDefault && <Badge variant="secondary" className="shrink-0 gap-1 bg-black/5 px-2 font-normal text-muted-foreground dark:bg-white/10"><Check className="h-3 w-3" />{t('defaultBadge')}</Badge>}</h2>
      {!agent.isDefault && <Menu.Root><Menu.Trigger asChild><Button ref={menuRef} variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" data-testid={`agent-menu-${agent.id}`} aria-label={t('card.actions', { name: agent.name })} title={t('card.actions', { name: agent.name })}><MoreHorizontal className="h-4 w-4" /></Button></Menu.Trigger><Menu.Portal><Menu.Content align="end" sideOffset={6} className="clawx-menu-list min-w-40 rounded-xl border border-border bg-surface-modal p-1.5 shadow-xl"><Menu.Item data-testid={`agent-delete-${agent.id}`} className="clawx-menu-item flex items-center gap-2 text-sm text-destructive" onSelect={onDelete}><Trash2 className="h-3.5 w-3.5" />{t('deleteAgent')}</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>}
    </div>
    <dl className="mt-4 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm">
      <dt className="text-muted-foreground">{t('settingsDialog.modelLabel')}</dt><dd className="m-0 flex min-w-0 items-center gap-2"><ModelIcon modelName={agent.modelDisplay} testId={`agent-model-icon-${agent.id}`} /><span className="truncate" title={agent.modelDisplay}>{agent.modelDisplay}</span></dd>
      <dt className="text-muted-foreground">{t('detailTabs.directory')}</dt><dd className="m-0 min-w-0 truncate" title={agent.workspace}>{directory}</dd>
      <dt className="self-start pt-0.5 text-muted-foreground">{t('profile.channelsTitle')}</dt><dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" title={bound.map(item => item.label).join('\n') || undefined}>{bound.length ? <>{bound.slice(0, 2).map(item => <span key={`${item.type}-${item.id}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5"><ChannelLogo type={item.type} className="h-4 w-4" /><span className="truncate">{item.label}</span></span>)}{bound.length > 2 && <span className="shrink-0 text-muted-foreground">{t('card.moreAccounts', { count: bound.length - 2 })}</span>}</> : <span className="truncate text-muted-foreground">{t('detailTabs.noBindings')}</span>}</dd>
    </dl>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="min-w-0 text-meta text-muted-foreground">{busy ? t('card.working') : lastActive > 0 ? t('card.recentActivity', { date: new Intl.DateTimeFormat(i18n?.language || 'en', { month: 'short', day: 'numeric' }).format(lastActive) }) : t('card.readyHint')}</span><div className="flex shrink-0 items-center gap-2"><Button variant="outline" size="sm" data-testid={`agent-details-button-${agent.id}`} onClick={event => onManage(event.currentTarget)}>{t('detailTabs.manage')}</Button><Button variant="secondary" size="sm" className="gap-1.5" data-testid={`agent-start-${agent.id}`} onClick={onStart}>{t('card.startTask')}<ArrowUpRight className="h-4 w-4" /></Button></div></div>
  </article>;
}

export default Agents;
