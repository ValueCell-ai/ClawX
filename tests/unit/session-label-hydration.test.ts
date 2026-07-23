import { describe, expect, it } from 'vitest';
import {
  beginSessionLabelHydration,
  clearSessionLabelHydrationTracking,
  finishSessionLabelHydration,
  getSessionLabelHydrationVersion,
  isSessionLabelHydrationVersionCurrent,
} from '@/stores/chat/session-label-hydration';

describe('session label hydration tracking', () => {
  it('advances the incarnation when an identical session key is deleted and recreated', () => {
    const session = { key: 'agent:main:recreated', updatedAt: 1_700_000_000_000 };
    const oldVersion = getSessionLabelHydrationVersion(session, {});

    expect(beginSessionLabelHydration(session.key, oldVersion)).toBe(true);
    clearSessionLabelHydrationTracking(session.key);

    const newVersion = getSessionLabelHydrationVersion(session, {});
    expect(newVersion).not.toBe(oldVersion);
    expect(isSessionLabelHydrationVersionCurrent(session.key, oldVersion)).toBe(false);
    expect(isSessionLabelHydrationVersionCurrent(session.key, newVersion)).toBe(true);
    expect(beginSessionLabelHydration(session.key, oldVersion)).toBe(false);
    expect(beginSessionLabelHydration(session.key, newVersion)).toBe(true);
  });

  it('ignores a stale completion after the new incarnation has completed', () => {
    const session = { key: 'agent:main:completion-race', updatedAt: 1_700_000_000_000 };
    const oldVersion = getSessionLabelHydrationVersion(session, {});
    expect(beginSessionLabelHydration(session.key, oldVersion)).toBe(true);

    clearSessionLabelHydrationTracking(session.key);
    const newVersion = getSessionLabelHydrationVersion(session, {});
    expect(beginSessionLabelHydration(session.key, newVersion)).toBe(true);
    finishSessionLabelHydration(session.key, newVersion, 'labeled');
    finishSessionLabelHydration(session.key, oldVersion, 'error');

    expect(beginSessionLabelHydration(session.key, newVersion)).toBe(false);
  });
});
