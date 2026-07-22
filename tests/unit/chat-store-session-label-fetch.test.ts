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
  hostApi: {
    media: {
      thumbnails: vi.fn(async () => ({})),
    },
    sessions: {
      summaries: (input: unknown) => hostApiFetchMock('/api/sessions/summaries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      history: vi.fn(async () => ({ messages: [] })),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true })),
    },
    chat: {
      sendWithMedia: vi.fn(async () => ({ success: true, result: { runId: 'run-media' } })),
    },
  },
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
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/sessions' || path === '/api/chat/history') {
        throw new Error('No route for mocked chat host API');
      }
      return { success: true, summaries: [] };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only includes persisted main sessions missing workspacePath when workspace hydration is requested', async () => {
    const { getSessionLabelHydrationCandidate } = await import('@/stores/chat/session-label-hydration');

    expect(getSessionLabelHydrationCandidate(
      { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
      {},
      {},
    )).toBeNull();

    expect(getSessionLabelHydrationCandidate(
      { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
      {},
      {},
      { includeWorkspacePath: true },
    )).toEqual({ sessionKey: 'agent:main:main', version: '1001|' });

    expect(getSessionLabelHydrationCandidate(
      { key: 'agent:main:main', displayName: 'agent:main:main', createdLocally: true },
      {},
      {},
    )).toBeNull();

    expect(getSessionLabelHydrationCandidate(
      { key: 'agent:main:main', displayName: 'agent:main:main' },
      {},
      {},
    )).toBeNull();
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

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/history') {
        throw new Error('No route for mocked chat host API');
      }
      if (path === '/api/chat/sessions') {
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
      return {
        success: true,
        summaries: [
          {
            sessionKey: 'agent:main:session-a',
            firstUserText: 'should hydrate immediately',
            lastTimestamp: 1_700_000_000_000,
          },
        ],
      };
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
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a', 'agent:main:main'] }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('should hydrate immediately');

    const backgroundHistoryCalls = gatewayRpcMock.mock.calls.filter(
      ([method, params]) => method === 'chat.history' && (params as Record<string, unknown> | undefined)?.limit === 1000,
    );
    expect(backgroundHistoryCalls).toHaveLength(0);
  });

  it('replaces OpenClaw UUID-date fallback labels with the first user prompt', async () => {
    const sessionKey = 'agent:main:session-fallback';
    const sessionId = '72e4b28b-8477-4e29-b57e-e14448fd42d0';
    const fallbackTitle = '72e4b28b (2026-07-22)';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: sessionKey,
              sessionId,
              label: fallbackTitle,
              displayName: fallbackTitle,
              derivedTitle: fallbackTitle,
              updatedAt: 1_784_700_425_523,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1_784_700_425_524 },
          ],
        };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/sessions/summaries') {
        return {
          success: true,
          summaries: [{
            sessionKey,
            firstUserText: '用浏览器打开B站',
            lastTimestamp: 1_784_700_425_523,
            workspacePath: '~/.openclaw/workspace',
          }],
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
      sessionLabels: { [sessionKey]: fallbackTitle },
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

    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('用浏览器打开B站');
    });
    expect(useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.sessionId)
      .toBe(sessionId);
  });

  it('strips ACP working-directory metadata from derived session titles', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nDerived prompt',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Derived prompt');
  });

  it('hydrates a cwd-only truncated derived title from the session summary', async () => {
    const sessionKey = 'agent:main:session-cwd-truncated';
    const workspacePath = '/Users/zhuoxu/workspace/clawx-playground';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: sessionKey,
              displayName: 'ACP',
              derivedTitle: '[Working directory: ~/workspace/clawx-playground]…',
              updatedAt: 1_783_791_638_956,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1_783_791_638_957 },
          ],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/sessions/summaries') {
        return {
          success: true,
          summaries: [{
            sessionKey,
            firstUserText: '当前目录有什么文件？解释。',
            lastTimestamp: 1_783_791_629_947,
            workspacePath,
          }],
        };
      }
      return { success: true, summaries: [] };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey, workspacePath }],
      messages: [],
      sessionLabels: { [sessionKey]: '…' },
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

    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('当前目录有什么文件？解释。');
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: [sessionKey, 'agent:main:main'] }),
    });
  });

  it('truncates the prompt after removing an overlong cwd envelope from a derived session title', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              derivedTitle: '[Working directory: /this/path/is/deliberately/made/longer/than/fifty/characters/for/the/test]\n\n012345678901234567890123456789012345678901234567890123456789',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe(
      '01234567890123456789012345678901234567890123456789…',
    );
  });

  it('preserves a consecutive user-authored cwd-looking line in a derived session title', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              derivedTitle: '[Working directory: /first]\n\n[Working directory: /user-authored]\n\nFinal title',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe(
      '[Working directory: /user-authored]\n\nFinal title',
    );
  });

  it('preserves a non-leading user-authored cwd-looking line after derived-title cleanup', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              derivedTitle: '[Working directory: /transport]\n\nKeep\n[Working directory: /user-authored]',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe(
      'Keep\n[Working directory: /user-authored]',
    );
  });

  it('removes a transport envelope exposed by metadata cleanup from derived session titles', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              derivedTitle: '[Working directory: /first]\n\nSender: test-user\n[Working directory: /second]\n\nFinal title',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Final title');
  });

  it('strips ACP working-directory metadata from host session summaries', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/sessions/summaries') {
        return {
          success: true,
          summaries: [{
            sessionKey: 'agent:main:session-a',
            firstUserText: '[Working directory: ~/.openclaw/workspace]\n\nSummary prompt',
            lastTimestamp: 1_700_000_000_000,
          }],
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

    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Summary prompt');
    });
  });

  it('preserves explicit session labels even when derived titles have ACP metadata', async () => {
    const explicitLabel = '[Working directory: /user-chosen]\n  Keep this manual title exactly as entered, including metadata-like text and whitespace.  ';
    const expectedDisplayLabel = '[Working directory: /user-chosen]\n  Keep this manu…';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              label: explicitLabel,
              derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nDerived prompt',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    const session = useChatStore.getState().sessions.find((item) => item.key === 'agent:main:session-a');
    expect(session?.label).toBe(explicitLabel);
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe(expectedDisplayLabel);
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']?.startsWith('[Working directory: /user-chosen]')).toBe(true);
  });

  it('keeps a formatted explicit backend label during history and summary refreshes', async () => {
    const sessionKey = 'agent:main:session-a';
    const explicitLabel = '[Working directory: /user-chosen]\nManual title  ';
    const expectedDisplayLabel = '[Working directory: /user-chosen]\nManual title';
    let summaryRequests = 0;

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: sessionKey, displayName: 'Session A', label: explicitLabel, updatedAt: 1000 },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
      }
      if (method === 'chat.history') {
        return {
          messages: [{
            role: 'user',
            content: '[Working directory: ~/.openclaw/workspace]\n\nHistory automatic title',
            timestamp: 1000,
          }],
        };
      }

      throw new Error(`Unexpected gateway RPC: ${method}`);
    });
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path !== '/api/sessions/summaries') return { success: true, summaries: [] };

      summaryRequests += 1;
      return summaryRequests === 1
        ? { success: true, summaries: [] }
        : {
            success: true,
            summaries: [{
              sessionKey,
              firstUserText: '[Working directory: ~/.openclaw/workspace]\n\nSummary automatic title',
              lastTimestamp: 2_000,
            }],
          };
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
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

    expect(useChatStore.getState().sessionLabels[sessionKey]).toBe(expectedDisplayLabel);

    // Ensure automatic title writes must honor the raw backend label, not a cache hit.
    const sessionLabels = { ...useChatStore.getState().sessionLabels };
    delete sessionLabels[sessionKey];
    useChatStore.setState({ sessionLabels });
    expect(useChatStore.getState().sessionLabels[sessionKey]).toBeUndefined();

    await vi.waitFor(() => {
      expect(summaryRequests).toBe(1);
    });

    await useChatStore.getState().loadHistory(false);

    await vi.waitFor(() => {
      const summaryCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/sessions/summaries');
      expect(summaryCalls).toHaveLength(2);
      expect(summaryCalls[1]).toEqual([
        '/api/sessions/summaries',
        {
          method: 'POST',
          body: JSON.stringify({ sessionKeys: [sessionKey, 'agent:main:main'] }),
        },
      ]);
      expect(useChatStore.getState().sessionLastActivity[sessionKey]).toBe(2_000);
    });

    const state = useChatStore.getState();
    expect(state.sessionLabels[sessionKey]).toBeUndefined();
    expect(state.sessions.find((session) => session.key === sessionKey)?.label).toBe(explicitLabel);
  });

  it('replaces a cached automatic title with a formatted explicit backend label', async () => {
    const sessionKey = 'agent:main:session-a';
    const explicitLabel = '[Working directory: /user-chosen]\n  This explicit backend title must replace the cached automatic title in full.  ';
    const expectedDisplayLabel = '[Working directory: /user-chosen]\n  This explicit …';
    let sessions: Array<Record<string, unknown>> = [
      {
        key: sessionKey,
        displayName: 'Session A',
        derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nDerived prompt',
        updatedAt: 1000,
      },
      { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
    ];
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions };
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

    expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('Derived prompt');

    sessions = [
      {
        key: sessionKey,
        displayName: 'Session A',
        label: explicitLabel,
        updatedAt: 1002,
      },
      { key: 'agent:main:main', displayName: 'Main', updatedAt: 1003 },
    ];
    vi.advanceTimersByTime(1_500);

    await useChatStore.getState().loadSessions();

    const state = useChatStore.getState();
    const session = state.sessions.find((item) => item.key === sessionKey);
    expect(state.sessionLabels[sessionKey]).toBe(expectedDisplayLabel);
    expect(state.sessionLabels[sessionKey]?.startsWith('[Working directory: /user-chosen]')).toBe(true);
    expect(session?.label).toBe(explicitLabel);
  });

  it('falls back to a normalized derived title when an explicit label is whitespace only', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-a',
              displayName: 'Session A',
              label: ' \n\t ',
              derivedTitle: '[Working directory: ~/.openclaw/workspace]\n\nDerived prompt',
              updatedAt: 1000,
            },
            { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
          ],
        };
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

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Derived prompt');
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

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/history') {
        throw new Error('No route for mocked chat host API');
      }
      if (path === '/api/chat/sessions') {
        return {
          success: true,
          result: {
            sessions: [
              { key: 'agent:main:session-a', displayName: 'ClawX', updatedAt: 1000 },
              { key: 'agent:main:session-b', displayName: 'ClawX', updatedAt: 1001 },
              { key: 'agent:main:main', displayName: 'ClawX', updatedAt: 1002 },
            ],
          },
        };
      }
      return {
        success: true,
        summaries: [
          { sessionKey: 'agent:main:session-a', firstUserText: 'Alpha title', lastTimestamp: 1_700_000_000_100 },
          { sessionKey: 'agent:main:session-b', firstUserText: 'Beta title', lastTimestamp: 1_700_000_000_200 },
        ],
      };
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
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a', 'agent:main:session-b', 'agent:main:main'] }),
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
      body: JSON.stringify({ sessionKeys: ['agent:main:session-a', 'agent:main:session-b', 'agent:main:session-c', 'agent:main:main'] }),
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

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/history') {
        throw new Error('No route for mocked chat host API');
      }
      if (path === '/api/chat/sessions') {
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
      return {
        success: true,
        summaries: [
          { sessionKey: 'agent:main:session-a', firstUserText: null, lastTimestamp: null },
        ],
      };
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

    const summaryCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/sessions/summaries');
    expect(summaryCalls).toHaveLength(1);
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

    let summaryCall = 0;
    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/history') {
        throw new Error('No route for mocked chat host API');
      }
      if (path === '/api/chat/sessions') {
        return {
          success: true,
          result: {
            sessions: [
              { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: sessionVersion },
              { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
            ],
          },
        };
      }
      summaryCall += 1;
      return summaryCall === 1
        ? {
            success: true,
            summaries: [
              { sessionKey: 'agent:main:session-a', firstUserText: null, lastTimestamp: null },
            ],
          }
        : {
            success: true,
            summaries: [
              { sessionKey: 'agent:main:session-a', firstUserText: 'new label', lastTimestamp: 1_700_000_000_999 },
            ],
          };
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

    const summaryCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/sessions/summaries');
    expect(summaryCalls[0]).toEqual([
      '/api/sessions/summaries',
      {
        method: 'POST',
        body: JSON.stringify({ sessionKeys: ['agent:main:session-a', 'agent:main:main'] }),
      },
    ]);
    expect(summaryCalls[1]).toEqual([
      '/api/sessions/summaries',
      {
        method: 'POST',
        body: JSON.stringify({ sessionKeys: ['agent:main:session-a'] }),
      },
    ]);
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('new label');
  });

  it('preserves user-renamed labels when visible session summaries refresh', async () => {
    gatewayRpcMock.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
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

      throw new Error(`Unexpected gateway RPC: ${method} ${JSON.stringify(params)}`);
    });

    hostApiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/sessions/summaries') {
        return {
          success: true,
          summaries: [
            {
              sessionKey: 'agent:main:session-a',
              firstUserText: 'original first message',
              lastTimestamp: 1_700_000_000_000,
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
      sessions: [
        { key: 'agent:main:session-a', displayName: 'Session A', updatedAt: 1000 },
        { key: 'agent:main:main', displayName: 'Main', updatedAt: 1001 },
      ],
      messages: [],
      sessionLabels: { 'agent:main:session-a': 'Custom name' },
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
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Custom name');
  });
});
