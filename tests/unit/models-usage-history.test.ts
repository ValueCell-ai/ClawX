import { describe, expect, it } from 'vitest';
import {
  filterUsageHistoryByWindow,
  groupUsageHistory,
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

    const groups = groupUsageHistory(entries, 'day');

    expect(groups).toHaveLength(12);
    expect(groups[0]?.totalTokens).toBe(1);
    expect(groups[11]?.totalTokens).toBe(12);
  });

  it('limits model buckets to the top eight by total tokens', () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      ...createEntry(index + 1, index + 1),
      model: `model-${index + 1}`,
    }));

    const groups = groupUsageHistory(entries, 'model');

    expect(groups).toHaveLength(8);
    expect(groups[0]?.label).toBe('model-10');
    expect(groups[7]?.label).toBe('model-3');
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
