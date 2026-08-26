import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock, hostApiFetchMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: runtimeStatus,
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    sessions: {
      summaries: (input: unknown) => hostApiFetchMock('/api/sessions/summaries', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      delete: vi.fn(async () => ({ success: true })),
      rename: vi.fn(async () => ({ success: true })),
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

  it('restores a newly created session and its first-prompt title after catalog reconciliation removes the placeholder', async () => {
    const sessionKey = 'agent:main:session-raced';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [],
      sessionLabels: {},
    });

    useChatStore.getState().acknowledgeAcpSessionCreated(
      sessionKey,
      '/workspace',
      'Investigate the sidebar title race',
    );

    expect(useChatStore.getState().sessions).toContainEqual({
      key: sessionKey,
      displayName: sessionKey,
      workspacePath: '/workspace',
    });
    expect(useChatStore.getState().sessionLabels[sessionKey]).toBe(
      'Investigate the sidebar title race',
    );
  });

  it('keeps only the default main session special during label hydration', async () => {
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
    )).toEqual({ sessionKey: 'agent:main:main', version: '0|1001|' });

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

    expect(getSessionLabelHydrationCandidate(
      {
        key: 'agent:main:main',
        displayName: 'ClawX',
        derivedTitle: '[Working directory: ~/.openclaw/workspace]…',
        workspacePath: '~/.openclaw/workspace',
        updatedAt: 1001,
      },
      {},
      {},
      { includeWorkspacePath: true },
    )).toEqual({
      sessionKey: 'agent:main:main',
      version: '0|1001|[Working directory: ~/.openclaw/workspace]…',
    });

    expect(getSessionLabelHydrationCandidate(
      {
        key: 'agent:research:main',
        displayName: 'ACP',
        workspacePath: '/research-workspace',
        updatedAt: 1001,
      },
      {},
      {},
      { includeWorkspacePath: true },
    )).toEqual({ sessionKey: 'agent:research:main', version: '0|1001|' });
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

  it('hydrates a cwd-only truncated title for the canonical main session with a known workspace', async () => {
    const sessionKey = 'agent:main:main';
    const workspacePath = '~/.openclaw/workspace';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [{
            key: sessionKey,
            displayName: 'ClawX',
            derivedTitle: '[Working directory: ~/.openclaw/workspace]…',
            workspacePath,
            updatedAt: 1_787_722_940_140,
          }],
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
            firstUserText: '[Working directory: ~/.openclaw/workspace]\n\n给我写一个脚本',
            lastTimestamp: 1_787_722_940_140,
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
      expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('给我写一个脚本');
    });
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/sessions/summaries', {
      method: 'POST',
      body: JSON.stringify({ sessionKeys: [sessionKey] }),
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

  it('keeps a formatted explicit backend label during repeated catalog and summary refreshes', async () => {
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

    await useChatStore.getState().loadSessions({ force: true });

    expect(hostApiFetchMock.mock.calls.filter(
      ([path]) => path === '/api/sessions/summaries',
    )).toHaveLength(1);

    const state = useChatStore.getState();
    expect(state.sessionLabels[sessionKey]).toBe(expectedDisplayLabel);
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
            { key: 'agent:research:main', displayName: 'ACP', workspacePath: '/research-workspace', updatedAt: 1002 },
            { key: 'agent:main:main', displayName: 'ClawX', updatedAt: 1003 },
          ],
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
              { key: 'agent:research:main', displayName: 'ACP', workspacePath: '/research-workspace', updatedAt: 1002 },
              { key: 'agent:main:main', displayName: 'ClawX', updatedAt: 1003 },
            ],
          },
        };
      }
      return {
        success: true,
        summaries: [
          { sessionKey: 'agent:main:session-a', firstUserText: 'Alpha title', lastTimestamp: 1_700_000_000_100 },
          { sessionKey: 'agent:main:session-b', firstUserText: 'Beta title', lastTimestamp: 1_700_000_000_200 },
          { sessionKey: 'agent:research:main', firstUserText: 'Research title', lastTimestamp: 1_700_000_000_300 },
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
      body: JSON.stringify({
        sessionKeys: ['agent:main:session-a', 'agent:main:session-b', 'agent:research:main', 'agent:main:main'],
      }),
    });
    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Alpha title');
    expect(useChatStore.getState().sessionLabels['agent:main:session-b']).toBe('Beta title');
    expect(useChatStore.getState().sessionLabels['agent:research:main']).toBe('Research title');
  });

  it('hydrates missing session labels and activity from host summaries', async () => {
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

    await useChatStore.getState().loadSessions({ force: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Custom name');
  });

  it('drops a stale background summary after buffered delete-recreate and applies the new incarnation', async () => {
    const sessionKey = 'agent:main:recreated-background';
    const unrelatedKey = 'agent:main:unrelated-background';
    const secondList = deferred<Record<string, unknown>>();
    const oldSummary = deferred<Record<string, unknown>>();
    const newSummary = deferred<Record<string, unknown>>();
    let listCalls = 0;
    let summaryCalls = 0;

    gatewayRpcMock.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({ messages: [] });
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve({
          ts: 10,
          sessions: [
            { key: sessionKey, updatedAt: 1_700_000_000_000 },
            { key: unrelatedKey, label: 'Unrelated', workspacePath: '/unrelated' },
          ],
        });
      }
      return secondList.promise;
    });
    hostApiFetchMock.mockImplementation((path: string) => {
      if (path !== '/api/sessions/summaries') return Promise.resolve({ success: true });
      summaryCalls += 1;
      return summaryCalls === 1 ? oldSummary.promise : newSummary.promise;
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [
        { key: sessionKey, updatedAt: 1_700_000_000_000 },
        { key: unrelatedKey, label: 'Unrelated', workspacePath: '/unrelated' },
      ],
      sessionLabels: { [unrelatedKey]: 'Unrelated' },
      sessionLastActivity: { [unrelatedKey]: 1_700_000_009_000 },
    });

    const firstLoading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await vi.waitFor(() => expect(summaryCalls).toBe(1));
    const reloading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 2 });
    oldSummary.resolve({
      success: true,
      summaries: [{
        sessionKey,
        firstUserText: 'stale title',
        lastTimestamp: 1_700_000_001_000,
        workspacePath: '/stale',
      }],
    });
    await vi.waitFor(() => expect(listCalls).toBe(2));
    useChatStore.getState().handleSessionsChanged({ sessionKey, reason: 'delete', ts: 21 });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey,
      ts: 22,
      session: { key: sessionKey, updatedAt: 1_700_000_000_000 },
    });
    secondList.resolve({
      ts: 20,
      sessions: [
        { key: sessionKey, updatedAt: 1_700_000_000_000 },
        { key: unrelatedKey, label: 'Unrelated', workspacePath: '/unrelated' },
      ],
    });
    await vi.waitFor(() => expect(summaryCalls).toBe(2));
    expect(useChatStore.getState().sessionLabels[sessionKey]).toBeUndefined();
    expect(useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.workspacePath).toBeUndefined();

    newSummary.resolve({
      success: true,
      summaries: [{
        sessionKey,
        firstUserText: 'fresh title',
        lastTimestamp: 1_700_000_002_000,
        workspacePath: '/fresh',
      }],
    });
    await Promise.all([firstLoading, reloading]);
    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('fresh title');
    });
    expect(useChatStore.getState().sessionLastActivity[sessionKey]).toBe(1_700_000_002_000);
    expect(useChatStore.getState().sessions.find((session) => session.key === sessionKey)?.workspacePath).toBe('/fresh');
    expect(useChatStore.getState().sessionLabels[unrelatedKey]).toBe('Unrelated');
    expect(useChatStore.getState().sessionLastActivity[unrelatedKey]).toBe(1_700_000_009_000);
  });

});
