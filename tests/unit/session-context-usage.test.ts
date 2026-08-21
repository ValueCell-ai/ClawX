import { describe, expect, it } from 'vitest';
import { parseSessionContextUsage } from '@/lib/acp/session-usage';
import { formatCompactTokenCount, formatContextUsagePercent } from '@/lib/format-token-count';

describe('formatCompactTokenCount', () => {
  it('formats token counts compactly', () => {
    expect(formatCompactTokenCount(35100)).toBe('35.1k');
    expect(formatCompactTokenCount(1000)).toBe('1k');
    expect(formatCompactTokenCount(1000000)).toBe('1M');
    expect(formatCompactTokenCount(999)).toBe('999');
  });
});

describe('formatContextUsagePercent', () => {
  it('returns a rounded percentage capped at 100', () => {
    expect(formatContextUsagePercent(35100, 1000000)).toBe(4);
    expect(formatContextUsagePercent(120, 100)).toBe(100);
    expect(formatContextUsagePercent(-1, 100)).toBe(0);
  });
});

describe('parseSessionContextUsage', () => {
  it('parses valid usage payloads', () => {
    expect(parseSessionContextUsage({
      used: 35100,
      size: 1000000,
      cost: { amount: 0.01, currency: 'USD' },
    })).toEqual({
      used: 35100,
      size: 1000000,
      cost: { amount: 0.01, currency: 'USD' },
    });
  });

  it('rejects invalid usage payloads', () => {
    expect(parseSessionContextUsage(null)).toBeNull();
    expect(parseSessionContextUsage({ used: 10 })).toBeNull();
    expect(parseSessionContextUsage({ used: 10, size: 0 })).toBeNull();
    expect(parseSessionContextUsage({ used: '10', size: 100 })).toBeNull();
  });
});
