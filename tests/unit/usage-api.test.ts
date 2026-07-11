import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeManager } from '@electron/runtime/manager';

const { getRecentTokenUsageHistoryMock } = vi.hoisted(() => ({
  getRecentTokenUsageHistoryMock: vi.fn(),
}));

vi.mock('@electron/utils/token-usage', () => ({
  getRecentTokenUsageHistory: (...args: unknown[]) => getRecentTokenUsageHistoryMock(...args),
}));

function runtimeManager(kind: 'openclaw' | 'cc-connect', messages: unknown[] = []): RuntimeManager {
  return {
    getActiveProvider: () => ({
      kind,
      listSessions: vi.fn(async () => ({
        success: true,
        sessions: [{ key: 'agent:main:main', agentId: 'main' }],
      })),
      loadHistory: vi.fn(async () => ({ success: true, messages })),
    }),
  } as RuntimeManager;
}

describe('usage api runtime routing', () => {
  beforeEach(() => {
    getRecentTokenUsageHistoryMock.mockReset();
    getRecentTokenUsageHistoryMock.mockResolvedValue([]);
  });

  it('reports missing usage from public cc-connect history without reading Codex transcripts', async () => {
    const { createUsageApi } = await import('@electron/services/usage-api');
    const usage = createUsageApi(runtimeManager('cc-connect', [{
      role: 'assistant',
      content: 'public cc-connect reply',
      timestamp: 1_780_000_001_000,
    }]));

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

    expect(getRecentTokenUsageHistoryMock).not.toHaveBeenCalled();
  });

  it('preserves real usage when cc-connect exposes it in public history', async () => {
    const { createUsageApi } = await import('@electron/services/usage-api');
    const usage = createUsageApi(runtimeManager('cc-connect', [{
      role: 'assistant',
      content: 'metered reply',
      timestamp: 1_780_000_001_000,
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
    }]));

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

    await getRecentTokenHistoryForRuntime({ limit: 10, runtimeKind: 'openclaw' }, runtimeManager('cc-connect'));

    expect(getRecentTokenUsageHistoryMock).toHaveBeenCalledWith({
      limit: 10,
      runtimeKind: 'openclaw',
    });
  });

  it('supports legacy numeric payloads while applying active runtime', async () => {
    const { getRecentTokenHistoryForRuntime } = await import('@electron/services/usage-api');

    await getRecentTokenHistoryForRuntime(5, runtimeManager('openclaw'));

    expect(getRecentTokenUsageHistoryMock).toHaveBeenCalledWith({
      limit: 5,
      runtimeKind: 'openclaw',
    });
  });
});
