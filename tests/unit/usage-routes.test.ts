import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const getRecentTokenUsageHistoryMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/utils/token-usage', () => ({
  getRecentTokenUsageHistory: (...args: unknown[]) => getRecentTokenUsageHistoryMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleUsageRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes undefined limit when query param is missing', async () => {
    getRecentTokenUsageHistoryMock.mockResolvedValueOnce([{ totalTokens: 1 }]);
    const { handleUsageRoutes } = await import('@electron/api/routes/usage');

    const handled = await handleUsageRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/usage/recent-token-history'),
      {} as never,
    );

    expect(handled).toBe(true);
    expect(getRecentTokenUsageHistoryMock).toHaveBeenCalledWith(undefined);
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      [{ totalTokens: 1 }],
    );
  });

  it('passes sanitized numeric limit when provided', async () => {
    getRecentTokenUsageHistoryMock.mockResolvedValueOnce([]);
    const { handleUsageRoutes } = await import('@electron/api/routes/usage');

    await handleUsageRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/usage/recent-token-history?limit=50.9'),
      {} as never,
    );

    expect(getRecentTokenUsageHistoryMock).toHaveBeenCalledWith(50);
  });
});
