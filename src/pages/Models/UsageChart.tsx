import { useTranslation } from 'react-i18next';
import { ModelIcon } from '@/components/common/ModelIcon';
import { Button } from '@/components/ui/button';
import { groupUsageByModel, groupUsageByTime, type UsageGroupBy, type UsageHistoryEntry, type UsageWindow } from './usage-history';

const series = [
  { field: 'inputTokens', label: 'inputShort', color: 'bg-usage-input' },
  { field: 'outputTokens', label: 'outputShort', color: 'bg-usage-output' },
  { field: 'cacheTokens', label: 'cacheShort', color: 'bg-usage-cache' },
] as const;

type TokenCounts = Pick<ReturnType<typeof groupUsageByModel>[number], 'totalTokens' | typeof series[number]['field']>;

function TokenStack({ counts }: { counts: TokenCounts }) {
  if (counts.totalTokens <= 0) return null;
  return series.map(({ field, color }) => (
    <span key={field} className={color} style={{ flex: `0 0 ${counts[field] / counts.totalTokens * 100}%` }} />
  ));
}

export function UsageChoice<T extends string>({
  label, value, choices, onChange,
}: {
  label: string;
  value: T;
  choices: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl border border-border p-1">
      {choices.map(([choice, name]) => (
        <Button
          key={choice}
          variant="ghost"
          size="sm"
          aria-pressed={value === choice}
          className="aria-pressed:bg-black/5 dark:aria-pressed:bg-white/10 aria-pressed:text-foreground text-muted-foreground"
          onClick={() => { if (choice !== value) onChange(choice); }}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}

export function UsageChart({
  entries, window, now, groupBy, onGroupChange,
}: {
  entries: UsageHistoryEntry[];
  window: UsageWindow;
  now: number;
  groupBy: UsageGroupBy;
  onGroupChange: (groupBy: UsageGroupBy) => void;
}) {
  const { t, i18n } = useTranslation('dashboard', { keyPrefix: 'recentTokenHistory' });
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  const number = new Intl.NumberFormat(locale);

  return (
    <section aria-label={t('chart')} className="rounded-xl border border-border bg-surface-modal p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <UsageChoice
          label={t('chart')}
          value={groupBy}
          choices={[['day', t('groupByTime')], ['model', t('groupByModel')]]}
          onChange={onGroupChange}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-meta text-muted-foreground">
          {series.map(({ label, color }) => (
            <span key={label} className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />
              {t(label)}
            </span>
          ))}
        </div>
      </div>
      {groupBy === 'model'
        ? <ModelUsageBars entries={entries} number={number} />
        : <TimeUsageBars entries={entries} window={window} now={now} locale={locale} number={number} />}
    </section>
  );
}

function ModelUsageBars({ entries, number }: { entries: UsageHistoryEntry[]; number: Intl.NumberFormat }) {
  const { t } = useTranslation('dashboard', { keyPrefix: 'recentTokenHistory' });
  const groups = groupUsageByModel(entries).slice(0, 8);
  const max = Math.max(groups[0]?.totalTokens ?? 0, 1);

  return (
    <ul data-testid="usage-model-chart" className="space-y-3">
      {groups.map((group) => (
        <li key={group.key} className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <ModelIcon modelName={group.model ?? ''} />
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="max-w-full truncate font-medium" title={group.model}>{group.model || t('unknownModel')}</span>
                {group.provider && <span className="max-w-full truncate text-meta text-muted-foreground" title={group.provider}>{group.provider}</span>}
              </div>
            </div>
            <span className="tabular-nums text-muted-foreground">
              <span className="sr-only">{t('totalTokens')}{' '}</span>{number.format(group.totalTokens)}
            </span>
          </div>
          <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              data-testid="usage-model-bar"
              className="flex h-full overflow-hidden"
              style={{ width: `${group.totalTokens / max * 100}%` }}
            >
              <TokenStack counts={group} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TimeUsageBars({
  entries, window, now, locale, number,
}: {
  entries: UsageHistoryEntry[];
  window: UsageWindow;
  now: number;
  locale?: string;
  number: Intl.NumberFormat;
}) {
  const { t } = useTranslation('dashboard', { keyPrefix: 'recentTokenHistory' });
  const { interval, buckets } = groupUsageByTime(entries, window, now);
  if (buckets.length === 0) return null;
  const max = buckets.reduce((value, bucket) => Math.max(value, bucket.totalTokens), 0);
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const tickDate = new Intl.DateTimeFormat(locale, interval === 'month'
    ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  const fullDate = new Intl.DateTimeFormat(locale, interval === 'month'
    ? { month: 'long', year: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' });
  const tickCount = Math.min(buckets.length, 4);
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    buckets[Math.round(index * (buckets.length - 1) / Math.max(tickCount - 1, 1))]);

  return (
    <div data-testid="usage-time-chart" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta text-muted-foreground">
      <div aria-hidden="true" className="flex flex-col justify-between text-right tabular-nums">
        <span>{max > 0 ? compact.format(max) : ''}</span>
        <span>{number.format(0)}</span>
      </div>
      <div className="relative h-36 border-y border-border">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-border" />
        <ul className="relative flex h-full gap-px sm:gap-1">
          {buckets.map((bucket) => {
            const date = fullDate.format(bucket.start);
            const label = interval === 'week' ? t('weekOf', { date }) : date;
            const description = [`${label} · ${t('totalTokens')} ${number.format(bucket.totalTokens)}`,
              ...series.map(({ field, label }) => `${t(label)} ${number.format(bucket[field])}`),
            ].join('\n');
            return (
              <li
                key={bucket.start}
                data-testid="usage-time-bucket"
                data-tokens={bucket.totalTokens}
                title={description}
                className="flex min-w-0 flex-1 items-end justify-center"
              >
                <span className="sr-only">{description}</span>
                <span
                  aria-hidden="true"
                  className="flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-t-sm"
                  style={{ height: `${max > 0 ? bucket.totalTokens / max * 100 : 0}%` }}
                >
                  <TokenStack counts={bucket} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div aria-hidden="true" className="col-start-2 flex justify-between gap-2">
        {ticks.map(({ start }) => <span key={start}>{tickDate.format(start)}</span>)}
      </div>
    </div>
  );
}
