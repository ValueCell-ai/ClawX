import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, AlertCircle, Plus, Copy, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  type ChannelType,
} from '@/types/channel';
import { usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
  statusReason?: string;
  accounts: ChannelAccountItem[];
}

interface GatewayHealthSummary {
  state: 'healthy' | 'degraded' | 'unresponsive';
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
}

interface GatewayDiagnosticSnapshot {
  capturedAt: number;
  platform: string;
  gateway: GatewayHealthSummary & Record<string, unknown>;
  channels: ChannelGroupItem[];
  clawxLogTail: string;
  gatewayLogTail: string;
  gatewayErrLogTail: string;
}

function isGatewayDiagnosticSnapshot(value: unknown): value is GatewayDiagnosticSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.capturedAt === 'number'
    && typeof snapshot.platform === 'string'
    && typeof snapshot.gateway === 'object'
    && snapshot.gateway !== null
    && Array.isArray(snapshot.channels)
    && typeof snapshot.clawxLogTail === 'string'
    && typeof snapshot.gatewayLogTail === 'string'
    && typeof snapshot.gatewayErrLogTail === 'string'
  );
}

interface AgentItem {
  id: string;
  name: string;
}

interface DeleteTarget {
  channelType: string;
  accountId?: string;
}

function removeDeletedTarget(groups: ChannelGroupItem[], target: DeleteTarget): ChannelGroupItem[] {
  if (target.accountId) {
    return groups
      .map((group) => {
        if (group.channelType !== target.channelType) return group;
        return {
          ...group,
          accounts: group.accounts.filter((account) => account.accountId !== target.accountId),
        };
      })
      .filter((group) => group.accounts.length > 0);
  }

  return groups.filter((group) => group.channelType !== target.channelType);
}

const DEFAULT_GATEWAY_HEALTH: GatewayHealthSummary = {
  state: 'healthy',
  reasons: [],
  consecutiveHeartbeatMisses: 0,
};

export function Channels() {
  const { t } = useTranslation('channels');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const lastGatewayStateRef = useRef(gatewayStatus.state);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelGroups, setChannelGroups] = useState<ChannelGroupItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthSummary>(DEFAULT_GATEWAY_HEALTH);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<GatewayDiagnosticSnapshot | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);
  const [allowExistingConfigInModal, setAllowExistingConfigInModal] = useState(true);
  const [allowEditAccountIdInModal, setAllowEditAccountIdInModal] = useState(false);
  const [existingAccountIdsForModal, setExistingAccountIdsForModal] = useState<string[]>([]);
  const [initialConfigValuesForModal, setInitialConfigValuesForModal] = useState<Record<string, string> | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const convergenceRefreshTimersRef = useRef<number[]>([]);
  const fetchInFlightRef = useRef(false);
  const queuedFetchOptionsRef = useRef<{ probe?: boolean } | null>(null);

  const displayedChannelTypes = getPrimaryChannels();
  const visibleChannelGroups = channelGroups;
  const visibleAgents = agents;
  const hasStableValue = visibleChannelGroups.length > 0 || visibleAgents.length > 0;
  const isUsingStableValue = hasStableValue && (loading || Boolean(error));

  // Use refs to read current state inside fetchPageData without making it
  // a dependency — keeps the callback reference stable across renders so
  // downstream useEffects don't re-execute every time data changes.
  const channelGroupsRef = useRef(channelGroups);
  channelGroupsRef.current = channelGroups;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const mergeFetchOptions = (
    base: { probe?: boolean } | null,
    incoming: { probe?: boolean } | undefined,
  ): { probe?: boolean } => {
    return {
      probe: Boolean(base?.probe) || Boolean(incoming?.probe),
    };
  };

  const fetchPageData = useCallback(async (options?: { probe?: boolean }) => {
    if (fetchInFlightRef.current) {
      queuedFetchOptionsRef.current = mergeFetchOptions(queuedFetchOptionsRef.current, options);
      return;
    }
    fetchInFlightRef.current = true;
    const startedAt = Date.now();
    const probe = options?.probe === true;
    console.info(`[channels-ui] fetch start probe=${probe ? '1' : '0'}`);
    // Only show loading spinner on first load (stale-while-revalidate).
    const hasData = channelGroupsRef.current.length > 0 || agentsRef.current.length > 0;
    if (!hasData) {
      setLoading(true);
    }
    setError(null);
    try {
      const [channelsRes, agentsRes] = await Promise.all([
        hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[]; error?: string }>(
          options?.probe ? '/api/channels/accounts?probe=1' : '/api/channels/accounts'
        ),
        hostApiFetch<{ success: boolean; agents?: AgentItem[]; error?: string }>('/api/agents'),
      ]);

      type ChannelsResponse = {
        success: boolean;
        channels?: ChannelGroupItem[];
        gatewayHealth?: GatewayHealthSummary;
        error?: string;
      };
      const channelsPayload = channelsRes as ChannelsResponse;

      if (!channelsPayload.success) {
        throw new Error(channelsPayload.error || 'Failed to load channels');
      }

      if (!agentsRes.success) {
        throw new Error(agentsRes.error || 'Failed to load agents');
      }

      setChannelGroups(channelsPayload.channels || []);
      setAgents(agentsRes.agents || []);
      setGatewayHealth(channelsPayload.gatewayHealth || DEFAULT_GATEWAY_HEALTH);
      setDiagnosticsSnapshot(null);
      setShowDiagnostics(false);
      console.info(
        `[channels-ui] fetch ok probe=${probe ? '1' : '0'} elapsedMs=${Date.now() - startedAt} view=${(channelsPayload.channels || []).map((item) => `${item.channelType}:${item.status}`).join(',')}`
      );
    } catch (fetchError) {
      // Preserve previous data on error — don't clear channelGroups/agents.
      setError(String(fetchError));
      console.warn(
        `[channels-ui] fetch fail probe=${probe ? '1' : '0'} elapsedMs=${Date.now() - startedAt} error=${String(fetchError)}`
      );
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
      const queued = queuedFetchOptionsRef.current;
      if (queued) {
        queuedFetchOptionsRef.current = null;
        void fetchPageData(queued);
      }
    }
  // Stable reference — reads state via refs, no deps needed.
   
  }, []);

  const clearConvergenceRefreshTimers = useCallback(() => {
    convergenceRefreshTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    convergenceRefreshTimersRef.current = [];
  }, []);

  const scheduleConvergenceRefresh = useCallback(() => {
    clearConvergenceRefreshTimers();
    // Channel adapters can take time to reconnect after gateway restart.
    // First few rounds use probe=true to force runtime connectivity checks,
    // then fall back to cached pulls to reduce load.
    [
      { delay: 1200, probe: true },
      { delay: 2600, probe: false },
      { delay: 4500, probe: false },
      { delay: 7000, probe: false },
      { delay: 10500, probe: false },
    ].forEach(({ delay, probe }) => {
      const timerId = window.setTimeout(() => {
        void fetchPageData({ probe });
      }, delay);
      convergenceRefreshTimersRef.current.push(timerId);
    });
  }, [clearConvergenceRefreshTimers, fetchPageData]);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    return () => {
      clearConvergenceRefreshTimers();
    };
  }, [clearConvergenceRefreshTimers]);

  useEffect(() => {
    // Throttle channel-status events to avoid flooding fetchPageData during AI tasks.
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let pending = false;

    const unsubscribe = subscribeHostEvent('gateway:channel-status', () => {
      if (throttleTimer) {
        pending = true;
        return;
      }
      void fetchPageData();
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        if (pending) {
          pending = false;
          void fetchPageData();
        }
      }, 2000);
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
    };
  }, [fetchPageData]);

  useEffect(() => {
    const previousGatewayState = lastGatewayStateRef.current;
    lastGatewayStateRef.current = gatewayStatus.state;

    if (previousGatewayState !== 'running' && gatewayStatus.state === 'running') {
      void fetchPageData();
      scheduleConvergenceRefresh();
    }
  }, [fetchPageData, gatewayStatus.state, scheduleConvergenceRefresh]);

  const configuredTypes = useMemo(
    () => visibleChannelGroups.map((group) => group.channelType),
    [visibleChannelGroups],
  );

  const groupedByType = useMemo(() => {
    return Object.fromEntries(visibleChannelGroups.map((group) => [group.channelType, group]));
  }, [visibleChannelGroups]);

  const configuredGroups = useMemo(() => {
    const known = displayedChannelTypes
      .map((type) => groupedByType[type])
      .filter((group): group is ChannelGroupItem => Boolean(group));
    const unknown = visibleChannelGroups.filter((group) => !displayedChannelTypes.includes(group.channelType as ChannelType));
    return [...known, ...unknown];
  }, [visibleChannelGroups, displayedChannelTypes, groupedByType]);

  const unsupportedGroups = displayedChannelTypes.filter((type) => !configuredTypes.includes(type));

  const handleRefresh = () => {
    void fetchPageData({ probe: true });
  };

  const fetchDiagnosticsSnapshot = useCallback(async (): Promise<GatewayDiagnosticSnapshot> => {
    const response = await hostApiFetch<unknown>('/api/diagnostics/gateway-snapshot');
    if (response && typeof response === 'object') {
      const payload = response as Record<string, unknown>;
      if (payload.success === false || typeof payload.error === 'string') {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Failed to fetch gateway diagnostics snapshot');
      }
    }
    if (!isGatewayDiagnosticSnapshot(response)) {
      throw new Error('Invalid gateway diagnostics snapshot response');
    }
    const snapshot = response;
    setDiagnosticsSnapshot(snapshot);
    return snapshot;
  }, []);

  const handleRestartGateway = async () => {
    try {
      const result = await hostApiFetch<{ success?: boolean; error?: string }>('/api/gateway/restart', {
        method: 'POST',
      });
      if (result?.success !== true) {
        throw new Error(result?.error || 'Failed to restart gateway');
      }
      setDiagnosticsSnapshot(null);
      setShowDiagnostics(false);
      toast.success(t('health.restartTriggered'));
      void fetchPageData({ probe: true });
    } catch (restartError) {
      toast.error(t('health.restartFailed', { error: String(restartError) }));
    }
  };

  const handleCopyDiagnostics = async () => {
    setDiagnosticsLoading(true);
    try {
      const snapshot = await fetchDiagnosticsSnapshot();
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      toast.success(t('health.diagnosticsCopied'));
    } catch (copyError) {
      toast.error(t('health.diagnosticsCopyFailed', { error: String(copyError) }));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const handleToggleDiagnostics = async () => {
    if (showDiagnostics) {
      setShowDiagnostics(false);
      return;
    }
    setDiagnosticsLoading(true);
    try {
      await fetchDiagnosticsSnapshot();
    } catch (diagnosticsError) {
      toast.error(t('health.diagnosticsCopyFailed', { error: String(diagnosticsError) }));
      setDiagnosticsLoading(false);
      return;
    } finally {
      setDiagnosticsLoading(false);
    }
    setShowDiagnostics(true);
  };

  const healthReasonLabel = useMemo(() => {
    const primaryReason = gatewayHealth.reasons[0];
    if (!primaryReason) return '';
    return t(`health.reasons.${primaryReason}`);
  }, [gatewayHealth.reasons, t]);

  const diagnosticsText = useMemo(
    () => diagnosticsSnapshot ? JSON.stringify(diagnosticsSnapshot, null, 2) : '',
    [diagnosticsSnapshot],
  );




  const statusLabel = useCallback((status: ChannelGroupItem['status']) => {
    return t(`account.connectionStatus.${status}`);
  }, [t]);

  const handleBindAgent = async (channelType: string, accountId: string, agentId: string) => {
    try {
      if (!agentId) {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'DELETE',
          body: JSON.stringify({ channelType, accountId }),
        });
      } else {
        await hostApiFetch<{ success: boolean; error?: string }>('/api/channels/binding', {
          method: 'PUT',
          body: JSON.stringify({ channelType, accountId, agentId }),
        });
      }
      await fetchPageData();
      toast.success(t('toast.bindingUpdated'));
    } catch (bindError) {
      toast.error(t('toast.configFailed', { error: String(bindError) }));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const suffix = deleteTarget.accountId
        ? `?accountId=${encodeURIComponent(deleteTarget.accountId)}`
        : '';
      await hostApiFetch(`/api/channels/config/${encodeURIComponent(deleteTarget.channelType)}${suffix}`, {
        method: 'DELETE',
      });
      setChannelGroups((prev) => removeDeletedTarget(prev, deleteTarget));
      toast.success(deleteTarget.accountId ? t('toast.accountDeleted') : t('toast.channelDeleted'));
      // Channel reload is debounced in main process; pull again shortly to
      // converge with runtime state without flashing deleted rows back in.
      window.setTimeout(() => {
        void fetchPageData();
      }, 1200);
    } catch (deleteError) {
      toast.error(t('toast.configFailed', { error: String(deleteError) }));
    } finally {
      setDeleteTarget(null);
    }
  };

  const createNewAccountId = (channelType: string, existingAccounts: string[]): string => {
    // Generate a collision-safe default account id for user editing.
    let nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    while (existingAccounts.includes(nextAccountId)) {
      nextAccountId = `${channelType}-${crypto.randomUUID().slice(0, 8)}`;
    }
    return nextAccountId;
  };

  if (loading && !hasStableValue) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div data-testid="channels-page" className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('title')}
            </h1>
            <p className="text-[17px] text-foreground/70 font-medium">
              {t('subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-3 md:mt-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={gatewayStatus.state !== 'running'}
              className="h-9 text-[13px] font-medium rounded-full px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-2', isUsingStableValue && 'animate-spin')} />
              {t('refresh')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {gatewayStatus.state !== 'running' && (
            <div className="mb-8 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-700 dark:text-yellow-400 text-sm font-medium">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {gatewayStatus.state === 'running' && gatewayHealth.state !== 'healthy' && (
            <div
              data-testid="channels-health-banner"
              className={cn(
                'mb-8 rounded-xl border p-4',
                gatewayHealth.state === 'unresponsive'
                  ? 'border-destructive/50 bg-destructive/10'
                  : 'border-yellow-500/50 bg-yellow-500/10',
              )}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle
                    className={cn(
                      'mt-0.5 h-5 w-5 shrink-0',
                      gatewayHealth.state === 'unresponsive'
                        ? 'text-destructive'
                        : 'text-yellow-600 dark:text-yellow-400',
                    )}
                  />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {t(`health.state.${gatewayHealth.state}`)}
                    </p>
                    {healthReasonLabel && (
                      <p className="mt-1 text-sm text-foreground/75">{healthReasonLabel}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    data-testid="channels-restart-gateway"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full text-xs"
                    onClick={() => { void handleRestartGateway(); }}
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    {t('health.restartGateway')}
                  </Button>
                  <Button
                    data-testid="channels-copy-diagnostics"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full text-xs"
                    disabled={diagnosticsLoading}
                    onClick={() => { void handleCopyDiagnostics(); }}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    {t('health.copyDiagnostics')}
                  </Button>
                  <Button
                    data-testid="channels-toggle-diagnostics"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full text-xs"
                    disabled={diagnosticsLoading}
                    onClick={() => { void handleToggleDiagnostics(); }}
                  >
                    {showDiagnostics ? (
                      <ChevronUp className="mr-2 h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="mr-2 h-3.5 w-3.5" />
                    )}
                    {showDiagnostics ? t('health.hideDiagnostics') : t('health.viewDiagnostics')}
                  </Button>
                </div>
              </div>

              {showDiagnostics && diagnosticsText && (
                <div className="mt-4 rounded-xl border border-black/10 dark:border-white/10 bg-background/80 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{t('health.diagnosticsTitle')}</p>
                  <pre data-testid="channels-diagnostics" className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all text-[11px] text-foreground/85">
                    {diagnosticsText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-8 p-4 rounded-xl border border-destructive/50 bg-destructive/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span className="text-destructive text-sm font-medium">
                {error}
              </span>
            </div>
          )}

          {configuredGroups.length > 0 && (
            <div className="mb-12">
              <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
                {t('configured')}
              </h2>
              <div className="space-y-4">
                {configuredGroups.map((group) => (
                  <div key={group.channelType} className="rounded-2xl border border-black/10 dark:border-white/10 p-4 bg-transparent">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-[40px] w-[40px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm">
                          <ChannelLogo type={group.channelType as ChannelType} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-[16px] font-semibold text-foreground truncate">
                            {CHANNEL_NAMES[group.channelType as ChannelType] || group.channelType}
                          </h3>
                          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            <span>{group.channelType}</span>
                            <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                            <span className="flex items-center gap-1">
                              <span
                                className={cn(
                                  'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                                  group.status === 'connected' && 'bg-green-500',
                                  group.status === 'connecting' && 'bg-sky-500 animate-pulse',
                                  group.status === 'degraded' && 'bg-yellow-500',
                                  group.status === 'error' && 'bg-red-500',
                                  group.status === 'disconnected' && 'bg-gray-400',
                                )}
                              />
                              {statusLabel(group.status)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs rounded-full"
                          onClick={() => {
                            const shouldUseGeneratedAccountId = !usesPluginManagedQrAccounts(group.channelType);
                            const nextAccountId = shouldUseGeneratedAccountId
                              ? createNewAccountId(
                                group.channelType,
                                group.accounts.map((item) => item.accountId),
                              )
                              : undefined;
                            setSelectedChannelType(group.channelType as ChannelType);
                            setSelectedAccountId(nextAccountId);
                            setAllowExistingConfigInModal(false);
                            setAllowEditAccountIdInModal(shouldUseGeneratedAccountId);
                            setExistingAccountIdsForModal(group.accounts.map((item) => item.accountId));
                            setInitialConfigValuesForModal(undefined);
                            setShowConfigModal(true);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          {t('account.add')}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget({ channelType: group.channelType })}
                          title={t('account.deleteChannel')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {group.accounts.map((account) => {
                        const displayName =
                          account.accountId === 'default' && account.name === account.accountId
                            ? t('account.mainAccount')
                            : account.name;
                        return (
                        <div key={`${group.channelType}-${account.accountId}`} className="rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-medium text-foreground truncate">{displayName}</p>
                              </div>
                              {account.lastError && (
                                <div className="text-[12px] text-destructive mt-1">{account.lastError}</div>
                              )}
                              {!account.lastError && account.statusReason && account.status === 'degraded' && (
                                <div className="text-[12px] text-yellow-700 dark:text-yellow-300 mt-1">
                                  {t(`health.reasons.${account.statusReason}`)}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{t('account.bindAgentLabel')}</span>
                              <select
                                className="h-8 rounded-lg border border-black/10 dark:border-white/10 bg-background px-2 text-xs"
                                value={account.agentId || ''}
                                onChange={(event) => {
                                  void handleBindAgent(group.channelType, account.accountId, event.target.value);
                                }}
                              >
                                <option value="">{t('account.unassigned')}</option>
                                {visibleAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                              </select>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs rounded-full"
                                  onClick={() => {
                                    void (async () => {
                                      try {
                                        const accountParam = `?accountId=${encodeURIComponent(account.accountId)}`;
                                        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
                                          `/api/channels/config/${encodeURIComponent(group.channelType)}${accountParam}`
                                        );
                                        setInitialConfigValuesForModal(result.success ? (result.values || {}) : undefined);
                                      } catch {
                                        // Fall back to modal-side loading when prefetch fails.
                                        setInitialConfigValuesForModal(undefined);
                                      }
                                      setSelectedChannelType(group.channelType as ChannelType);
                                      setSelectedAccountId(account.accountId);
                                      setAllowExistingConfigInModal(true);
                                      setAllowEditAccountIdInModal(false);
                                      setExistingAccountIdsForModal([]);
                                      setShowConfigModal(true);
                                    })();
                                  }}
                                >
                                {t('account.edit')}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteTarget({ channelType: group.channelType, accountId: account.accountId })}
                                title={t('account.delete')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('supportedChannels')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              {unsupportedGroups.map((type) => {
                const meta = CHANNEL_META[type];
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedChannelType(type);
                      setSelectedAccountId(undefined);
                      setAllowExistingConfigInModal(true);
                      setAllowEditAccountIdInModal(false);
                      setExistingAccountIdsForModal([]);
                      setInitialConfigValuesForModal(undefined);
                      setShowConfigModal(true);
                    }}
                    className={cn(
                      'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <div className="h-[46px] w-[46px] shrink-0 flex items-center justify-center text-foreground bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-full shadow-sm mb-3">
                      <ChannelLogo type={type} />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[16px] font-semibold text-foreground truncate">{meta.name}</h3>
                        {meta.isPlugin && (
                          <Badge variant="secondary" className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(meta.description.replace('channels:', ''))}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showConfigModal && (
        <ChannelConfigModal
          initialSelectedType={selectedChannelType}
          accountId={selectedAccountId}
          configuredTypes={configuredTypes}
          allowExistingConfig={allowExistingConfigInModal}
          allowEditAccountId={allowEditAccountIdInModal}
          existingAccountIds={existingAccountIdsForModal}
          initialConfigValues={initialConfigValuesForModal}
          showChannelName={false}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
          }}
          onChannelSaved={async () => {
            await fetchPageData({ probe: true });
            scheduleConvergenceRefresh();
            setShowConfigModal(false);
            setSelectedChannelType(null);
            setSelectedAccountId(undefined);
            setAllowExistingConfigInModal(true);
            setAllowEditAccountIdInModal(false);
            setExistingAccountIdsForModal([]);
            setInitialConfigValuesForModal(undefined);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common.confirm', 'Confirm')}
        message={deleteTarget?.accountId ? t('account.deleteConfirm') : t('deleteConfirm')}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ChannelLogo({ type }: { type: ChannelType }) {
  switch (type) {
    case 'telegram':
      return <img src={telegramIcon} alt="Telegram" className="w-[22px] h-[22px] dark:invert" />;
    case 'discord':
      return <img src={discordIcon} alt="Discord" className="w-[22px] h-[22px] dark:invert" />;
    case 'whatsapp':
      return <img src={whatsappIcon} alt="WhatsApp" className="w-[22px] h-[22px] dark:invert" />;
    case 'wechat':
      return <img src={wechatIcon} alt="WeChat" className="w-[22px] h-[22px] dark:invert" />;
    case 'dingtalk':
      return <img src={dingtalkIcon} alt="DingTalk" className="w-[22px] h-[22px] dark:invert" />;
    case 'feishu':
      return <img src={feishuIcon} alt="Feishu" className="w-[22px] h-[22px] dark:invert" />;
    case 'wecom':
      return <img src={wecomIcon} alt="WeCom" className="w-[22px] h-[22px] dark:invert" />;
    case 'qqbot':
      return <img src={qqIcon} alt="QQ" className="w-[22px] h-[22px] dark:invert" />;
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '💬'}</span>;
  }
}

export default Channels;
