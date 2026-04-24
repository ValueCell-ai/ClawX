import { describe, expect, it, vi, beforeEach } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/stores/chat/helpers', () => ({
  getCanonicalPrefixFromSessions: () => 'agent:main',
  getMessageText: (content: unknown) => typeof content === 'string' ? content : '',
  toMs: (v: unknown) => typeof v === 'number' ? v : 0,
}));

describe('session label fetch concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limits concurrent chat.history RPCs during label fetches', async () => {
    // Track max concurrent RPCs
    let currentConcurrency = 0;
    let maxConcurrency = 0;
    const resolvers: Array<() => void> = [];

    invokeIpcMock.mockImplementation(async (channel: string, method: string) => {
      if (method === 'sessions.list') {
        return {
          success: true,
          result: {
            sessions: Array.from({ length: 12 }, (_, i) => ({
              key: `agent:main:session-${i}`,
              label: `Session ${i}`,
            })),
          },
        };
      }
      if (method === 'chat.history') {
        currentConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        currentConcurrency--;
        return {
          success: true,
          result: {
            messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
          },
        };
      }
      return { success: false };
    });

    vi.resetModules();
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const state = {
      currentSessionKey: 'agent:main:main',
      messages: [],
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    };
    const set = vi.fn();
    const get = vi.fn().mockReturnValue({
      ...state,
      loadHistory: vi.fn(),
    });

    const actions = createSessionActions(set as never, get as never);
    await actions.loadSessions();

    // Wait for the label-fetch loop to start its batches
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Resolve first batch (up to 5 concurrent)
    while (resolvers.length > 0 && resolvers.length <= 5) {
      resolvers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Resolve remaining
    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // maxConcurrency should be capped at 5 (LABEL_FETCH_CONCURRENCY)
    expect(maxConcurrency).toBeLessThanOrEqual(5);
  });
});
