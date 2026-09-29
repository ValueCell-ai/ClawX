import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, MessageSquare, Mic, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { hostApi } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { ImageGenerationSettings } from '@/components/settings/ImageGenerationSettings';
import { AsrSettings } from '@/components/settings/AsrSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageWindow,
} from './usage-history';
const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 2;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 3;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;
const USAGE_AUTO_REFRESH_INTERVAL_MS = 15_000;

const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];

type ModelsManagementTab = 'chat' | 'image-generation' | 'voice';

function getModelsManagementTab(tab: string | null, devModeUnlocked: boolean): ModelsManagementTab {
  if (tab === 'voice' || tab === 'image-generation') {
    return devModeUnlocked ? tab : 'chat';
  }
  return 'chat';
}

function isHiddenUsageSource(source?: string): boolean {
  if (!source) return false;
  const normalizedSource = source.trim().toLowerCase();
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}

export function Models() {
  const { t } = useTranslation(['dashboard', 'settings']);
  const [searchParams, setSearchParams] = useSearchParams();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const requestedManagementTab = getModelsManagementTab(searchParams.get('tab'), devModeUnlocked);
  const [selectedManagementTab, setSelectedManagementTab] = useState(requestedManagementTab);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts =
    window.electron.platform === 'win32' ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('model');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usagePage, setUsagePage] = useState(1);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const [usageRefreshNonce, setUsageRefreshNonce] = useState(0);
  function formatUsageSource(source?: string): string | undefined {
    if (!source) return undefined;

    if (isHiddenUsageSource(source)) {
      return undefined;
    }

    return source;
  }

  function shouldHideUsageEntry(entry: UsageHistoryEntry): boolean {
    return isHiddenUsageSource(entry.provider) || isHiddenUsageSource(entry.model);
  }

  type FetchState = {
    status: 'idle' | 'loading' | 'done';
    data: UsageHistoryEntry[];
    stableData: UsageHistoryEntry[];
  };
  type FetchAction =
    | { type: 'start' }
    | { type: 'done'; data: UsageHistoryEntry[] }
    | { type: 'failed' }
    | { type: 'reset' };

  const [fetchState, dispatchFetch] = useReducer(
    (state: FetchState, action: FetchAction): FetchState => {
      switch (action.type) {
        case 'start':
          return { ...state, status: 'loading' };
        case 'done':
          return {
            status: 'done',
            data: action.data,
            stableData: resolveStableUsageHistory(state.stableData, action.data),
          };
        case 'failed':
          return { ...state, status: 'done' };
        case 'reset':
          return { status: 'idle', data: [], stableData: [] };
        default:
          return state;
      }
    },
    { status: 'idle' as const, data: [] as UsageHistoryEntry[], stableData: [] as UsageHistoryEntry[] },
  );

  const usageFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usageFetchGenerationRef = useRef(0);
  const usageFetchStatusRef = useRef<FetchState['status']>('idle');

  useEffect(() => {
    usageFetchStatusRef.current = fetchState.status;
  }, [fetchState.status]);

  useEffect(() => {
    trackUiEvent('models.page_viewed');
  }, []);

  useEffect(() => {
    setSelectedManagementTab(requestedManagementTab);
  }, [requestedManagementTab]);

  useEffect(() => {
    if (!isGatewayRunning) {
      return;
    }

    const requestRefresh = () => {
      if (usageFetchStatusRef.current === 'loading') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setUsageRefreshNonce((value) => value + 1);
    };

    const intervalId = window.setInterval(requestRefresh, USAGE_AUTO_REFRESH_INTERVAL_MS);
    const handleFocus = () => {
      requestRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestRefresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isGatewayRunning]);

  useEffect(() => {
    if (usageFetchTimerRef.current) {
      clearTimeout(usageFetchTimerRef.current);
      usageFetchTimerRef.current = null;
    }

    if (!isGatewayRunning) {
      dispatchFetch({ type: 'reset' });
      return;
    }

    dispatchFetch({ type: 'start' });
    const generation = usageFetchGenerationRef.current + 1;
    usageFetchGenerationRef.current = generation;
    const restartMarker = `${gatewayStatus.pid ?? 'na'}:${gatewayStatus.connectedAt ?? 'na'}`;
    trackUiEvent('models.token_usage_fetch_started', {
      generation,
      restartMarker,
    });

    // Safety timeout: if the fetch cycle hasn't resolved after 30 s,
    // force-resolve to "done" with empty data to avoid an infinite spinner.
    const safetyTimeout = setTimeout(() => {
      if (usageFetchGenerationRef.current !== generation) return;
      trackUiEvent('models.token_usage_fetch_safety_timeout', {
        generation,
        restartMarker,
      });
      dispatchFetch({ type: 'failed' });
    }, 30_000);

    const fetchUsageHistoryWithRetry = async (attempt: number) => {
      trackUiEvent('models.token_usage_fetch_attempt', {
        generation,
        attempt,
        restartMarker,
      });
      try {
        const entries = await hostApi.usage.recentTokenHistory();
        if (usageFetchGenerationRef.current !== generation) return;

        const normalized = Array.isArray(entries) ? entries : [];
        setUsagePage(1);
        trackUiEvent('models.token_usage_fetch_succeeded', {
          generation,
          attempt,
          records: normalized.length,
          restartMarker,
        });

        if (normalized.length === 0 && attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'empty',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
        } else {
          if (normalized.length === 0) {
            trackUiEvent('models.token_usage_fetch_exhausted', {
              generation,
              attempt,
              reason: 'empty',
              restartMarker,
            });
          }
          dispatchFetch({ type: 'done', data: normalized });
        }
      } catch (error) {
        if (usageFetchGenerationRef.current !== generation) return;
        trackUiEvent('models.token_usage_fetch_failed_attempt', {
          generation,
          attempt,
          restartMarker,
          message: error instanceof Error ? error.message : String(error),
        });
        if (attempt < usageFetchMaxAttempts) {
          trackUiEvent('models.token_usage_fetch_retry_scheduled', {
            generation,
            attempt,
            reason: 'error',
            restartMarker,
          });
          usageFetchTimerRef.current = setTimeout(() => {
            void fetchUsageHistoryWithRetry(attempt + 1);
          }, USAGE_FETCH_RETRY_DELAY_MS);
          return;
        }
        dispatchFetch({ type: 'failed' });
        trackUiEvent('models.token_usage_fetch_exhausted', {
          generation,
          attempt,
          reason: 'error',
          restartMarker,
        });
      }
    };

    void fetchUsageHistoryWithRetry(1);

    return () => {
      clearTimeout(safetyTimeout);
      if (usageFetchTimerRef.current) {
        clearTimeout(usageFetchTimerRef.current);
        usageFetchTimerRef.current = null;
      }
    };
  }, [isGatewayRunning, gatewayStatus.connectedAt, gatewayStatus.pid, usageFetchMaxAttempts, usageRefreshNonce]);

  const usageHistory = isGatewayRunning ? fetchState.data.filter((entry) => !shouldHideUsageEntry(entry)) : [];
  const stableUsageHistory = isGatewayRunning
    ? fetchState.stableData.filter((entry) => !shouldHideUsageEntry(entry))
    : [];
  const visibleUsageHistory = resolveVisibleUsageHistory(usageHistory, stableUsageHistory, {
    preferStableOnEmpty: isGatewayRunning && fetchState.status === 'loading',
  });
  const filteredUsageHistory = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow);
  const usageGroups = groupUsageHistory(filteredUsageHistory, usageGroupBy);
  const usagePageSize = 5;
  const usageTotalPages = Math.max(1, Math.ceil(filteredUsageHistory.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = filteredUsageHistory.slice(
    (safeUsagePage - 1) * usagePageSize,
    safeUsagePage * usagePageSize,
  );
  const usageLoading = isGatewayRunning && fetchState.status === 'loading' && visibleUsageHistory.length === 0;

  return (
    <div
      data-testid="models-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden"
    >
      <div className="w-full max-w-6xl mx-auto flex flex-col h-full p-6 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1
              data-testid="models-page-title"
              className="text-2xl font-sans text-foreground mb-1 font-medium tracking-normal"
            >
              {t('dashboard:models.title')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('dashboard:models.subtitle')}</p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 min-h-0 -mr-2 space-y-8">
          <Tabs
            value={selectedManagementTab}
            onValueChange={(value) => {
              const nextTab = getModelsManagementTab(value, devModeUnlocked);
              setSelectedManagementTab(nextTab);
              const nextSearchParams = new URLSearchParams(searchParams);
              if (nextTab === 'chat') {
                nextSearchParams.delete('tab');
              } else {
                nextSearchParams.set('tab', nextTab);
              }
              setSearchParams(nextSearchParams);
            }}
            data-testid="models-management-tabs"
          >
            <TabsList className="bg-transparent p-0 gap-1">
              <TabsTrigger className="rounded-lg px-4 data-[state=active]:bg-black/5 dark:data-[state=active]:bg-white/10 data-[state=active]:shadow-none" value="chat" data-testid="models-tab-chat">
                <MessageSquare aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.chat')}
              </TabsTrigger>
              {devModeUnlocked && (
                <>
                  <TabsTrigger className="rounded-lg px-4 data-[state=active]:bg-black/5 dark:data-[state=active]:bg-white/10 data-[state=active]:shadow-none" value="voice" data-testid="models-tab-voice">
                    <Mic aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.voice')}
                  </TabsTrigger>
                  <TabsTrigger className="rounded-lg px-4 data-[state=active]:bg-black/5 dark:data-[state=active]:bg-white/10 data-[state=active]:shadow-none" value="image-generation" data-testid="models-tab-image-generation">
                    <ImagePlus aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.imageGeneration')}
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            <TabsContent value="chat" className="mt-5">
              <ProvidersSettings />
            </TabsContent>
            {devModeUnlocked && (
              <>
                <TabsContent value="voice" className="mt-5">
                  <AsrSettings />
                </TabsContent>
                <TabsContent value="image-generation" className="mt-5">
                  <ImageGenerationSettings />
                </TabsContent>
              </>
            )}
          </Tabs>

          {(!devModeUnlocked || selectedManagementTab === 'chat') && <div>
            <h2 className="text-lg font-sans text-foreground mb-4 font-medium tracking-normal">
              {t('dashboard:recentTokenHistory.title', 'Token Usage History')}
            </h2>
            <div>
              {usageLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 border-dashed">
                  <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
                </div>
              ) : visibleUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 border-dashed">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.empty')} />
                </div>
              ) : filteredUsageHistory.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-xl border border-black/10 dark:border-white/10 border-dashed">
                  <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForWindow')} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex gap-1 rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button
                          variant={usageGroupBy === 'model' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('model');
                            setUsagePage(1);
                          }}
                          className={
                            usageGroupBy === 'model'
                              ? 'rounded-lg bg-black/5 dark:bg-white/10 text-foreground'
                              : 'rounded-lg text-muted-foreground'
                          }
                        >
                          {t('dashboard:recentTokenHistory.groupByModel')}
                        </Button>
                        <Button
                          variant={usageGroupBy === 'day' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageGroupBy('day');
                            setUsagePage(1);
                          }}
                          className={
                            usageGroupBy === 'day'
                              ? 'rounded-lg bg-black/5 dark:bg-white/10 text-foreground'
                              : 'rounded-lg text-muted-foreground'
                          }
                        >
                          {t('dashboard:recentTokenHistory.groupByTime')}
                        </Button>
                      </div>
                      <div className="flex gap-1 rounded-xl bg-transparent p-1 border border-black/10 dark:border-white/10">
                        <Button
                          variant={usageWindow === '7d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('7d');
                            setUsagePage(1);
                          }}
                          className={
                            usageWindow === '7d'
                              ? 'rounded-lg bg-black/5 dark:bg-white/10 text-foreground'
                              : 'rounded-lg text-muted-foreground'
                          }
                        >
                          {t('dashboard:recentTokenHistory.last7Days')}
                        </Button>
                        <Button
                          variant={usageWindow === '30d' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('30d');
                            setUsagePage(1);
                          }}
                          className={
                            usageWindow === '30d'
                              ? 'rounded-lg bg-black/5 dark:bg-white/10 text-foreground'
                              : 'rounded-lg text-muted-foreground'
                          }
                        >
                          {t('dashboard:recentTokenHistory.last30Days')}
                        </Button>
                        <Button
                          variant={usageWindow === 'all' ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            setUsageWindow('all');
                            setUsagePage(1);
                          }}
                          className={
                            usageWindow === 'all'
                              ? 'rounded-lg bg-black/5 dark:bg-white/10 text-foreground'
                              : 'rounded-lg text-muted-foreground'
                          }
                        >
                          {t('dashboard:recentTokenHistory.allTime')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-meta font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.showingLast', { count: filteredUsageHistory.length })}
                    </p>
                  </div>

                  <UsageBarChart
                    groups={usageGroups}
                    emptyLabel={t('dashboard:recentTokenHistory.empty')}
                    totalLabel={t('dashboard:recentTokenHistory.totalTokens')}
                    inputLabel={t('dashboard:recentTokenHistory.inputShort')}
                    outputLabel={t('dashboard:recentTokenHistory.outputShort')}
                    cacheLabel={t('dashboard:recentTokenHistory.cacheShort')}
                  />

                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
                    <table data-testid="token-usage-table" className="w-full min-w-[760px] text-sm" aria-label={t('dashboard:recentTokenHistory.title')}>
                      <thead className="bg-black/[0.025] dark:bg-white/5 text-xs text-muted-foreground">
                        <tr>
                          {['model', 'time', 'input', 'output', 'cacheRead', 'cacheWrite', 'total', 'cost', ...(devModeUnlocked ? ['actions'] : [])].map((column) => (
                            <th key={column} scope="col" className={`px-3 py-2.5 font-medium whitespace-nowrap ${column === 'model' || column === 'time' ? 'text-left' : 'text-right'}`}>
                              {t(`dashboard:recentTokenHistory.columns.${column}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 dark:divide-white/10">
                        {pagedUsageHistory.map((entry) => {
                          const hasUsage = !entry.usageStatus || entry.usageStatus === 'available';
                          const statusLabel = entry.usageStatus === 'error'
                            ? t('dashboard:recentTokenHistory.usageParseError')
                            : entry.usageStatus === 'missing' ? t('dashboard:recentTokenHistory.noUsage') : undefined;
                          return (
                            <tr key={`${entry.sessionId}-${entry.timestamp}`} data-testid="token-usage-entry" className="hover:bg-black/[0.025] dark:hover:bg-white/5">
                              <td className="px-3 py-2.5 max-w-[240px]">
                                <p className="truncate font-medium" title={entry.model}>{entry.model || t('dashboard:recentTokenHistory.unknownModel')}</p>
                                <p className="truncate text-xs text-muted-foreground mt-0.5" title={entry.sessionId}>
                                  {[formatUsageSource(entry.provider), formatUsageSource(entry.agentId)].filter(Boolean).join(' · ')}
                                </p>
                                <span className="sr-only">{entry.sessionId}</span>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatUsageTimestamp(entry.timestamp)}</td>
                              {[entry.inputTokens, entry.outputTokens, entry.cacheReadTokens, entry.cacheWriteTokens].map((value, index) => (
                                <td key={index} className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{hasUsage ? formatTokenCount(value) : '—'}</td>
                              ))}
                              <td className="px-3 py-2.5 text-right tabular-nums" title={statusLabel}>
                                <span className={getUsageTotalClass(entry)}>{formatUsageTotal(entry)}</span>
                                {statusLabel && <span className="sr-only">{statusLabel}</span>}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                                {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? `$${entry.costUsd.toFixed(4)}` : '—'}
                              </td>
                              {devModeUnlocked && <td className="px-3 py-2.5 text-right">
                                {entry.content && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground whitespace-nowrap" onClick={() => setSelectedUsageEntry(entry)}>
                                  {t('dashboard:recentTokenHistory.viewContent')}
                                </Button>}
                              </td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <p className="text-meta font-medium text-muted-foreground">
                      {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.max(1, page - 1))}
                        disabled={safeUsagePage <= 1}
                        className="rounded-md px-3 h-8 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        {t('dashboard:recentTokenHistory.prev')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUsagePage((page) => Math.min(usageTotalPages, page + 1))}
                        disabled={safeUsagePage >= usageTotalPages}
                        className="rounded-md px-3 h-8 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        {t('dashboard:recentTokenHistory.next')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>}
        </div>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          onClose={() => setSelectedUsageEntry(null)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
        />
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  return Intl.NumberFormat().format(value);
}

function getUsageTotalClass(entry: UsageHistoryEntry): string {
  if (entry.usageStatus === 'error') return 'font-medium text-sm text-red-700 dark:text-red-400';
  if (entry.usageStatus === 'missing') return 'font-medium text-sm text-muted-foreground';
  return 'font-medium text-sm';
}

function formatUsageTotal(entry: UsageHistoryEntry): string {
  if (entry.usageStatus === 'error') return '✕';
  if (entry.usageStatus === 'missing') return '—';
  return formatTokenCount(entry.totalTokens);
}

function formatUsageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function UsageBarChart({
  groups,
  emptyLabel,
  totalLabel,
  inputLabel,
  outputLabel,
  cacheLabel,
}: {
  groups: Array<{
    label: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }>;
  emptyLabel: string;
  totalLabel: string;
  inputLabel: string;
  outputLabel: string;
  cacheLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 p-8 text-center text-sm font-medium text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const maxTokens = Math.max(...groups.map((group) => group.totalTokens), 1);

  return (
    <div className="space-y-3 bg-transparent p-4 rounded-xl border border-black/10 dark:border-white/10">
      <div className="flex flex-wrap gap-4 text-meta font-medium text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-usage-input" />
          {inputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-usage-output" />
          {outputLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-usage-cache" />
          {cacheLabel}
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-semibold text-foreground">{group.label}</span>
            <span className="text-muted-foreground font-medium">
              {totalLabel}: {formatTokenCount(group.totalTokens)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
            <div
              className="flex h-full overflow-hidden rounded-full"
              style={{
                width: group.totalTokens > 0 ? `${Math.max((group.totalTokens / maxTokens) * 100, 6)}%` : '0%',
              }}
            >
              {group.inputTokens > 0 && (
                <div
                  className="h-full bg-usage-input"
                  style={{ width: `${(group.inputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.outputTokens > 0 && (
                <div
                  className="h-full bg-usage-output"
                  style={{ width: `${(group.outputTokens / group.totalTokens) * 100}%` }}
                />
              )}
              {group.cacheTokens > 0 && (
                <div
                  className="h-full bg-usage-cache"
                  style={{ width: `${(group.cacheTokens / group.totalTokens) * 100}%` }}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Models;

function UsageContentPopup({
  entry,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
}: {
  entry: UsageHistoryEntry;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 dark:border-white/10 bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-black/10 dark:border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {entry.model || unknownModelLabel} • {formatUsageTimestamp(entry.timestamp)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-mono">{entry.content}</pre>
        </div>
        <div className="flex justify-end border-t border-black/10 dark:border-white/10 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
