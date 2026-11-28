import { describe, expect, it } from 'vitest';
import {
  filterUsageHistoryByWindow,
  groupUsageByModel,
  groupUsageByTime,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageHistoryEntry,
} from '@/pages/Models/usage-history';

function createEntry(day: number, totalTokens: number): UsageHistoryEntry {
  return {
    timestamp: `2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    sessionId: `session-${day}`,
    agentId: 'main',
    model: 'gpt-5',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  };
}

describe('models usage history helpers', () => {
  it('keeps all day buckets instead of truncating to the first eight', () => {
    const entries = Array.from({ length: 12 }, (_, index) => createEntry(index + 1, index + 1));

    const { buckets: groups } = groupUsageByTime(entries, 'all');

    expect(groups).toHaveLength(12);
    expect(groups[0]?.totalTokens).toBe(1);
    expect(groups[11]?.totalTokens).toBe(12);
  });

  it('groups same-named models separately by provider and sorts by total usage', () => {
    const entries = [
      { ...createEntry(1, 5), provider: 'first' },
      { ...createEntry(2, 12), provider: 'second' },
      { ...createEntry(3, 10), provider: 'first' },
    ];

    const groups = groupUsageByModel(entries);

    expect(groups.map(({ model, provider, totalTokens }) => [model, provider, totalTokens])).toEqual([
      ['gpt-5', 'first', 15],
      ['gpt-5', 'second', 12],
    ]);
  });

  it('fills each local date overlapping the rolling window, including its partial first day', () => {
    const now = new Date(2026, 2, 12, 12).getTime();
    const entries = [
      { ...createEntry(5, 4), timestamp: new Date(2026, 2, 5, 13).toISOString() },
      { ...createEntry(8, 12), timestamp: new Date(2026, 2, 8, 13).toISOString() },
    ];
    const { interval, buckets } = groupUsageByTime(entries, '7d', now);
    expect(interval).toBe('day');
    expect(buckets.map(({ start }) => new Date(start).getDate())).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(buckets.map(({ totalTokens }) => totalTokens)).toEqual([4, 0, 0, 12, 0, 0, 0, 0]);
  });

  it('keeps identical months from different years separate in all-time history', () => {
    const entries = [
      { ...createEntry(5, 4), timestamp: new Date(2025, 2, 5, 13).toISOString() },
      { ...createEntry(5, 9), timestamp: new Date(2026, 2, 5, 13).toISOString() },
    ];
    const { interval, buckets } = groupUsageByTime(entries, 'all');
    expect(interval).toBe('month');
    expect(buckets).toHaveLength(13);
    expect(buckets.map(({ totalTokens }) => totalTokens)).toEqual([4, ...Array(11).fill(0), 9]);
  });

  it('filters the last 30 days relative to now instead of calendar month boundaries', () => {
    const now = Date.parse('2026-03-12T12:00:00.000Z');
    const entries = [
      {
        ...createEntry(12, 12),
        timestamp: '2026-03-12T12:00:00.000Z',
      },
      {
        ...createEntry(11, 11),
        timestamp: '2026-02-11T12:00:00.000Z',
      },
      {
        ...createEntry(10, 10),
        timestamp: '2026-02-10T11:59:59.000Z',
      },
    ];

    const filtered = filterUsageHistoryByWindow(entries, '30d', now);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((entry) => entry.totalTokens)).toEqual([12, 11]);
  });

  it('clears the stable usage snapshot when a successful refresh returns empty', () => {
    const stable = [createEntry(12, 12)];

    expect(resolveStableUsageHistory(stable, [])).toEqual([]);
  });

  it('can preserve the last stable usage snapshot while a refresh is still in flight', () => {
    const stable = [createEntry(12, 12)];

    expect(resolveStableUsageHistory(stable, [], { preservePreviousOnEmpty: true })).toEqual(stable);
  });

  it('prefers fresh usage entries over the cached snapshot when available', () => {
    const stable = [createEntry(12, 12)];
    const fresh = [createEntry(13, 13)];

    expect(resolveVisibleUsageHistory([], stable)).toEqual([]);
    expect(resolveVisibleUsageHistory([], stable, { preferStableOnEmpty: true })).toEqual(stable);
    expect(resolveVisibleUsageHistory(fresh, stable, { preferStableOnEmpty: true })).toEqual(fresh);
  });
});
