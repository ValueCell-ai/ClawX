import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: runtimeStatus,
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => ({ agents: [] }),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
}));

describe('chat store loadSessions startup selection', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    runtimeStatus.connectedAt = Date.now();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the latest non-cron session instead of a cron heartbeat session', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'PDF summary',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-a');
  });

  it('clears the prior conversation when loadSessions retargets to another session', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-b',
              displayName: 'Other chat',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'user', content: 'question from another chat' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-b');
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('keeps the default main ghost session when only cron sessions exist', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:main');
    expect(useChatStore.getState().sessions.some((session) => session.key === 'agent:main:main')).toBe(true);
  });
});
