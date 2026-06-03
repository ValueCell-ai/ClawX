import { describe, expect, it, vi, beforeEach } from 'vitest';

const gatewayRpcMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    gateway: {
      rpc: async (method: string, params?: unknown, timeoutMs?: number) => {
        const result = await gatewayRpcMock(
          method,
          params,
          timeoutMs,
        ) as { success?: boolean; result?: unknown; error?: string };
        if (result?.success === false) {
          throw new Error(result.error || `RPC ${method} failed`);
        }
        return result?.result;
      },
    },
  },
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

  it('skips sessions with existing frontend or backend labels', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          success: true,
          result: {
            sessions: [
              { key: 'agent:main:session-a', label: 'Backend label', updatedAt: 1000 },
              { key: 'agent:main:session-b', displayName: 'Session B', updatedAt: 1001 },
              { key: 'agent:main:main', displayName: 'Main', updatedAt: 1002 },
            ],
          },
        };
      }
      if (method === 'chat.history') {
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
      sessionLabels: { 'agent:main:session-b': 'Already labeled' },
      sessionLastActivity: {},
    };
    const set = vi.fn();
    const get = vi.fn().mockReturnValue({
      ...state,
      loadHistory: vi.fn(),
    });

    const actions = createSessionActions(set as never, get as never);
    await actions.loadSessions();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chatHistoryCalls = gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history');
    expect(chatHistoryCalls).toHaveLength(0);
  });

  it('does not re-request unchanged sessions after an empty hydration result', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          success: true,
          result: {
            sessions: [
              { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
              { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
            ],
          },
        };
      }
      if (method === 'chat.history') {
        return {
          success: true,
          result: {
            messages: [],
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    await actions.loadSessions();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chatHistoryCalls = gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history');
    expect(chatHistoryCalls).toHaveLength(1);
  });

  it('re-requests a session when updatedAt changes after an empty result', async () => {
    let updatedAt = 1000;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          success: true,
          result: {
            sessions: [
              { key: 'agent:main:session-a', displayName: 'Session A', updatedAt },
              { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
            ],
          },
        };
      }
      if (method === 'chat.history') {
        return {
          success: true,
          result: {
            messages: [],
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
    await new Promise((resolve) => setTimeout(resolve, 10));
    updatedAt = 2000;
    await actions.loadSessions();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const chatHistoryCalls = gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history');
    expect(chatHistoryCalls).toHaveLength(2);
  });
});
