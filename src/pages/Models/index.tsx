import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MessageSquare, Mic, ImagePlus, ChartColumn } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { hostApi } from '@/lib/host-api';
import { trackUiEvent } from '@/lib/telemetry';
import { ProvidersSettings } from '@/components/settings/ProvidersSettings';
import { ImageGenerationSettings } from '@/components/settings/ImageGenerationSettings';
import { AsrSettings } from '@/components/settings/AsrSettings';
import { FeedbackState } from '@/components/common/FeedbackState';
import { ModelPicker } from '@/components/common/ModelPicker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createUsageMillionsFormatter,
  filterUsageHistoryByWindow,
  groupUsageByModel,
  isHiddenUsageSource,
  usageModelKey,
  formatUsageTimestamp,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageGroupBy,
  type UsageHistoryEntry,
  type UsageModel,
  type UsageWindow,
} from './usage-history';
import { UsageChart, UsageChoice } from './UsageChart';
import { UsageTable } from './UsageTable';

const DEFAULT_USAGE_FETCH_MAX_ATTEMPTS = 2;
const WINDOWS_USAGE_FETCH_MAX_ATTEMPTS = 3;
const USAGE_FETCH_RETRY_DELAY_MS = 1500;
const USAGE_AUTO_REFRESH_INTERVAL_MS = 15_000;

type ModelsManagementTab = 'chat' | 'image-generation' | 'voice' | 'usage';

function getModelsManagementTab(tab: string | null, devModeUnlocked: boolean): ModelsManagementTab {
  if (tab === 'usage') return 'usage';
  if (tab === 'voice' || tab === 'image-generation') {
    return devModeUnlocked ? tab : 'chat';
  }
  return 'chat';
}

export function Models({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation(['dashboard', 'settings']);
  const usageLocale = i18n?.resolvedLanguage ?? i18n?.language;
  const [searchParams, setSearchParams] = useSearchParams();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const requestedManagementTab = getModelsManagementTab(searchParams.get('tab'), devModeUnlocked);
  const [selectedManagementTab, setSelectedManagementTab] = useState(requestedManagementTab);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const usageFetchMaxAttempts =
    window.electron.platform === 'win32' ? WINDOWS_USAGE_FETCH_MAX_ATTEMPTS : DEFAULT_USAGE_FETCH_MAX_ATTEMPTS;

  const [usageGroupBy, setUsageGroupBy] = useState<UsageGroupBy>('day');
  const [usageWindow, setUsageWindow] = useState<UsageWindow>('7d');
  const [usageNow, setUsageNow] = useState(Date.now);
  const [usagePage, setUsagePage] = useState(1);
  const [usageModel, setUsageModel] = useState<UsageModel | null>(null);
  const [selectedUsageEntry, setSelectedUsageEntry] = useState<UsageHistoryEntry | null>(null);
  const [usageContentOpen, setUsageContentOpen] = useState(false);
  const usageTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [usageRefreshNonce, setUsageRefreshNonce] = useState(0);

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
          setUsageNow(Date.now());
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

  const usageHistory = resolveVisibleUsageHistory(fetchState.data, fetchState.stableData, {
    preferStableOnEmpty: fetchState.status === 'loading',
  });
  const visibleUsageHistory = useMemo(() => isGatewayRunning
    ? usageHistory.filter((entry) => !isHiddenUsageSource(entry.provider) && !isHiddenUsageSource(entry.model))
    : [], [isGatewayRunning, usageHistory]);
  const selectedModelKey = usageModel ? usageModelKey(usageModel) : null;
  const usageModelOptions = useMemo(() => {
    const groups = groupUsageByModel(visibleUsageHistory);
    const models: UsageModel[] = [...groups];
    if (usageModel && !groups.some((group) => group.key === selectedModelKey)) models.push(usageModel);

    return models
      .sort((a, b) => (a.provider ?? '').localeCompare(b.provider ?? '', usageLocale) || (a.model ?? '').localeCompare(b.model ?? '', usageLocale))
      .map((item) => {
        const modelId = item.model || t('dashboard:recentTokenHistory.unknownModel');
        const providerName = item.provider || t('dashboard:recentTokenHistory.unknownProvider');
        return {
          modelRef: usageModelKey(item),
          modelId,
          providerName,
          runtimeProviderKey: item.provider ?? '',
          label: `${modelId} (${providerName})`,
          source: { model: item.model, provider: item.provider },
        };
      });
  }, [selectedModelKey, t, usageLocale, usageModel, visibleUsageHistory]);
  const selectedUsageModel = usageModelOptions.find((item) => item.modelRef === selectedModelKey);
  const allModelsLabel = t('dashboard:recentTokenHistory.allModels');
  const recentUsage = filterUsageHistoryByWindow(visibleUsageHistory, usageWindow, usageNow);
  const usageDetails = selectedModelKey ? recentUsage.filter((entry) => usageModelKey(entry) === selectedModelKey) : recentUsage;
  const usageTotals = recentUsage.reduce((total, entry) => ({
    total: total.total + entry.totalTokens,
    input: total.input + entry.inputTokens,
    output: total.output + entry.outputTokens,
    cache: total.cache + entry.cacheReadTokens + entry.cacheWriteTokens,
  }), { total: 0, input: 0, output: 0, cache: 0 });
  const usagePageSize = 10;
  const usageTotalPages = Math.max(1, Math.ceil(usageDetails.length / usagePageSize));
  const safeUsagePage = Math.min(usagePage, usageTotalPages);
  const pagedUsageHistory = usageDetails.slice((safeUsagePage - 1) * usagePageSize, safeUsagePage * usagePageSize);
  const usageLoading = isGatewayRunning && fetchState.status === 'loading' && visibleUsageHistory.length === 0;
  const usageEmpty = recentUsage.length === 0;
  const usageNumber = new Intl.NumberFormat(usageLocale);
  const formatUsageMillions = createUsageMillionsFormatter(usageLocale);
  const widerUsageWindow = usageWindow === '7d' && filterUsageHistoryByWindow(visibleUsageHistory, '30d', usageNow).length > 0
    ? '30d' : 'all';

  function changeUsageWindow(value: UsageWindow) {
    setUsageNow(Date.now());
    setUsageWindow(value);
    setUsagePage(1);
  }

  return (
    <div
      data-testid="models-page"
      className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden" : "flex flex-col -m-6 dark:bg-background h-[calc(100%+3rem)] overflow-hidden"}
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

        {/* Keep absolutely positioned screen-reader text inside the tab scroller. */}
        <div data-testid="models-content-scroll" className="relative -mr-2 min-h-0 flex-1 space-y-8 overflow-y-auto pr-2">
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
            <TabsList variant="page">
              <TabsTrigger variant="page" value="chat" data-testid="models-tab-chat">
                <MessageSquare aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.chat')}
              </TabsTrigger>
              {devModeUnlocked && (
                <>
                  <TabsTrigger variant="page" value="voice" data-testid="models-tab-voice">
                    <Mic aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.voice')}
                  </TabsTrigger>
                  <TabsTrigger variant="page" value="image-generation" data-testid="models-tab-image-generation">
                    <ImagePlus aria-hidden="true" className="mr-2 h-4 w-4" />
                {t('dashboard:models.tabs.imageGeneration')}
                  </TabsTrigger>
                </>
              )}
              <TabsTrigger variant="page" value="usage" data-testid="models-tab-usage"><ChartColumn aria-hidden="true" className="mr-2 h-4 w-4" />{t('dashboard:models.tabs.usage')}</TabsTrigger>
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
            <TabsContent value="usage" className="mt-5">
              <div data-testid="models-usage-panel" className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <UsageChoice
                    label={t('dashboard:recentTokenHistory.timeRange')}
                    value={usageWindow}
                    choices={[
                      ['7d', t('dashboard:recentTokenHistory.last7Days')],
                      ['30d', t('dashboard:recentTokenHistory.last30Days')],
                      ['all', t('dashboard:recentTokenHistory.allTime')],
                    ]}
                    onChange={changeUsageWindow}
                  />
                  {!usageEmpty && (
                    <div data-testid="usage-summary" className="ml-auto flex flex-wrap justify-end gap-x-4 gap-y-2 text-sm">
                      {([['totalTokens', usageTotals.total], ['inputShort', usageTotals.input], ['outputShort', usageTotals.output], ['cacheShort', usageTotals.cache]] as const).map(([label, value]) => (
                        <div key={label} className="flex items-baseline gap-2 whitespace-nowrap">
                          <span className="text-meta text-muted-foreground">{t(`dashboard:recentTokenHistory.${label}`)}</span>
                          <span className="font-medium tabular-nums" title={usageNumber.format(value)}>{formatUsageMillions(value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {usageLoading ? (
                  <FeedbackState state="loading" title={t('dashboard:recentTokenHistory.loading')} />
                ) : usageEmpty ? (
                  <FeedbackState
                    state="empty"
                    title={t(visibleUsageHistory.length > 0 ? 'dashboard:recentTokenHistory.emptyForWindow' : 'dashboard:recentTokenHistory.empty')}
                    action={visibleUsageHistory.length > 0 && usageWindow !== 'all' ? (
                      <Button variant="outline" size="sm" onClick={() => changeUsageWindow(widerUsageWindow)}>
                        {t(widerUsageWindow === '30d' ? 'dashboard:recentTokenHistory.viewLast30Days' : 'dashboard:recentTokenHistory.viewAllTime')}
                      </Button>
                    ) : undefined}
                  />
                ) : (
                  <>
                    <UsageChart entries={recentUsage} window={usageWindow} now={usageNow} groupBy={usageGroupBy} onGroupChange={setUsageGroupBy} />

                    <section className="space-y-3 pt-2" aria-labelledby="usage-details-title">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h2 id="usage-details-title" className="text-base font-medium">{t('dashboard:recentTokenHistory.details')}</h2>
                          <span className="text-meta text-muted-foreground">
                            {t('dashboard:recentTokenHistory.showingLast', { count: usageDetails.length })}
                          </span>
                        </div>
                        <ModelPicker
                          options={usageModelOptions}
                          value={selectedModelKey}
                          label={selectedUsageModel?.modelId ?? allModelsLabel}
                          title={t('dashboard:recentTokenHistory.columns.model')}
                          providerLabel={selectedUsageModel?.providerName}
                          allModelsLabel={allModelsLabel}
                          hideIcon={!selectedUsageModel}
                          side="bottom"
                          testIdPrefix="usage-model-filter"
                          onValueChange={(key) => {
                            if (key === (selectedModelKey ?? '')) return;
                            setUsageModel(usageModelOptions.find((item) => item.modelRef === key)?.source ?? null);
                            setUsagePage(1);
                          }}
                        />
                      </div>
                      {usageDetails.length > 0 ? (
                        <>
                          <UsageTable
                            entries={pagedUsageHistory}
                            showContent={devModeUnlocked}
                            onViewContent={(entry, trigger) => {
                              usageTriggerRef.current = trigger;
                              setSelectedUsageEntry(entry);
                              setUsageContentOpen(true);
                            }}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-meta text-muted-foreground">
                              {t('dashboard:recentTokenHistory.page', { current: safeUsagePage, total: usageTotalPages })}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant="outline" size="sm"
                                onClick={() => setUsagePage(safeUsagePage - 1)}
                                disabled={safeUsagePage <= 1}
                              >
                                <ChevronLeft aria-hidden="true" className="mr-1 size-4" />
                                {t('dashboard:recentTokenHistory.prev')}
                              </Button>
                              <Button
                                variant="outline" size="sm"
                                onClick={() => setUsagePage(safeUsagePage + 1)}
                                disabled={safeUsagePage >= usageTotalPages}
                              >
                                {t('dashboard:recentTokenHistory.next')}
                                <ChevronRight aria-hidden="true" className="ml-1 size-4" />
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : <FeedbackState state="empty" title={t('dashboard:recentTokenHistory.emptyForModel')} />}
                    </section>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      {devModeUnlocked && selectedUsageEntry && (
        <UsageContentPopup
          entry={selectedUsageEntry}
          open={usageContentOpen}
          onReturnFocus={() => { if (usageTriggerRef.current?.isConnected) usageTriggerRef.current.focus(); }}
          onClose={() => setUsageContentOpen(false)}
          title={t('dashboard:recentTokenHistory.contentDialogTitle')}
          closeLabel={t('dashboard:recentTokenHistory.close')}
          unknownModelLabel={t('dashboard:recentTokenHistory.unknownModel')}
          locale={usageLocale}
        />
      )}
    </div>
  );
}

export default Models;

function UsageContentPopup({
  entry,
  open,
  onReturnFocus,
  onClose,
  title,
  closeLabel,
  unknownModelLabel,
  locale,
}: {
  entry: UsageHistoryEntry;
  open: boolean;
  onReturnFocus: () => void;
  onClose: () => void;
  title: string;
  closeLabel: string;
  unknownModelLabel: string;
  locale?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }} data-testid="usage-content-dialog" className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl bg-surface-modal p-0">
        <div className="px-5 pb-4 pt-5">
          <DialogTitle className="font-sans text-lg font-medium tracking-normal">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-meta">{entry.model || unknownModelLabel} · {formatUsageTimestamp(entry.timestamp, locale)}</DialogDescription>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-5"><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">{entry.content}</pre></div>
        <div className="flex justify-end border-t border-border px-5 py-3"><Button variant="outline" className="h-9" onClick={onClose}>{closeLabel}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
