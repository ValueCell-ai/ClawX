import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, agentsState, hostApiFetchMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
  hostApiFetchMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: { state: 'running', port: 18789, connectedAt: Date.now() },
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

describe('useChatStore startup history retry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.localStorage.clear();
    agentsState.agents = [];
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ messages: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the longer timeout only for the initial foreground history load', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    gatewayRpcMock
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'first load', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'quiet refresh', timestamp: 1001 }],
      });

    await useChatStore.getState().loadHistory(false);
    vi.advanceTimersByTime(1_000);
    await useChatStore.getState().loadHistory(true);

    expect(gatewayRpcMock).toHaveBeenNthCalledWith(
      1,
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    );
    expect(gatewayRpcMock).toHaveBeenNthCalledWith(
      2,
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      undefined,
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 191_800);
    setTimeoutSpy.mockRestore();
  });

  it('forces the internal final-message reload through the quiet history cooldown', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    gatewayRpcMock
      .mockResolvedValueOnce({
        messages: [{ role: 'user', content: 'hello', id: 'u1', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [
          { role: 'user', content: 'hello', id: 'u1', timestamp: 1000 },
          { role: 'assistant', content: 'Real answer', id: 'a2', timestamp: 1001 },
        ],
      });

    await useChatStore.getState().loadHistory(true);
    useChatStore.setState({
      sending: true,
      activeRunId: 'run-internal',
      streamingText: 'NO_REPLY',
      streamingMessage: { role: 'assistant', content: 'NO_REPLY' },
    });

    useChatStore.getState().handleChatEvent({
      state: 'final',
      runId: 'run-internal',
      sessionKey: 'agent:main:main',
      message: { role: 'assistant', content: 'NO_REPLY', id: 'a1' },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(gatewayRpcMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'hello',
      'Real answer',
    ]);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('keeps non-startup foreground loading safety timeout at 15 seconds', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
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
    });

    gatewayRpcMock
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'first load', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'second foreground load', timestamp: 1001 }],
      });

    await useChatStore.getState().loadHistory(false);
    setTimeoutSpy.mockClear();
    await useChatStore.getState().loadHistory(false);

    expect(gatewayRpcMock).toHaveBeenNthCalledWith(
      2,
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      undefined,
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
    setTimeoutSpy.mockRestore();
  });

  it('does not burn the first-load retry path when the first attempt becomes stale', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }, { key: 'agent:main:other' }],
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
    });

    let resolveFirstAttempt: ((value: { messages: Array<{ role: string; content: string; timestamp: number }> }) => void) | null = null;
    gatewayRpcMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstAttempt = resolve;
      }))
      .mockRejectedValueOnce(new Error('RPC timeout: chat.history'))
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'restored after retry', timestamp: 1002 }],
      });

    const firstLoad = useChatStore.getState().loadHistory(false);
    useChatStore.setState({
      currentSessionKey: 'agent:main:other',
      messages: [{ role: 'assistant', content: 'other session', timestamp: 1001 }],
    });
    resolveFirstAttempt?.({
      messages: [{ role: 'assistant', content: 'stale original payload', timestamp: 1000 }],
    });
    await firstLoad;

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      messages: [],
    });
    const secondLoad = useChatStore.getState().loadHistory(false);
    await vi.runAllTimersAsync();
    await secondLoad;

    expect(gatewayRpcMock).toHaveBeenCalledTimes(3);
    expect(gatewayRpcMock.mock.calls[0]).toEqual([
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    ]);
    expect(gatewayRpcMock.mock.calls[1]).toEqual([
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    ]);
    expect(gatewayRpcMock.mock.calls[2]).toEqual([
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    ]);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['restored after retry']);
    expect(warnSpy).toHaveBeenCalledWith(
      '[chat.history] startup retry scheduled',
      expect.objectContaining({
        sessionKey: 'agent:main:main',
        attempt: 1,
      }),
    );
    warnSpy.mockRestore();
  });

  it('stops retrying once the user switches sessions mid-load', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { useChatStore } = await import('@/stores/chat');

    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }, { key: 'agent:main:other' }],
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
    });

    gatewayRpcMock.mockImplementationOnce(async () => {
      useChatStore.setState({
        currentSessionKey: 'agent:main:other',
        messages: [{ role: 'assistant', content: 'other session', timestamp: 1001 }],
        loading: false,
      });
      throw new Error('RPC timeout: chat.history');
    });

    await useChatStore.getState().loadHistory(false);

    expect(gatewayRpcMock).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:other');
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['other session']);
    expect(useChatStore.getState().error).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
