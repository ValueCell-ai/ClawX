import { describe, expect, it, vi } from 'vitest';
import type { RuntimeManager } from '@electron/runtime/manager';
import type { RuntimeKind, RuntimeUsageRecord } from '@electron/runtime/types';

function usageRecord(runtimeKind: RuntimeKind, overrides: Partial<RuntimeUsageRecord> = {}): RuntimeUsageRecord {
  return {
    id: `${runtimeKind}:turn-1`,
    runtimeKind,
    logicalSessionId: 'agent:main:main',
    runtimeSessionId: 'runtime-main',
    turnId: 'turn-1',
    agentId: 'main',
    provider: 'openai',
    model: 'gpt-5.4',
    timestamp: '2026-05-28T20:26:41.000Z',
    status: 'missing',
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function runtimeManager(
  activeKind: RuntimeKind,
  records: Partial<Record<RuntimeKind, RuntimeUsageRecord[]>> = {},
): RuntimeManager {
  const providers = Object.fromEntries((['openclaw', 'cc-connect'] as const).map((kind) => [kind, {
    kind,
    listUsage: vi.fn(async () => ({ success: true, records: records[kind] ?? [] })),
  }])) as Record<RuntimeKind, { kind: RuntimeKind; listUsage: ReturnType<typeof vi.fn> }>;
  return {
    getActiveProvider: () => providers[activeKind],
    getProvider: (kind: RuntimeKind) => providers[kind],
  } as unknown as RuntimeManager;
}

describe('usage api runtime routing', () => {
  it('reports missing usage supplied by the cc-connect RuntimeProvider', async () => {
    const { createUsageApi } = await import('@electron/services/usage-api');
    const manager = runtimeManager('cc-connect', {
      'cc-connect': [usageRecord('cc-connect', { content: 'public cc-connect reply' })],
    });
    const usage = createUsageApi(manager);

    await expect(usage.recentTokenHistory({ limit: 25 })).resolves.toEqual([
      expect.objectContaining({
        runtimeKind: 'cc-connect',
        sessionId: 'agent:main:main',
        agentId: 'main',
        content: 'public cc-connect reply',
        usageStatus: 'missing',
        totalTokens: 0,
      }),
    ]);

    expect(manager.getProvider('cc-connect').listUsage).toHaveBeenCalledWith({ limit: 25 });
  });

  it('preserves real usage when cc-connect exposes it in public history', async () => {
    const { createUsageApi } = await import('@electron/services/usage-api');
    const usage = createUsageApi(runtimeManager('cc-connect', {
      'cc-connect': [usageRecord('cc-connect', {
        status: 'available',
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      })],
    }));

    await expect(usage.recentTokenHistory({ limit: 25 })).resolves.toEqual([
      expect.objectContaining({
        usageStatus: 'available',
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      }),
    ]);
  });

  it('keeps explicit runtimeKind overrides for diagnostics', async () => {
    const { getRecentTokenHistoryForRuntime } = await import('@electron/services/usage-api');
    const manager = runtimeManager('cc-connect');

    await getRecentTokenHistoryForRuntime({ limit: 10, runtimeKind: 'openclaw' }, manager);

    expect(manager.getProvider('openclaw').listUsage).toHaveBeenCalledWith({ limit: 10 });
  });

  it('supports legacy numeric payloads while applying active runtime', async () => {
    const { getRecentTokenHistoryForRuntime } = await import('@electron/services/usage-api');

    const manager = runtimeManager('openclaw');
    await getRecentTokenHistoryForRuntime(5, manager);

    expect(manager.getProvider('openclaw').listUsage).toHaveBeenCalledWith({ limit: 5 });
  });
});
