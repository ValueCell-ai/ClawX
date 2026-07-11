import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeManager } from '@electron/runtime/manager';

const { getRecentTokenUsageHistoryMock } = vi.hoisted(() => ({
  getRecentTokenUsageHistoryMock: vi.fn(),
}));

vi.mock('@electron/utils/token-usage', () => ({
  getRecentTokenUsageHistory: (...args: unknown[]) => getRecentTokenUsageHistoryMock(...args),
}));

function runtimeManager(kind: 'openclaw' | 'cc-connect'): RuntimeManager {
  return {
    getActiveProvider: () => ({ kind }),
  } as RuntimeManager;
}

describe('usage api runtime routing', () => {
  beforeEach(() => {
    getRecentTokenUsageHistoryMock.mockReset();
    getRecentTokenUsageHistoryMock.mockResolvedValue([]);
  });

  it('defaults token history to the active runtime', async () => {
    const { createUsageApi } = await import('@electron/services/usage-api');
    const usage = createUsageApi(runtimeManager('cc-connect'));

    await usage.recentTokenHistory({ limit: 25 });

    expect(getRecentTokenUsageHistoryMock).toHaveBeenCalledWith({
      limit: 25,
      runtimeKind: 'cc-connect',
    });
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
