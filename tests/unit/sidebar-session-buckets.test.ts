import { describe, expect, it } from 'vitest';
import { getSessionActivityMs, getSessionBucket } from '@/components/layout/session-buckets';

describe('sidebar session date buckets', () => {
  it('uses the timestamp embedded in a locally-created session key as activity fallback', () => {
    const createdAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const nowMs = new Date('2026-05-06T12:00:00.000Z').getTime();
    const session = {
      key: `agent:main:session-${createdAtMs}`,
      displayName: `agent:main:session-${createdAtMs}`,
    };

    const activityMs = getSessionActivityMs(session, {});

    expect(activityMs).toBe(createdAtMs);
    expect(getSessionBucket(activityMs, nowMs)).toBe('today');
  });

  it('prefers real message activity over backend metadata or key creation time', () => {
    const keyCreatedAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const updatedAtMs = new Date('2026-05-06T11:00:00.000Z').getTime();
    const messageActivityMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(getSessionActivityMs(
      {
        key: `agent:main:session-${keyCreatedAtMs}`,
        updatedAt: updatedAtMs,
      },
      { [`agent:main:session-${keyCreatedAtMs}`]: messageActivityMs },
    )).toBe(messageActivityMs);
  });

  it('groups activity into today, seven days, thirty days, and older buckets', () => {
    const nowMs = new Date(2026, 4, 18, 8, 15).getTime();

    expect(getSessionBucket(new Date(2026, 4, 18, 0, 0).getTime(), nowMs)).toBe('today');
    expect(getSessionBucket(new Date(2026, 4, 17, 23, 59, 59, 999).getTime(), nowMs)).toBe('withinWeek');
    expect(getSessionBucket(new Date(2026, 4, 11, 0, 0).getTime(), nowMs)).toBe('withinWeek');
    expect(getSessionBucket(new Date(2026, 4, 10, 23, 59, 59, 999).getTime(), nowMs)).toBe('withinMonth');
    expect(getSessionBucket(new Date(2026, 3, 18, 0, 0).getTime(), nowMs)).toBe('withinMonth');
    expect(getSessionBucket(new Date(2026, 3, 17, 23, 59, 59, 999).getTime(), nowMs)).toBe('older');
    expect(getSessionBucket(0, nowMs)).toBe('older');
  });
});
