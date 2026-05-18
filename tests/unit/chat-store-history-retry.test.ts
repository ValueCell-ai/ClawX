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
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 191_800);
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
});
