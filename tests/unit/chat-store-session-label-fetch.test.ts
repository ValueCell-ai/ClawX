import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
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
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

describe('chat store session label summary hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T00:00:00Z'));
    runtimeStatus.state = 'running';
    runtimeStatus.port = 18789;
    runtimeStatus.connectedAt = Date.now();
    window.localStorage.clear();
    agentsState.agents = [];
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, summaries: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates sidebar titles immediately after sessions load because summaries do not use gateway chat.history', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
      }

      if (method === 'chat.history') {
        return {
          messages: [{ role: 'user', content: 'visible chat', timestamp: Date.now() }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      summaries: [
        {
          sessionKey: 'agent:main:session-a',
          firstUserText: 'should hydrate immediately',
          lastTimestamp: 1_700_000_000_000,
        },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a'] }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('should hydrate immediately');

    const backgroundHistoryCalls = gatewayRpcMock.mock.calls.filter(
      ([method, params]) => method === 'chat.history' && (params as Record<string, unknown> | undefined)?.limit === 1000,
    );
    expect(backgroundHistoryCalls).toHaveLength(0);
  });

  it('hydrates existing sidebar session titles as soon as sessions load', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'ClawX', updatedAt: 1000 },
            { key: 'agent:main:session-b', displayName: 'ClawX', updatedAt: 1001 },
            { key: 'agent:main:main', displayName: 'ClawX', updatedAt: 1002 },
          ],
        };
      }

      if (method === 'chat.history') {
        return {
          messages: [{ role: 'user', content: 'visible chat', timestamp: Date.now() }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      summaries: [
        { sessionKey: 'agent:main:session-a', firstUserText: 'Alpha title', lastTimestamp: 1_700_000_000_100 },
        { sessionKey: 'agent:main:session-b', firstUserText: 'Beta title', lastTimestamp: 1_700_000_000_200 },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a', 'agent:main:session-b'] }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Alpha title');
    expect(useChatStore.getState().sessionLabels['agent:main:session-b']).toBe('Beta title');
  });

  it('hydrates session labels through the host API instead of gateway chat.history fan-out', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
            { key: 'agent:main:session-b', displayName: 'Session B', updatedAt: 1001, label: 'Backend label' },
            { key: 'agent:main:session-c', displayName: 'Session C', updatedAt: 1002 },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1003 },
          ],
        };
      }

      if (method === 'chat.history') {
        return {
          messages: [{ role: 'user', content: 'visible chat', timestamp: Date.now() }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/sessions/transcript')) {
        return { success: true, messages: [] };
      }
      if (path === '/api/sessions/summaries') {
        return {
          success: true,
          summaries: [
            {
              sessionKey: 'agent:main:session-c',
              firstUserText: 'needs label',
              lastTimestamp: 1_700_000_000_123,
            },
          ],
        };
      }
      return { success: true, summaries: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: { 'agent:main:session-a': 'Already labeled' },
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    await useChatStore.getState().loadHistory(false);
    hostApiFetchMock.mockClear();
    gatewayRpcMock.mockClear();

    vi.advanceTimersByTime(1_500);
    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-c'] }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-c']).toBe('needs label');
    expect(useChatStore.getState().sessionLastActivity['agent:main:session-c']).toBe(1_700_000_000_123);
    const backgroundHistoryCalls = gatewayRpcMock.mock.calls.filter(
      ([method, params]) => method === 'chat.history' && (params as Record<string, unknown> | undefined)?.limit === 1000,
    );
    expect(backgroundHistoryCalls).toHaveLength(0);
  });

  it('does not re-request label hydration for unchanged sessions across repeated loadSessions calls', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
      }

      if (method === 'chat.history') {
        return {
          messages: [{ role: 'user', content: 'visible chat', timestamp: Date.now() }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock.mockResolvedValueOnce({
      success: true,
      summaries: [
        { sessionKey: 'agent:main:session-a', firstUserText: null, lastTimestamp: null },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    vi.advanceTimersByTime(1_500);
    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    vi.advanceTimersByTime(1_500);
    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-requests a session summary when updatedAt changes after an empty result', async () => {
    let sessionVersion = 1000;

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: sessionVersion },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
      }

      if (method === 'chat.history') {
        return {
          messages: [{ role: 'user', content: 'visible chat', timestamp: Date.now() }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    hostApiFetchMock
      .mockResolvedValueOnce({
        success: true,
        summaries: [
          { sessionKey: 'agent:main:session-a', firstUserText: null, lastTimestamp: null },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        summaries: [
          { sessionKey: 'agent:main:session-a', firstUserText: 'new label', lastTimestamp: 1_700_000_000_999 },
        ],
      });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
      runError: null,
    });

    vi.advanceTimersByTime(1_500);
    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    sessionVersion = 2000;
    vi.advanceTimersByTime(1_500);
    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a'] }),
    });
    expect(hostApiFetchMock).toHaveBeenNthCalledWith(2, '/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a'] }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('new label');
  });
});
