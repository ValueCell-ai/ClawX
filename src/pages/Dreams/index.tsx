import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BookOpen,
  Clock,
  Eraser,
  ExternalLink,
  Loader2,
  Moon,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';

type DreamPhaseName = 'light' | 'rem' | 'deep';

interface DreamPhase {
  enabled?: boolean;
  cron?: string;
  managedCronPresent?: boolean;
  nextRunAtMs?: number;
}

interface DreamMemoryEntry {
  key?: string;
  path?: string;
  snippet?: string;
  startLine?: number;
  endLine?: number;
  recallCount?: number;
  dailyCount?: number;
  groundedCount?: number;
  totalSignalCount?: number;
  phaseHitCount?: number;
  promotedAt?: string;
  lastRecalledAt?: string;
}

interface DreamingStatus {
  enabled?: boolean;
  timezone?: string;
  verboseLogging?: boolean;
  storageMode?: string;
  separateReports?: boolean;
  shortTermCount?: number;
  recallSignalCount?: number;
  dailySignalCount?: number;
  groundedSignalCount?: number;
  totalSignalCount?: number;
  phaseSignalCount?: number;
  lightPhaseHitCount?: number;
  remPhaseHitCount?: number;
  promotedTotal?: number;
  promotedToday?: number;
  storePath?: string;
  phaseSignalPath?: string;
  storeError?: string;
  phaseSignalError?: string;
  shortTermEntries?: DreamMemoryEntry[];
  promotedEntries?: DreamMemoryEntry[];
  phases?: Partial<Record<DreamPhaseName, DreamPhase>>;
}

interface DreamDiaryResponse {
  path?: string;
  found?: boolean;
  content?: string;
}

interface DreamDiaryEntry {
  id: string;
  date: string;
  summary: string;
}

type DreamActionKey = 'backfill' | 'dedupe' | 'repair' | 'resetDiary' | 'resetGrounded';

interface PendingConfirmation {
  action: DreamActionKey;
  title: string;
  message: string;
  destructive?: boolean;
}

const DREAM_ACTION_METHODS: Record<DreamActionKey, string> = {
  backfill: 'doctor.memory.backfillDreamDiary',
  dedupe: 'doctor.memory.dedupeDreamDiary',
  repair: 'doctor.memory.repairDreamingArtifacts',
  resetDiary: 'doctor.memory.resetDreamDiary',
  resetGrounded: 'doctor.memory.resetGroundedShortTerm',
};

const DIARY_START_MARKER = '<!-- openclaw:dreaming:diary:start -->';
const DIARY_END_MARKER = '<!-- openclaw:dreaming:diary:end -->';
const PANEL_CLASS = 'border-black/10 bg-surface-modal shadow-sm dark:border-white/10';
const INSET_CLASS = 'border-black/10 bg-surface-input dark:border-white/10';
const QUIET_BUTTON_CLASS = 'border-black/10 bg-surface-input text-foreground/80 shadow-none hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/5';
const STATUS_BADGE_CLASS = 'border-black/10 bg-black/5 text-foreground/80 dark:border-white/10 dark:bg-white/10 dark:text-foreground/80';
const SUCCESS_NOTICE_CLASS = 'border-black/10 bg-black/5 text-foreground/80 dark:border-white/10 dark:bg-white/10';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeDreamingStatus(response: unknown): DreamingStatus | null {
  if (!isRecord(response)) return null;
  const dreaming = response.dreaming;
  if (isRecord(dreaming)) return dreaming as DreamingStatus;
  return response as DreamingStatus;
}

function getDiaryBody(content: string): string {
  const start = content.indexOf(DIARY_START_MARKER);
  const end = content.indexOf(DIARY_END_MARKER);
  if (start >= 0 && end > start) {
    return content.slice(start + DIARY_START_MARKER.length, end);
  }
  return content;
}

function parseDreamDiary(content?: string): DreamDiaryEntry[] {
  if (!content?.trim()) return [];

  return getDiaryBody(content)
    .split(/\n\s*---+\s*\n/g)
    .map((block, index) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('#') && !line.startsWith('<!--'))
        .filter((line) => !/^(What Happened|Reflections|Candidates|Possible Lasting Updates)$/i.test(line))
        .map((line) => line.replace(/\[[^\]]+\]/g, '').replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);

      const dateLine = lines.find((line) => /^\*[^*]+\*$/.test(line));
      const date = dateLine?.replace(/^\*/, '').replace(/\*$/, '') || '';
      const summary = lines
        .filter((line) => line !== dateLine)
        .slice(0, 3)
        .join(' ');

      return {
        id: `${date || 'entry'}-${index}`,
        date,
        summary,
      };
    })
    .filter((entry) => entry.summary);
}

function formatDateTime(value?: number | string): string {
  if (value == null || value === '') return '—';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function firstNumber(result: unknown, keys: string[]): number | undefined {
  if (!isRecord(result)) return undefined;
  for (const key of keys) {
    const value = asNumber(result[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function Dreams() {
  const { t } = useTranslation(['dreams', 'common']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const rpc = useGatewayStore((state) => state.rpc);

  const [dreaming, setDreaming] = useState<DreamingStatus | null>(null);
  const [diary, setDiary] = useState<DreamDiaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<DreamActionKey | null>(null);
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [openingFullUi, setOpeningFullUi] = useState(false);

  const gatewayReady = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
  const actionsDisabled = !gatewayReady || runningAction != null;

  const diaryEntries = useMemo(() => parseDreamDiary(diary?.content).slice(0, 4), [diary?.content]);
  const recentSignals = useMemo(() => {
    const shortTerm = dreaming?.shortTermEntries ?? [];
    const promoted = dreaming?.promotedEntries ?? [];
    return [...shortTerm, ...promoted].slice(0, 6);
  }, [dreaming?.promotedEntries, dreaming?.shortTermEntries]);

  const refreshAll = useCallback(async () => {
    if (!gatewayReady) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [statusResponse, diaryResponse] = await Promise.all([
        rpc<unknown>('doctor.memory.status', {}, 12_000),
        rpc<DreamDiaryResponse>('doctor.memory.dreamDiary', {}, 12_000),
      ]);
      setDreaming(normalizeDreamingStatus(statusResponse));
      setDiary(diaryResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [gatewayReady, rpc]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const buildActionMessage = useCallback((action: DreamActionKey, result: unknown): string => {
    if (action === 'backfill') {
      const count = firstNumber(result, ['written', 'created', 'count']);
      return t('actions.backfillSuccess', { count: count ?? 0 });
    }
    if (action === 'dedupe') {
      const removed = firstNumber(result, ['removedEntries', 'removed', 'removedCount', 'duplicatesRemoved']);
      const kept = firstNumber(result, ['keptEntries', 'kept', 'keptCount']);
      return t('actions.dedupeSuccess', { removed: removed ?? 0, kept: kept ?? 0 });
    }
    if (action === 'repair') {
      return t('actions.repairSuccess');
    }
    if (action === 'resetDiary') {
      const count = firstNumber(result, ['removedEntries', 'removed', 'removedCount', 'count']);
      return t('actions.resetDiarySuccess', { count: count ?? 0 });
    }
    const count = firstNumber(result, ['removedShortTermEntries', 'cleared', 'removed', 'count']);
    return t('actions.resetGroundedSuccess', { count: count ?? 0 });
  }, [t]);

  const runAction = useCallback(async (action: DreamActionKey) => {
    setRunningAction(action);
    setError(null);
    setLastActionMessage(null);
    try {
      const result = await rpc<unknown>(DREAM_ACTION_METHODS[action], {}, 120_000);
      const message = buildActionMessage(action, result);
      setLastActionMessage(message);
      toast.success(message);
      await refreshAll();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setRunningAction(null);
      setPendingConfirmation(null);
    }
  }, [buildActionMessage, refreshAll, rpc]);

  const requestConfirmation = useCallback((action: DreamActionKey) => {
    setPendingConfirmation({
      action,
      title: t(`confirmations.${action}.title`),
      message: t(`confirmations.${action}.message`),
      destructive: action === 'resetDiary' || action === 'resetGrounded',
    });
  }, [t]);

  const openFullDreams = useCallback(async () => {
    setOpeningFullUi(true);
    setError(null);
    try {
      const result = await hostApiFetch<{ success: boolean; url?: string; error?: string }>('/api/gateway/control-ui?view=dreams');
      if (result.success && result.url) {
        await window.electron.openExternal(result.url);
      } else {
        throw new Error(result.error || t('errors.openFullUi'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(message);
    } finally {
      setOpeningFullUi(false);
    }
  }, [t]);

  const metrics = [
    { label: t('metrics.shortTerm'), value: dreaming?.shortTermCount ?? 0, icon: Archive },
    { label: t('metrics.grounded'), value: dreaming?.groundedSignalCount ?? 0, icon: Sparkles },
    { label: t('metrics.signals'), value: dreaming?.totalSignalCount ?? 0, icon: Moon },
    { label: t('metrics.promotedToday'), value: dreaming?.promotedToday ?? 0, icon: BookOpen },
  ];

  const phases: Array<{ key: DreamPhaseName; label: string }> = [
    { key: 'light', label: t('phases.light') },
    { key: 'rem', label: t('phases.rem') },
    { key: 'deep', label: t('phases.deep') },
  ];

  return (
    <div data-testid="dreams-page" className="flex h-[calc(100vh-2.5rem)] min-h-0 flex-col overflow-hidden -m-6 bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 px-10 pb-6 pt-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Moon className="h-6 w-6 text-foreground/70" />
            <h1 className="truncate font-serif text-4xl font-normal tracking-tight text-foreground">{t('title')}</h1>
            <Badge
              data-testid="dreams-enabled-badge"
              variant="outline"
              className={cn('shrink-0', STATUS_BADGE_CLASS)}
            >
              {dreaming?.enabled ? t('common:status.enabled') : t('common:status.disabled')}
            </Badge>
          </div>
          <p className="mt-2 text-subtitle font-medium text-foreground/60">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            data-testid="dreams-refresh"
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={loading || !gatewayReady}
            className={QUIET_BUTTON_CLASS}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {t('common:actions.refresh')}
          </Button>
          <Button
            data-testid="dreams-open-full-ui"
            variant="secondary"
            size="sm"
            onClick={() => void openFullDreams()}
            disabled={openingFullUi || !gatewayReady}
            className="border border-black/10 bg-card text-foreground shadow-sm hover:bg-black/5 dark:border-white/10 dark:bg-card dark:hover:bg-white/5"
          >
            {openingFullUi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
            {t('openFullUi')}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-10 pb-10">
        {!gatewayReady && (
          <div className="mb-4 rounded-lg border border-black/10 bg-surface-input px-4 py-3 text-sm text-foreground/70 dark:border-white/10">
            {t('gatewayNotReady')}
          </div>
        )}

        {error && (
          <div data-testid="dreams-error" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {lastActionMessage && (
          <div data-testid="dreams-action-message" className={cn('mb-4 rounded-lg border px-4 py-3 text-sm', SUCCESS_NOTICE_CLASS)}>
            {lastActionMessage}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.label} className={PANEL_CLASS}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-input">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-semibold tabular-nums">{metric.value}</div>
                    <div className="truncate text-xs text-muted-foreground">{metric.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <Card className={PANEL_CLASS}>
            <CardHeader className="flex-row items-center justify-between space-y-0 p-4">
              <div>
                <CardTitle className="text-base">{t('diary.title')}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {diary?.found ? (diary.path || 'DREAMS.md') : t('diary.notFound')}
                </p>
              </div>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              {diaryEntries.length === 0 ? (
                <div data-testid="dreams-empty-diary" className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t('diary.empty')}
                </div>
              ) : (
                diaryEntries.map((entry) => (
                  <article key={entry.id} className={cn('rounded-md border p-3', INSET_CLASS)}>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{entry.date || t('diary.undated')}</span>
                    </div>
                    <p className="text-sm leading-6">{entry.summary}</p>
                  </article>
                ))
              )}
            </CardContent>
          </Card>

          <Card className={PANEL_CLASS}>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('actions.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  data-testid="dreams-action-backfill"
                  variant="outline"
                  className={cn('justify-start', QUIET_BUTTON_CLASS)}
                  onClick={() => void runAction('backfill')}
                  disabled={actionsDisabled}
                >
                  {runningAction === 'backfill' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}
                  {t('actions.backfill')}
                </Button>
                <Button
                  data-testid="dreams-action-dedupe"
                  variant="outline"
                  className={cn('justify-start', QUIET_BUTTON_CLASS)}
                  onClick={() => requestConfirmation('dedupe')}
                  disabled={actionsDisabled}
                >
                  <Eraser className="mr-2 h-4 w-4" />
                  {t('actions.dedupe')}
                </Button>
                <Button
                  data-testid="dreams-action-repair"
                  variant="outline"
                  className={cn('justify-start', QUIET_BUTTON_CLASS)}
                  onClick={() => requestConfirmation('repair')}
                  disabled={actionsDisabled}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  {t('actions.repair')}
                </Button>
                <Button
                  data-testid="dreams-action-reset-grounded"
                  variant="outline"
                  className={cn('justify-start', QUIET_BUTTON_CLASS)}
                  onClick={() => requestConfirmation('resetGrounded')}
                  disabled={actionsDisabled}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('actions.resetGrounded')}
                </Button>
              </div>
              <Button
                data-testid="dreams-action-reset-diary"
                variant="outline"
                className="w-full justify-start border-destructive/30 bg-destructive/5 text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive dark:border-destructive/40"
                onClick={() => requestConfirmation('resetDiary')}
                disabled={actionsDisabled}
              >
                <Archive className="mr-2 h-4 w-4" />
                {t('actions.resetDiary')}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
          <Card className={PANEL_CLASS}>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('phases.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {phases.map((phase) => {
                const value = dreaming?.phases?.[phase.key];
                return (
                  <div key={phase.key} className={cn('flex items-center justify-between gap-3 rounded-md border px-3 py-2', INSET_CLASS)}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{phase.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{value?.cron || t('phases.noSchedule')}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge variant="outline" className={STATUS_BADGE_CLASS}>
                        {value?.enabled ? t('common:status.enabled') : t('common:status.disabled')}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(value?.nextRunAtMs)}</div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className={PANEL_CLASS}>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('signals.title')}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {dreaming?.storageMode ? t('signals.storageMode', { mode: dreaming.storageMode }) : t('signals.noStorageMode')}
                {dreaming?.timezone ? ` · ${dreaming.timezone}` : ''}
              </p>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {(dreaming?.storeError || dreaming?.phaseSignalError) && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {dreaming.storeError || dreaming.phaseSignalError}
                </div>
              )}
              {recentSignals.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t('signals.empty')}
                </div>
              ) : (
                recentSignals.map((entry, index) => (
                  <div key={`${entry.key || entry.path || 'signal'}-${index}`} className={cn('rounded-md border p-3', INSET_CLASS)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-xs text-muted-foreground">
                        {entry.path || entry.key || t('signals.unknownSource')}
                        {entry.startLine ? `:${entry.startLine}` : ''}
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {entry.totalSignalCount ?? entry.phaseHitCount ?? 0}
                      </Badge>
                    </div>
                    <p className={cn('mt-1 line-clamp-2 text-sm leading-6', !entry.snippet && 'text-muted-foreground')}>
                      {entry.snippet || t('signals.noSnippet')}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <ConfirmDialog
        open={pendingConfirmation != null}
        title={pendingConfirmation?.title || ''}
        message={pendingConfirmation?.message || ''}
        confirmLabel={t('common:actions.confirm')}
        cancelLabel={t('common:actions.cancel')}
        variant={pendingConfirmation?.destructive ? 'destructive' : 'default'}
        onConfirm={() => {
          if (pendingConfirmation) void runAction(pendingConfirmation.action);
        }}
        onCancel={() => setPendingConfirmation(null)}
      />
    </div>
  );
}
