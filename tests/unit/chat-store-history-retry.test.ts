import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatHistoryRpcParams } from './gateway-rpc-test-utils';

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
  hostApi: {
    media: {
      thumbnails: vi.fn(async () => ({})),
    },
    sessions: {
      history: async (input: { sessionKey?: string; agentId?: string; sessionId?: string; limit?: number }) => {
        if (input?.sessionKey) {
          const params = new URLSearchParams();
          params.set('sessionKey', input.sessionKey);
          params.set('limit', String(input.limit ?? 200));
          return hostApiFetchMock(`/api/sessions/transcript?${params.toString()}`);
        }
        const params = new URLSearchParams();
        if (input?.agentId) params.set('agentId', input.agentId);
        if (input?.sessionId) params.set('sessionId', input.sessionId);
        if (input?.limit) params.set('limit', String(input.limit));
        return hostApiFetchMock(`/api/sessions/transcript?${params.toString()}`);
      },
      summaries: async (input: unknown) => hostApiFetchMock('/api/sessions/summaries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true })),
    },
    chat: {
      sendWithMedia: vi.fn(async () => ({ success: true, result: { runId: 'run-media' } })),
    },
  },
}));

describe('useChatStore startup history retry', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    window.localStorage.clear();
    agentsState.agents = [];
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/sessions' || path === '/api/chat/history' || path === '/api/chat/send' || path === '/api/chat/abort') {
        throw new Error('No route for mocked chat host API');
      }
      return { messages: [] };
    });
    const { resetChatHistoryMaxCharsCache, resolveChatHistoryMaxChars } = await import('@/stores/chat/history-rpc-params');
    resetChatHistoryMaxCharsCache();
    await resolveChatHistoryMaxChars();
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
      chatHistoryRpcParams('agent:main:main', 200),
      35_000,
    );
    expect(gatewayRpcMock).toHaveBeenNthCalledWith(
      2,
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
      undefined,
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 191_800);
    setTimeoutSpy.mockRestore();
  });

  it('renders local transcript fallback while the initial gateway history request is still pending', async () => {
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

    let resolveGatewayHistory: ((value: { messages: Array<{ role: string; content: string; timestamp: number }> }) => void) | null = null;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method !== 'chat.history') {
        throw new Error(`Unexpected gateway RPC: ${method}`);
      }
      return await new Promise<{ messages: Array<{ role: string; content: string; timestamp: number }> }>((resolve) => {
        resolveGatewayHistory = resolve;
      });
    });
    hostApiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sessions/transcript')) {
        return {
          messages: [{ role: 'assistant', content: 'local transcript first', timestamp: 1000 }],
        };
      }
      return { messages: [] };
    });

    const loadPromise = useChatStore.getState().loadHistory(false);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'local transcript first',
    ]);
    expect(gatewayRpcMock).toHaveBeenCalledWith(
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
      35_000,
    );

    const quietReloadWhileGatewayPending = useChatStore.getState().loadHistory(true);
    await Promise.resolve();
    expect(gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history')).toHaveLength(1);

    resolveGatewayHistory?.({
      messages: [{ role: 'assistant', content: 'gateway authoritative history', timestamp: 1001 }],
    });
    await loadPromise;
    await quietReloadWhileGatewayPending;
    await vi.waitFor(() => {
      expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
        'gateway authoritative history',
      ]);
    });
  });

  it('keeps startup retry active after rendering local transcript fallback', async () => {
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

    let rejectFirstGatewayHistory: ((reason?: unknown) => void) | null = null;
    let chatHistoryCalls = 0;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method !== 'chat.history') {
        throw new Error(`Unexpected gateway RPC: ${method}`);
      }
      chatHistoryCalls += 1;
      if (chatHistoryCalls === 1) {
        return await new Promise((_resolve, reject) => {
          rejectFirstGatewayHistory = reject;
        });
      }
      return {
        messages: [{ role: 'assistant', content: 'gateway history after retry', timestamp: 1001 }],
      };
    });
    hostApiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sessions/transcript')) {
        return {
          messages: [{ role: 'assistant', content: 'local transcript first', timestamp: 1000 }],
        };
      }
      return { messages: [] };
    });

    const loadPromise = useChatStore.getState().loadHistory(false);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'local transcript first',
    ]);

    rejectFirstGatewayHistory?.(new Error('RPC timeout: chat.history'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    await loadPromise;

    expect(gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history')).toHaveLength(2);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'gateway history after retry',
    ]);
  });

  it('keeps local transcript fallback when gateway returns empty history', async () => {
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

    let resolveGatewayHistory: ((value: { messages: Array<unknown> }) => void) | null = null;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method !== 'chat.history') {
        throw new Error(`Unexpected gateway RPC: ${method}`);
      }
      return await new Promise<{ messages: Array<unknown> }>((resolve) => {
        resolveGatewayHistory = resolve;
      });
    });
    hostApiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/sessions/transcript')) {
        return {
          messages: [{ role: 'assistant', content: 'local transcript remains', timestamp: 1000 }],
        };
      }
      return { messages: [] };
    });

    const loadPromise = useChatStore.getState().loadHistory(false);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'local transcript remains',
    ]);

    resolveGatewayHistory?.({ messages: [] });
    await loadPromise;

    expect(useChatStore.getState().loading).toBe(false);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'local transcript remains',
    ]);
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

    await vi.waitFor(() => {
      expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
        'hello',
        'Real answer',
      ]);
    });

    const historyCalls = gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history');
    expect(historyCalls).toHaveLength(2);
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
      chatHistoryRpcParams('agent:main:main', 200),
      undefined,
    );
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 15_000);
    setTimeoutSpy.mockRestore();
  });

  it('keeps cached session messages visible without foreground loading overlay during refresh', async () => {
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

    gatewayRpcMock
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'cached history', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'main history', timestamp: 1001 }],
      });

    useChatStore.setState({ currentSessionKey: 'agent:main:other' });
    await useChatStore.getState().loadHistory(false);

    gatewayRpcMock.mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => {
        resolve({ messages: [{ role: 'assistant', content: 'refreshed cached history', timestamp: 1002 }] });
      }, 10);
    }));

    useChatStore.getState().switchSession('agent:main:other');

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['cached history']);
    expect(useChatStore.getState().loading).toBe(false);
  });

  it('switchSession restores cached session messages immediately while refreshing in background', async () => {
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

    gatewayRpcMock
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'cached history', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'main history', timestamp: 1001 }],
      });

    useChatStore.setState({ currentSessionKey: 'agent:main:other' });
    await useChatStore.getState().loadHistory(false);

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [{ role: 'assistant', content: 'refreshed cached history', timestamp: 1002 }],
    });

    useChatStore.getState().switchSession('agent:main:other');

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['cached history']);
  });

  it('does not re-arm Thinking state for stale main-session heartbeat tool history', async () => {
    const { useChatStore } = await import('@/stores/chat');

    gatewayRpcMock.mockResolvedValue({
      messages: [
        { id: 'user-old', role: 'user', content: 'old question', timestamp: 1_000 },
        {
          id: 'assistant-tool',
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: '~/.openclaw/workspace/HEARTBEAT.md' } }],
          stopReason: 'toolUse',
          timestamp: 1_100,
        },
      ],
    });

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

    await useChatStore.getState().loadHistory(false);

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('switchSession preserves unsynced optimistic user messages when switching back', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const optimisticHello = {
      id: 'user-hello-opt',
      role: 'user' as const,
      content: '你好',
      timestamp: 1_700_000_000,
    };

    useChatStore.setState({
      currentSessionKey: 'agent:main:session-a',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-a' }, { key: 'agent:main:other' }],
      messages: [optimisticHello],
      sessionLabels: {},
      sessionLastActivity: { 'agent:main:session-a': Date.now() },
      sending: true,
      activeRunId: 'run-hello',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValue({ messages: [] });

    useChatStore.getState().switchSession('agent:main:other');
    useChatStore.getState().switchSession('agent:main:session-a');

    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['你好']);
  });

  it('switchSession restores in-flight run state so Thinking indicator survives navigation', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-run',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-run' }, { key: 'agent:main:other' }],
      messages: [
        { id: 'user-run', role: 'user', content: 'browse the page', timestamp: 1000 },
        {
          id: 'assistant-tool-run',
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'tool-run', name: 'browser', input: { action: 'snapshot' } },
          ],
          stopReason: 'toolUse',
          timestamp: 1500,
        },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-nav-test',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: true,
      lastUserMessageAt: 1000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    useChatStore.getState().switchSession('agent:main:other');
    expect(useChatStore.getState().sending).toBe(false);

    useChatStore.getState().switchSession('agent:main:session-run');

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-nav-test');
    expect(state.pendingFinal).toBe(true);
    expect(state.lastUserMessageAt).toBe(1000);
  });

  it('treats the same session as a fresh foreground load after gateway runtime changes', async () => {
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
        messages: [{ role: 'assistant', content: 'first runtime', timestamp: 1000 }],
      })
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'second runtime', timestamp: 1001 }],
      });

    await useChatStore.getState().loadHistory(false);

    vi.resetModules();
    vi.doMock('@/stores/gateway', () => ({
      useGatewayStore: {
        getState: () => ({
          status: { state: 'running', port: 18789, connectedAt: Date.now() + 5_000 },
          rpc: gatewayRpcMock,
        }),
      },
    }));
    const { useChatStore: useChatStoreReloaded } = await import('@/stores/chat');
    useChatStoreReloaded.setState({
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

    setTimeoutSpy.mockClear();
    await useChatStoreReloaded.getState().loadHistory(false);

    expect(gatewayRpcMock).toHaveBeenLastCalledWith(
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
      35_000,
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 191_800);
    setTimeoutSpy.mockRestore();
  });

  it('does not burn the first-load retry path when the first attempt becomes stale', async () => {
    vi.useRealTimers();
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
    let historyAttempt = 0;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method !== 'chat.history') {
        throw new Error(`Unexpected gateway RPC: ${method}`);
      }
      historyAttempt += 1;
      if (historyAttempt === 1) {
        return await new Promise<{ messages: Array<{ role: string; content: string; timestamp: number }> }>((resolve) => {
          resolveFirstAttempt = resolve;
        });
      }
      if (historyAttempt === 2) {
        throw new Error('RPC timeout: chat.history');
      }
      return {
        messages: [{ role: 'assistant', content: 'restored after retry', timestamp: 1002 }],
      };
    });

    const firstLoad = useChatStore.getState().loadHistory(false);
    await Promise.resolve();
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
    await new Promise((resolve) => setTimeout(resolve, 900));
    await secondLoad;
    vi.useFakeTimers();

    const historyCalls = gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history');
    expect(historyCalls).toHaveLength(3);
    expect(historyCalls[0]).toEqual([
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
      35_000,
    ]);
    expect(historyCalls[1]).toEqual([
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
      35_000,
    ]);
    expect(historyCalls[2]).toEqual([
      'chat.history',
      chatHistoryRpcParams('agent:main:main', 200),
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

    expect(gatewayRpcMock.mock.calls.filter(([method]) => method === 'chat.history')).toHaveLength(1);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:other');
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['other session']);
    expect(useChatStore.getState().error).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('keeps the optimistic user message when completion refresh wins the transcript write race', async () => {
    const { useChatStore } = await import('@/stores/chat');
    let historyMessages: Array<Record<string, unknown>> = [];
    let resolveSend: ((value: { runId: string }) => void) | null = null;

    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise((resolve) => {
          resolveSend = resolve as (value: { runId: string }) => void;
        });
      }
      if (method === 'chat.history') {
        return Promise.resolve({ messages: historyMessages });
      }
      return Promise.resolve({});
    });

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

    const sendPromise = useChatStore.getState().sendMessage('hello from app');
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['hello from app']);

    // Simulate Gateway phase=end clearing send state before chat.history has
    // persisted the user turn.
    useChatStore.setState({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });

    await useChatStore.getState().loadHistory(true);
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual(['hello from app']);

    historyMessages = [{
      role: 'user',
      content: 'hello from app',
      timestamp: Date.now() / 1000,
      id: 'server-user',
    }];
    vi.advanceTimersByTime(1_000);
    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toMatchObject({
      id: 'server-user',
      role: 'user',
      content: 'hello from app',
    });

    resolveSend?.({ runId: 'run-1' });
    await sendPromise;
  });

  it('does not restore a pending optimistic message after deleting the session', async () => {
    const { useChatStore } = await import('@/stores/chat');
    let resolveSend: ((value: { runId: string }) => void) | null = null;

    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise((resolve) => {
          resolveSend = resolve as (value: { runId: string }) => void;
        });
      }
      if (method === 'chat.history') {
        return Promise.resolve({ messages: [] });
      }
      return Promise.resolve({});
    });
    hostApiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/sessions/delete') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ messages: [] });
    });

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

    const sendPromise = useChatStore.getState().sendMessage('message that will be deleted');
    expect(useChatStore.getState().messages.map((message) => message.content)).toEqual([
      'message that will be deleted',
    ]);

    await useChatStore.getState().deleteSession('agent:main:main');
    expect(useChatStore.getState().messages).toEqual([]);

    await useChatStore.getState().loadHistory(true);
    expect(useChatStore.getState().messages).toEqual([]);

    resolveSend?.({ runId: 'run-deleted' });
    await sendPromise;
  });

  // Regression for the "thinking disappears mid-tool-chain" bug:
  // when the history-poll loads an intermediate `[thinking, toolCall]` assistant
  // message (stop_reason=tool_use) the closer half of applyLoadedMessages used
  // to match it as a "final reply" — because `hasNonToolAssistantContent` once
  // counted thinking blocks as user-visible content — and clear sending /
  // activeRunId / pendingFinal. That caused the Execution Graph card to flip to
  // inactive, the Thinking… dot to vanish, and ChatInput's stop button to
  // revert to a send button while the agent was still running tools.
  it('keeps the run open across intermediate [thinking, toolCall] history snapshots', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-1',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-1' }],
      messages: [
        { id: 'user-1', role: 'user', content: '帮我查一下昆明未来七天的天气', timestamp: 1000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-keep-open',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: 1000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-1', role: 'user', content: '帮我查一下昆明未来七天的天气', timestamp: 1000 },
        {
          id: 'assistant-tool-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me search for the weather.' },
            { type: 'toolCall', id: 'tool-1', name: 'web_search', input: { query: 'Kunming weather' } },
          ],
          stopReason: 'toolUse',
          timestamp: 1500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-keep-open');
    expect(state.pendingFinal).toBe(false);
  });

  // Regression for the mixed `[thinking, text, toolCall]` shape some models
  // emit. Even though it carries user-visible text, stop_reason=tool_use means
  // the assistant is still pending a tool result and the lifecycle must stay
  // armed. Without `hasPendingToolUse`, the closer would match this on the
  // text block and clear sending.
  it('keeps the run open for mixed [thinking, text, toolCall] turns with stopReason=toolUse', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-2',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-2' }],
      messages: [
        { id: 'user-2', role: 'user', content: 'mixed turn test', timestamp: 2000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-mixed',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: true,
      lastUserMessageAt: 2000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-2', role: 'user', content: 'mixed turn test', timestamp: 2000 },
        {
          id: 'assistant-mixed-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should search before answering.' },
            { type: 'text', text: 'Let me search for that.' },
            { type: 'toolCall', id: 'tool-2', name: 'web_search', input: { query: 'foo' } },
          ],
          stopReason: 'toolUse',
          timestamp: 2500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-mixed');
    expect(state.pendingFinal).toBe(true);
  });

  // Positive case: a real final reply (text/image, no pending tool) SHOULD
  // close the run when applyLoadedMessages observes it via history poll.
  it('closes the run when a final assistant reply (text, stopReason=endTurn) appears', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-3',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-3' }],
      messages: [
        { id: 'user-3', role: 'user', content: 'final reply test', timestamp: 3000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-final',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: true,
      lastUserMessageAt: 3000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-3', role: 'user', content: 'final reply test', timestamp: 3000 },
        {
          id: 'assistant-final-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I have all the info.' },
            { type: 'text', text: 'Here is the answer.' },
          ],
          stopReason: 'endTurn',
          timestamp: 3500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);
  });

  it('unsticks sending when history has a final reply after tools without pendingFinal', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-stuck',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-stuck' }],
      messages: [
        { id: 'user-stuck', role: 'user', content: '执行一下github1', timestamp: 1000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-stuck',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: 1000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-stuck', role: 'user', content: '执行一下github1', timestamp: 1000 },
        {
          id: 'assistant-tool',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Fetching data.' },
            { type: 'tool_use', id: 'tool-1', name: 'web_fetch', input: { url: 'https://example.com' } },
          ],
          timestamp: 1500,
        },
        {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: '执行完成 ✅' }],
          stopReason: 'endTurn',
          timestamp: 2000,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingFinal).toBe(false);
  });

  // Cross-protocol coverage: Anthropic Messages API native shape (snake_case).
  // OpenClaw's gateway normally normalizes to camelCase, but some paths can
  // pass Anthropic responses through unchanged. `hasPendingToolUse` must still
  // detect the intermediate turn via `stop_reason: "tool_use"` plus
  // `content[].type === "tool_use"`.
  it('keeps the run open for Anthropic-native [thinking, tool_use] (snake_case stop_reason)', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-anthropic',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-anthropic' }],
      messages: [
        { id: 'user-a', role: 'user', content: 'anthropic protocol', timestamp: 4000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-anthropic',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: 4000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-a', role: 'user', content: 'anthropic protocol', timestamp: 4000 },
        {
          id: 'assistant-anthropic-1',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Should I use a tool?' },
            { type: 'tool_use', id: 'toolu_01', name: 'web_search', input: { query: 'foo' } },
          ],
          stop_reason: 'tool_use',
          timestamp: 4500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-anthropic');
  });

  // Cross-protocol coverage: OpenAI Chat Completions native shape. The
  // tool-call signal is the top-level `tool_calls` array on the message, with
  // no `stop_reason` / `stopReason` field (OpenAI uses `finish_reason` at the
  // choice level which doesn't reach the message object). `hasPendingToolUse`
  // must still flag this via the `tool_calls` array check.
  it('keeps the run open for OpenAI ChatCompletions message with tool_calls array', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-openai-cc',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-openai-cc' }],
      messages: [
        { id: 'user-occ', role: 'user', content: 'openai chat completions', timestamp: 5000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-openai-cc',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: 5000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-occ', role: 'user', content: 'openai chat completions', timestamp: 5000 },
        {
          id: 'assistant-openai-cc-1',
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"foo"}' },
            },
          ],
          timestamp: 5500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(true);
    expect(state.activeRunId).toBe('run-openai-cc');
  });

  // Cross-protocol coverage: OpenAI Chat Completions FINAL reply. No
  // tool_calls, plain text content. Must close the run normally.
  it('closes the run for OpenAI ChatCompletions plain-text final reply', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-openai-cc-final',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-openai-cc-final' }],
      messages: [
        { id: 'user-occf', role: 'user', content: 'openai final', timestamp: 6000 },
      ],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-openai-cc-final',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: true,
      lastUserMessageAt: 6000,
      pendingToolImages: [],
      error: null,
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-occf', role: 'user', content: 'openai final', timestamp: 6000 },
        {
          id: 'assistant-openai-cc-final-1',
          role: 'assistant',
          content: 'Here is the final answer.',
          timestamp: 6500,
        },
      ],
    });

    await useChatStore.getState().loadHistory(true);

    const state = useChatStore.getState();
    expect(state.sending).toBe(false);
    expect(state.activeRunId).toBeNull();
  });

  // Regression: the 90s safety timeout used to fire "No response received"
  // while the model was still working via tool chains. Gateway streaming can be
  // absent (WS drop, long tool execution) but chat.history still surfaces
  // intermediate assistant turns — those must count as progress.
  it('clears a stale no-response error when history poll shows tool progress', async () => {
    const sendAtMs = 1_700_000_000_000;
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-stuck',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-stuck' }],
      messages: [{ id: 'user-stuck', role: 'user', content: 'weather check' }],
      sessionLabels: {},
      sessionLastActivity: {},
      sending: true,
      activeRunId: 'run-stuck-test',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: sendAtMs,
      pendingToolImages: [],
      error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
      loading: false,
      thinkingLevel: null,
    });

    gatewayRpcMock.mockResolvedValueOnce({
      messages: [
        { id: 'user-stuck', role: 'user', content: 'weather check', timestamp: sendAtMs },
        {
          id: 'assistant-tool-stuck',
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Searching...' },
            { type: 'toolCall', id: 'tool-stuck', name: 'web_search', input: { q: 'weather' } },
          ],
          stopReason: 'toolUse',
          timestamp: sendAtMs + 500,
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await useChatStore.getState().loadHistory(true);

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().messages.some((msg) => msg.role === 'assistant')).toBe(true);
  });

  it('does not emit a false no-response error when history poll shows tool progress', async () => {
    let resolveSend: ((value: { runId: string }) => void) | undefined;
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { id: 'user-stuck', role: 'user', content: 'weather check', timestamp: 1000 },
            {
              id: 'assistant-tool-stuck',
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'Searching...' },
                { type: 'toolCall', id: 'tool-stuck', name: 'web_search', input: { q: 'weather' } },
              ],
              stopReason: 'toolUse',
              timestamp: 1500,
            },
          ],
        };
      }
      return { messages: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-stuck',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-stuck' }],
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

    const sendPromise = useChatStore.getState().sendMessage('weather check');

    await vi.advanceTimersByTimeAsync(7_000);
    await useChatStore.getState().loadHistory(true);
    await vi.advanceTimersByTimeAsync(100_000);

    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().messages.some((msg) => msg.role === 'assistant')).toBe(true);

    resolveSend?.({ runId: 'run-stuck-test' });
    await sendPromise;
  });

  it('surfaces an idle-timeout hint when a role-only stream placeholder stalls the run', async () => {
    let resolveSend: ((value: { runId: string }) => void) | undefined;
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { id: 'user-old', role: 'user', content: 'hello', timestamp: 1000 },
            { id: 'assistant-old', role: 'assistant', content: 'hi there', timestamp: 1500 },
          ],
        };
      }
      return { messages: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-idle',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-idle' }],
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
      runError: null,
      loading: false,
      thinkingLevel: null,
    });

    const sendPromise = useChatStore.getState().sendMessage('long question');
    useChatStore.setState({
      streamingMessage: { role: 'assistant' },
    });

    await vi.advanceTimersByTimeAsync(121_000);

    expect(useChatStore.getState().runError).toContain('120 seconds');
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().streamingMessage).toBeNull();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().error).toContain('No response received');

    resolveSend?.({ runId: 'run-idle-test' });
    await sendPromise;
  });

  // Regression for the "first chat after gateway start" bug: the gateway
  // accepted chat.send but no streamed chat/runtime events ever reached the
  // renderer. Without the fallback transcript poll the safety timers fired
  // "The model did not respond within 120 seconds" and then "No response
  // received from the model" even though the transcript already contained
  // the assistant reply.
  it('recovers via the fallback transcript poll when no streamed events arrive', async () => {
    let chatHistoryCalls = 0;
    let transcript: Array<Record<string, unknown>> = [];
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method === 'chat.send') {
        // Seed the transcript as the gateway would, but never emit events.
        const nowSec = Date.now() / 1000;
        transcript = [
          { id: 'user-first', role: 'user', content: '明天呢', timestamp: nowSec },
          {
            id: 'assistant-first',
            role: 'assistant',
            content: [{ type: 'text', text: '明天晴。' }],
            stopReason: 'endTurn',
            timestamp: nowSec + 1,
          },
        ];
        return { runId: 'run-first-chat' };
      }
      if (method === 'chat.history') {
        chatHistoryCalls += 1;
        return { messages: transcript };
      }
      return { messages: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-first-chat',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-first-chat' }],
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
      runError: null,
      loading: false,
      thinkingLevel: null,
    });

    await useChatStore.getState().sendMessage('明天呢');

    // While streamed events are still considered fresh the poll stays silent.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(chatHistoryCalls).toBe(0);

    // After enough event silence the fallback poll reads the transcript,
    // detects the finished reply, and closes the run without errors.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chatHistoryCalls).toBeGreaterThan(0);
    await vi.waitFor(() => {
      expect(useChatStore.getState().sending).toBe(false);
    });
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'user-first',
      'assistant-first',
    ]);

    // The 120s idle hint and the 130s hard failure must never fire.
    await vi.advanceTimersByTimeAsync(140_000);
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().runError).toBeNull();
  });

  it('keeps the fallback poll silent while streamed events are fresh', async () => {
    let chatHistoryCalls = 0;
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'config.get') return {};
      if (method === 'chat.send') {
        return { runId: 'run-streamed' };
      }
      if (method === 'chat.history') {
        chatHistoryCalls += 1;
        return { messages: [] };
      }
      return { messages: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-streamed',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-streamed' }],
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
      runError: null,
      loading: false,
      thinkingLevel: null,
    });

    await useChatStore.getState().sendMessage('streamed run');

    // Streamed deltas keep refreshing the event timestamp; the fallback poll
    // must not issue any chat.history RPCs while the stream is healthy.
    for (let i = 0; i < 6; i += 1) {
      useChatStore.getState().handleChatEvent({
        state: 'delta',
        runId: 'run-streamed',
        sessionKey: 'agent:main:session-streamed',
        message: { role: 'assistant', content: [{ type: 'text', text: `chunk ${i}` }] },
      });
      await vi.advanceTimersByTimeAsync(5_000);
    }

    expect(chatHistoryCalls).toBe(0);
    expect(useChatStore.getState().sending).toBe(true);
  });

  it('does not treat prior-turn assistant history as progress for a new send', async () => {
    let resolveSend: ((value: { runId: string }) => void) | undefined;
    gatewayRpcMock.mockImplementation((method: string) => {
      if (method === 'chat.send') {
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }
      if (method === 'chat.history') {
        return {
          messages: [
            { id: 'user-old', role: 'user', content: 'hello', timestamp: 1000 },
            { id: 'assistant-old', role: 'assistant', content: 'hi there', timestamp: 1500 },
          ],
        };
      }
      return { messages: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-idle',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-idle' }],
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
      runError: null,
      loading: false,
      thinkingLevel: null,
    });

    const sendPromise = useChatStore.getState().sendMessage('new question');
    await vi.advanceTimersByTimeAsync(121_000);

    expect(useChatStore.getState().runError).toContain('120 seconds');
    expect(useChatStore.getState().error).toBeNull();
    expect(useChatStore.getState().sending).toBe(true);

    resolveSend?.({ runId: 'run-idle-test-2' });
    await sendPromise;
  });
});
