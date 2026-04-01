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

export type UsageGroup = {
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  sortKey: number | string;
};

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

export function formatUsageDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getUsageDaySortKey(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function groupUsageHistory(
  entries: UsageHistoryEntry[],
  groupBy: UsageGroupBy,
): UsageGroup[] {
  const grouped = new Map<string, UsageGroup>();

  for (const entry of entries) {
    const label = groupBy === 'model'
      ? (entry.model || 'Unknown')
      : formatUsageDay(entry.timestamp);
    const current = grouped.get(label) ?? {
      label,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      sortKey: groupBy === 'day' ? getUsageDaySortKey(entry.timestamp) : label.toLowerCase(),
    };
    current.totalTokens += entry.totalTokens;
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
    grouped.set(label, current);
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => {
    if (groupBy === 'day') {
      return Number(a.sortKey) - Number(b.sortKey);
    }
    return b.totalTokens - a.totalTokens;
  });

  return groupBy === 'model' ? sorted.slice(0, 8) : sorted;
}

export function filterUsageHistoryByWindow(
  entries: UsageHistoryEntry[],
  window: UsageWindow,
  now = Date.now(),
): UsageHistoryEntry[] {
  if (window === 'all') return entries;

  const days = window === '7d' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
