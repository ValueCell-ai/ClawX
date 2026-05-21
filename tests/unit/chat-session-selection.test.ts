import { describe, expect, it } from 'vitest';
import { pickStartupSessionFallback } from '@/stores/chat/session-selection';
import type { ChatSession } from '@/stores/chat/types';

describe('pickStartupSessionFallback', () => {
  it('prefers the agent main session when present', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:cron:heartbeat', label: 'heartbeat', updatedAt: 9_000 },
      { key: 'agent:main:main', displayName: 'Main', updatedAt: 1_000 },
    ];

    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBe('agent:main:main');
  });

  it('prefers the most recently updated non-cron session for the agent', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:cron:heartbeat', label: 'heartbeat', updatedAt: 9_000 },
      { key: 'agent:main:session-old', updatedAt: 2_000 },
      { key: 'agent:main:session-new', updatedAt: 5_000 },
    ];

    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBe('agent:main:session-new');
  });

  it('does not auto-select cron sessions when only cron entries exist', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:cron:heartbeat', label: 'heartbeat', updatedAt: 9_000 },
    ];

    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBeNull();
  });

  it('falls back to non-cron sessions from other agents before cron', () => {
    const sessions: ChatSession[] = [
      { key: 'agent:main:cron:heartbeat', updatedAt: 9_000 },
      { key: 'agent:research:desk', updatedAt: 3_000 },
    ];

    expect(pickStartupSessionFallback('agent:main:main', sessions)).toBe('agent:research:desk');
  });
});
