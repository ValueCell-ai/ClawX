export type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus?: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};

export type UsageWindow = '7d' | '30d' | 'all';
export type UsageGroupBy = 'model' | 'day';

type UsageTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
};

export type UsageModel = Pick<UsageHistoryEntry, 'model' | 'provider'>;
export type UsageModelGroup = UsageTotals & UsageModel & { key: string };
export type UsageTimeBucket = UsageTotals & { start: number };
type UsageTimeInterval = 'day' | 'week' | 'month';

const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];

export function isHiddenUsageSource(source?: string): boolean {
  const normalizedSource = source?.trim().toLowerCase() ?? '';
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}

export function resolveStableUsageHistory(
  previousStableEntries: UsageHistoryEntry[],
  nextEntries: UsageHistoryEntry[],
  options: { preservePreviousOnEmpty?: boolean } = {},
): UsageHistoryEntry[] {
  if (nextEntries.length > 0) {
    return nextEntries;
  }

  return options.preservePreviousOnEmpty ? previousStableEntries : [];
}

export function resolveVisibleUsageHistory(
  currentEntries: UsageHistoryEntry[],
  stableEntries: UsageHistoryEntry[],
  options: { preferStableOnEmpty?: boolean } = {},
): UsageHistoryEntry[] {
  if (options.preferStableOnEmpty && currentEntries.length === 0) {
    return stableEntries;
  }

  return currentEntries;
}

export function usageModelKey({ model, provider }: UsageModel): string {
  return JSON.stringify([model || '', provider || '']);
}

export function createUsageMillionsFormatter(locale?: string): (tokens: number) => string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (tokens) => {
    const millions = tokens / 1_000_000;
    return millions > 0 && millions < 0.01
      ? `< ${number.format(0.01)} M`
      : `${number.format(millions)} M`;
  };
}

export function formatUsageTimestamp(timestamp: string, locale?: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function emptyTotals(): UsageTotals {
  return { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
}

function addUsage(totals: UsageTotals, entry: UsageHistoryEntry): void {
  totals.totalTokens += entry.totalTokens;
  totals.inputTokens += entry.inputTokens;
  totals.outputTokens += entry.outputTokens;
  totals.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
}

export function groupUsageByModel(entries: UsageHistoryEntry[]): UsageModelGroup[] {
  const groups = new Map<string, UsageModelGroup>();
  for (const entry of entries) {
    const key = usageModelKey(entry);
    const group = groups.get(key) ?? { key, model: entry.model, provider: entry.provider, ...emptyTotals() };
    addUsage(group, entry);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getWindowStart(window: Exclude<UsageWindow, 'all'>, now: number): number {
  return now - (window === '7d' ? 7 : 30) * DAY_MS;
}

function startOfBucket(timestamp: number, interval: UsageTimeInterval): Date {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  if (interval === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  if (interval === 'month') date.setDate(1);
  return date;
}

export function groupUsageByTime(
  entries: UsageHistoryEntry[],
  window: UsageWindow,
  now = Date.now(),
): { interval: UsageTimeInterval; buckets: UsageTimeBucket[] } {
  const windowStart = window === 'all' ? -Infinity : getWindowStart(window, now);
  const windowEnd = window === 'all' ? Infinity : now;
  const timedEntries = entries.map((entry) => ({ entry, timestamp: Date.parse(entry.timestamp) }))
    .filter(({ timestamp }) => timestamp >= windowStart && timestamp <= windowEnd);
  let first = window === 'all' ? Infinity : windowStart;
  let last = window === 'all' ? -Infinity : now;
  for (const { timestamp } of timedEntries) {
    first = Math.min(first, timestamp);
    last = Math.max(last, timestamp);
  }
  const spanDays = (last - first) / DAY_MS;
  const interval = window === 'all' && spanDays > 31
    ? (spanDays > 120 ? 'month' : 'week') : 'day';
  const buckets = new Map<number, UsageTimeBucket>();
  const cursor = startOfBucket(first, interval);
  while (cursor.getTime() <= last) {
    const start = cursor.getTime();
    buckets.set(start, { start, ...emptyTotals() });
    if (interval === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + (interval === 'week' ? 7 : 1));
    cursor.setHours(0, 0, 0, 0);
  }
  for (const { entry, timestamp } of timedEntries) {
    const bucket = buckets.get(startOfBucket(timestamp, interval).getTime());
    if (bucket) addUsage(bucket, entry);
  }
  return { interval, buckets: Array.from(buckets.values()) };
}

export function filterUsageHistoryByWindow(
  entries: UsageHistoryEntry[],
  window: UsageWindow,
  now = Date.now(),
): UsageHistoryEntry[] {
  if (window === 'all') return entries;

  const cutoff = getWindowStart(window, now);

  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return timestamp >= cutoff && timestamp <= now;
  });
}
