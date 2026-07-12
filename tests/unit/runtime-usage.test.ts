import { describe, expect, it } from 'vitest';
import { runtimeUsageLimit, toRuntimeUsageRecords, toTokenUsageHistoryEntry } from '@electron/runtime/usage';
import type { TokenUsageHistoryEntry } from '@electron/utils/token-usage-core';

function entry(overrides: Partial<TokenUsageHistoryEntry> = {}): TokenUsageHistoryEntry {
  return {
    timestamp: '2026-07-13T00:00:00.000Z',
    sessionId: 'agent:main:main',
    agentId: 'main',
    provider: 'openai',
    model: 'gpt-5.4',
    usageStatus: 'available',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 80,
    cacheWriteTokens: 0,
    reasoningTokens: 5,
    totalTokens: 120,
    ...overrides,
  };
}

describe('runtime usage contract mapping', () => {
  it('preserves a public turn id and maps cache/reasoning subsets', () => {
    const [record] = toRuntimeUsageRecords([entry({ turnId: 'public-turn-1' })], {
      runtimeKind: 'cc-connect',
      logicalSessionId: 'agent:main:main',
      runtimeSessionId: 'runtime-session-1',
      providerAccountId: 'openai-oauth-a',
    });

    expect(record).toMatchObject({
      id: 'cc-connect:runtime-session-1:public-turn-1',
      turnId: 'public-turn-1',
      providerAccountId: 'openai-oauth-a',
      cachedInputTokens: 80,
      reasoningTokens: 5,
      totalTokens: 120,
    });
    expect(toTokenUsageHistoryEntry(record)).toMatchObject({
      sessionId: 'agent:main:main',
      runtimeSessionId: 'runtime-session-1',
      turnId: 'public-turn-1',
      providerAccountId: 'openai-oauth-a',
      usageStatus: 'available',
      cacheReadTokens: 80,
      reasoningTokens: 5,
      totalTokens: 120,
    });
  });

  it('uses a stable fallback turn id when older history receives a newer entry', () => {
    const older = entry({ timestamp: '2026-07-13T00:00:00.000Z', content: 'older' });
    const newer = entry({ timestamp: '2026-07-13T00:01:00.000Z', content: 'newer' });
    const identity = {
      runtimeKind: 'cc-connect' as const,
      runtimeSessionId: 'runtime-session-1',
    };

    const [before] = toRuntimeUsageRecords([older], identity);
    const after = toRuntimeUsageRecords([newer, older], identity).find((record) => record.content === 'older');

    expect(after?.turnId).toBe(before.turnId);
    expect(after?.id).toBe(before.id);
  });

  it('normalizes list limits at the runtime boundary', () => {
    expect(runtimeUsageLimit({ limit: '5' })).toBe(5);
    expect(runtimeUsageLimit(0)).toBe(1);
    expect(runtimeUsageLimit({ limit: 'invalid' })).toBeUndefined();
  });
});
