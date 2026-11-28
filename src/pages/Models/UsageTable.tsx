import { ChevronDown, CircleQuestionMark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModelIcon } from '@/components/common/ModelIcon';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatUsageTimestamp, isHiddenUsageSource, type UsageHistoryEntry } from './usage-history';
import './usage-table.css';

const tokenColumns = [
  ['input', 'inputTokens'],
  ['output', 'outputTokens'],
  ['cacheRead', 'cacheReadTokens'],
  ['cacheWrite', 'cacheWriteTokens'],
] as const;

function TokenBreakdown({ label, value, metrics }: {
  label: string;
  value: string;
  metrics: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${label} · ${value}`}
          className="h-auto min-h-7 max-w-full gap-1 px-0.5 tabular-nums"
        >
          <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{value}</span>
          <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="rounded-xl border border-border bg-surface-modal p-3 shadow-xl" align="end">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
          {metrics.map(([name, amount]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="text-right tabular-nums">{amount}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function UsageTable({ entries, showContent, onViewContent }: {
  entries: UsageHistoryEntry[];
  showContent: boolean;
  onViewContent: (entry: UsageHistoryEntry, trigger: HTMLButtonElement) => void;
}) {
  const { t, i18n } = useTranslation('dashboard', { keyPrefix: 'recentTokenHistory' });
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  const number = new Intl.NumberFormat(locale);
  const columns = ['model', 'time', ...tokenColumns.map(([name]) => name), 'cache', 'total', 'cost'];
  return (
    <div className="rounded-xl border border-border bg-surface-modal [container-type:inline-size]">
      <table data-testid="token-usage-table" className="usage-detail-table w-full table-fixed text-sm" aria-label={t('title')}>
        <thead className="bg-surface-input text-meta text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                data-column={column}
                aria-label={column === 'cost' ? t('columns.cost') : undefined}
                className="px-2 py-2 font-medium first:rounded-tl-xl last:rounded-tr-xl"
              >
                {column === 'cost' ? (
                  <div className="flex items-center justify-end gap-1">
                    <span className="min-w-0">{t('columns.cost')}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                          aria-label={t('costHelp')}
                        >
                          <CircleQuestionMark aria-hidden="true" className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="end" className="max-w-xs text-left font-normal">{t('costHint')}</TooltipContent>
                    </Tooltip>
                  </div>
                ) : t(`columns.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map((entry, index) => {
            const hasUsage = !entry.usageStatus || entry.usageStatus === 'available';
            const statusLabel = entry.usageStatus === 'error'
              ? t('usageParseError') : entry.usageStatus === 'missing' ? t('noUsage') : undefined;
            const total = hasUsage ? number.format(entry.totalTokens) : entry.usageStatus === 'error' ? '✕' : '—';
            const metrics = tokenColumns.map(([name, field]) => [t(`columns.${name}`), number.format(entry[field])] as const);
            const source = [entry.provider, entry.agentId].filter((value) => value && !isHiddenUsageSource(value)).join(' · ');

            return (
              <tr key={`${entry.sessionId}-${entry.timestamp}-${index}`} data-testid="token-usage-entry">
                <td data-column="model" className="px-2 py-2.5">
                  <div className="flex min-w-0 gap-2">
                    <ModelIcon modelName={entry.model ?? ''} className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={entry.model}>{entry.model || t('unknownModel')}</p>
                      {source && <p className="mt-0.5 truncate text-meta text-muted-foreground" title={source}>{source}</p>}
                    </div>
                  </div>
                  <span className="sr-only">{entry.sessionId}</span>
                </td>
                <td data-column="time" className="px-2 py-2.5 text-meta text-muted-foreground">
                  {formatUsageTimestamp(entry.timestamp, locale)}
                </td>
                {tokenColumns.map(([name], index) => {
                  const value = hasUsage ? metrics[index][1] : '—';
                  return (
                    <td key={name} data-column={name} className="px-2 py-2.5 tabular-nums text-muted-foreground">
                      {name === 'output' && showContent && entry.content ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="link"
                              size="sm"
                              aria-label={`${value} · ${t('viewContent')}`}
                              aria-haspopup="dialog"
                              className="h-auto max-w-full whitespace-normal px-0 py-0 text-right font-normal underline decoration-dashed [overflow-wrap:anywhere]"
                              onClick={(event) => onViewContent(entry, event.currentTarget)}
                            >
                              {value}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t('viewContent')}</TooltipContent>
                        </Tooltip>
                      ) : value}
                    </td>
                  );
                })}
                <td data-column="cache" className="px-2 py-2.5 text-muted-foreground">
                  {hasUsage ? (
                    <TokenBreakdown label={t('columns.cache')} value={number.format(entry.cacheReadTokens + entry.cacheWriteTokens)} metrics={metrics.slice(2)} />
                  ) : '—'}
                </td>
                <td data-column="total" className="px-2 py-2.5 font-medium tabular-nums" title={statusLabel}>
                  <span data-total-value className={entry.usageStatus === 'error' ? 'text-destructive' : undefined}>
                    {total}
                    {statusLabel && <span className="sr-only">{statusLabel}</span>}
                  </span>
                  {hasUsage && (
                    <span data-total-breakdown>
                      <TokenBreakdown label={t('columns.total')} value={total} metrics={metrics} />
                    </span>
                  )}
                </td>
                <td data-column="cost" className="px-2 py-2.5 tabular-nums">
                  {typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? `$${entry.costUsd.toFixed(4)}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
