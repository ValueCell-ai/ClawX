import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, sessionDeleteMock, sessionRenameMock, sessionSummariesMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  sessionRenameMock: vi.fn(),
  sessionSummariesMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({ rpc: gatewayRpcMock }),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      summaries: sessionSummariesMock,
      delete: sessionDeleteMock,
      rename: sessionRenameMock,
    },
  },
}));

type SummaryResponse = {
  success: boolean;
  summaries: Array<{
    sessionKey: string;
    firstUserText: string;
    lastTimestamp: number;
    workspacePath: string;
  }>;
};

function deferredSummary(): {
  promise: Promise<SummaryResponse>;
  resolve: (value: SummaryResponse) => void;
} {
  let resolve!: (value: SummaryResponse) => void;
  const promise = new Promise<SummaryResponse>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function deferredCatalog(): {
  promise: Promise<Record<string, unknown>>;
  resolve: (value: Record<string, unknown>) => void;
} {
  let resolve!: (value: Record<string, unknown>) => void;
  const promise = new Promise<Record<string, unknown>>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('chat session catalog startup', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    sessionDeleteMock.mockReset().mockResolvedValue({ success: true });
    sessionRenameMock.mockReset().mockResolvedValue({ success: true });
    sessionSummariesMock.mockReset().mockResolvedValue({ success: true, summaries: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes only session catalog and selection state', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const state = useChatStore.getState();

    expect(state).not.toHaveProperty('messages');
    expect(state).not.toHaveProperty('loadHistory');
    expect(state).not.toHaveProperty('sendMessage');
    expect(state).not.toHaveProperty('handleRuntimeEvent');
    expect(state).toMatchObject({
      sessions: expect.any(Array),
      currentSessionKey: expect.any(String),
      currentAgentId: expect.any(String),
      sessionLabels: expect.any(Object),
      sessionLastActivity: expect.any(Object),
    });
  });

  it('opens the latest non-cron session instead of a cron heartbeat session', async () => {
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [
        { key: 'agent:main:cron:heartbeat', label: 'Main Agent heartbeat', updatedAt: 9_000 },
        { key: 'agent:main:session-a', displayName: 'PDF summary', updatedAt: 5_000 },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-a');
    expect(gatewayRpcMock).toHaveBeenCalledTimes(1);
    expect(gatewayRpcMock).toHaveBeenCalledWith('sessions.list', {
      includeDerivedTitles: true,
      includeLastMessage: true,
    });
  });

  it('hydrates workspace identity and title activity from session summaries', async () => {
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [{ key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 }],
    });
    sessionSummariesMock.mockResolvedValueOnce({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: 'Summarize this workspace',
        lastTimestamp: 1_700_000_000_000,
        workspacePath: '/Users/alex/workspace/ClawX',
      }],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();
    await vi.waitFor(() => {
      expect(useChatStore.getState().sessionLabels['agent:main:session-a']).toBe('Summarize this workspace');
    });

    expect(useChatStore.getState().sessions[0]?.workspacePath).toBe('/Users/alex/workspace/ClawX');
    expect(useChatStore.getState().sessionLastActivity['agent:main:session-a']).toBe(1_700_000_000_000);
  });

  it('does not publish a persisted fallback before its workspace summary resolves', async () => {
    const summary = deferredSummary();
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [{ key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 }],
    });
    sessionSummariesMock.mockReturnValueOnce(summary.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions();
    await vi.waitFor(() => expect(sessionSummariesMock).toHaveBeenCalledWith({
      sessionKeys: ['agent:main:session-a'],
    }));

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: 'agent:main:main',
      sessions: [],
    });

    summary.resolve({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: 'Hydrated title',
        lastTimestamp: 1_700_000_000_000,
        workspacePath: '/workspace/hydrated',
      }],
    });
    await loading;

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: 'agent:main:session-a',
      sessions: [expect.objectContaining({
        key: 'agent:main:session-a',
        workspacePath: '/workspace/hydrated',
      })],
      sessionLabels: { 'agent:main:session-a': 'Hydrated title' },
      sessionLastActivity: { 'agent:main:session-a': 1_700_000_000_000 },
    });
  });

  it('does not undo a session switch while selected workspace hydration is pending', async () => {
    const selectedKey = 'agent:main:session-a';
    const switchedKey = 'agent:main:session-b';
    const summary = deferredSummary();
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [
        { key: selectedKey, displayName: 'Chat A', updatedAt: 5_000 },
        { key: switchedKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
    });
    sessionSummariesMock.mockReturnValueOnce(summary.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: selectedKey,
      currentAgentId: 'main',
      sessions: [
        { key: selectedKey, displayName: 'Chat A', updatedAt: 5_000 },
        { key: switchedKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
      sessionLabels: { [switchedKey]: 'Chat B' },
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await vi.waitFor(() => expect(sessionSummariesMock).toHaveBeenCalledWith({
      sessionKeys: [selectedKey],
    }));
    useChatStore.getState().switchSession(switchedKey);

    summary.resolve({
      success: true,
      summaries: [{
        sessionKey: selectedKey,
        firstUserText: 'Stale A',
        lastTimestamp: 1_700_000_000_000,
        workspacePath: '/workspace/a',
      }],
    });
    await loading;

    expect(gatewayRpcMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().currentSessionKey).toBe(switchedKey);
    expect(useChatStore.getState().sessions.find((session) => session.key === switchedKey)).toMatchObject({
      workspacePath: '/workspace/b',
    });
  });

  it('does not undo a locally created and selected session while workspace hydration is pending', async () => {
    const selectedKey = 'agent:main:session-a';
    const localKey = 'agent:main:session-1711111111111';
    const summary = deferredSummary();
    vi.spyOn(Date, 'now').mockReturnValue(1_711_111_111_111);
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [{ key: selectedKey, displayName: 'Chat A', updatedAt: 5_000 }],
    });
    sessionSummariesMock.mockReturnValueOnce(summary.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: selectedKey,
      currentAgentId: 'main',
      sessions: [{ key: selectedKey, displayName: 'Chat A', updatedAt: 5_000 }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await vi.waitFor(() => expect(sessionSummariesMock).toHaveBeenCalledTimes(1));
    useChatStore.getState().newSession();
    useChatStore.getState().selectAcpSession(localKey, '/workspace/local');

    summary.resolve({
      success: true,
      summaries: [{
        sessionKey: selectedKey,
        firstUserText: 'Stale A',
        lastTimestamp: 1_700_000_000_000,
        workspacePath: '/workspace/a',
      }],
    });
    await loading;

    expect(gatewayRpcMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().currentSessionKey).toBe(localKey);
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: localKey,
      createdLocally: true,
      workspacePath: '/workspace/local',
    }));
  });

  it('does not resurrect a successfully deleted session after delayed workspace hydration', async () => {
    const deletedKey = 'agent:main:session-a';
    const survivorKey = 'agent:main:session-b';
    const summary = deferredSummary();
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [
        { key: deletedKey, displayName: 'Chat A', updatedAt: 5_000 },
        { key: survivorKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
    });
    sessionSummariesMock.mockReturnValueOnce(summary.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: deletedKey,
      currentAgentId: 'main',
      sessions: [
        { key: deletedKey, displayName: 'Chat A', updatedAt: 5_000 },
        { key: survivorKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
      sessionLabels: { [deletedKey]: 'Chat A', [survivorKey]: 'Chat B' },
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await vi.waitFor(() => expect(sessionSummariesMock).toHaveBeenCalledTimes(1));
    await expect(useChatStore.getState().deleteSession(deletedKey)).resolves.toEqual({ success: true });

    summary.resolve({
      success: true,
      summaries: [{
        sessionKey: deletedKey,
        firstUserText: 'Stale A',
        lastTimestamp: 1_700_000_000_000,
        workspacePath: '/workspace/a',
      }],
    });
    await loading;

    expect(gatewayRpcMock).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().currentSessionKey).toBe(survivorKey);
    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);
    expect(useChatStore.getState().sessionLabels[deletedKey]).toBeUndefined();
  });

  it('does not publish a stale sessions.list response after a local delete', async () => {
    const deletedKey = 'agent:main:session-a';
    const survivorKey = 'agent:main:session-b';
    const staleCatalog = deferredCatalog();
    const refreshedCatalog = deferredCatalog();
    gatewayRpcMock
      .mockReturnValueOnce(staleCatalog.promise)
      .mockReturnValueOnce(refreshedCatalog.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: deletedKey,
      currentAgentId: 'main',
      sessions: [
        { key: deletedKey, label: 'Chat A', workspacePath: '/workspace/a', updatedAt: 5_000 },
        { key: survivorKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
      sessionLabels: { [deletedKey]: 'Chat A', [survivorKey]: 'Chat B' },
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true });
    await vi.waitFor(() => expect(gatewayRpcMock).toHaveBeenCalledTimes(1));
    await expect(useChatStore.getState().deleteSession(deletedKey)).resolves.toEqual({ success: true });

    staleCatalog.resolve({
      ts: 1,
      sessions: [
        { key: deletedKey, label: 'Chat A', workspacePath: '/workspace/a', updatedAt: 5_000 },
        { key: survivorKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 },
      ],
    });
    await vi.waitFor(() => expect(gatewayRpcMock).toHaveBeenCalledTimes(2));
    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);
    expect(useChatStore.getState().currentSessionKey).toBe(survivorKey);

    refreshedCatalog.resolve({
      ts: 2,
      sessions: [{ key: survivorKey, label: 'Chat B', workspacePath: '/workspace/b', updatedAt: 4_000 }],
    });
    await loading;

    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);
    expect(useChatStore.getState().sessionLabels[deletedKey]).toBeUndefined();
  });

  it('does not publish a stale sessions.list label after a local rename', async () => {
    const sessionKey = 'agent:main:session-a';
    const staleCatalog = deferredCatalog();
    const refreshedCatalog = deferredCatalog();
    gatewayRpcMock
      .mockReturnValueOnce(staleCatalog.promise)
      .mockReturnValueOnce(refreshedCatalog.promise);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: sessionKey,
      currentAgentId: 'main',
      sessions: [{ key: sessionKey, label: 'Old title', workspacePath: '/workspace/a', updatedAt: 5_000 }],
      sessionLabels: { [sessionKey]: 'Old title' },
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true });
    await vi.waitFor(() => expect(gatewayRpcMock).toHaveBeenCalledTimes(1));
    await useChatStore.getState().renameSession(sessionKey, 'New title');

    staleCatalog.resolve({
      ts: 1,
      sessions: [{ key: sessionKey, label: 'Old title', workspacePath: '/workspace/a', updatedAt: 5_000 }],
    });
    await vi.waitFor(() => expect(gatewayRpcMock).toHaveBeenCalledTimes(2));
    expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('New title');
    expect(useChatStore.getState().sessions[0]?.label).toBe('New title');

    refreshedCatalog.resolve({
      ts: 2,
      sessions: [{ key: sessionKey, label: 'New title', workspacePath: '/workspace/a', updatedAt: 5_000 }],
    });
    await loading;

    expect(useChatStore.getState().sessionLabels[sessionKey]).toBe('New title');
    expect(useChatStore.getState().sessions[0]?.label).toBe('New title');
  });

  it('preserves a local ACP placeholder and mirrored workspace across catalog refreshes', async () => {
    const pendingKey = 'agent:main:session-1711111111111';
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [
        { key: pendingKey, displayName: 'ACP', updatedAt: 6_000 },
        { key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    useChatStore.getState().selectAcpSession(pendingKey, '/Users/alex/workspace/ClawX');

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe(pendingKey);
    expect(useChatStore.getState().sessions.find((session) => session.key === pendingKey)).toMatchObject({
      createdLocally: true,
      workspacePath: '/Users/alex/workspace/ClawX',
    });
  });

  it('starts a fresh local session when the selected session is heartbeat-only', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [
        {
          key: 'agent:main:main',
          displayName: 'ClawX',
          lastMessagePreview: '[OpenClaw heartbeat poll]',
          updatedAt: 9_000,
        },
        {
          key: 'agent:main:session-a',
          displayName: 'Visible desktop chat',
          lastMessagePreview: 'Summarize the repository structure',
          updatedAt: 5_000,
        },
      ],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: 'agent:main:session-1711111111111',
      createdLocally: true,
    }));
  });

  it.each([
    ['empty', []],
    ['cron-only', [{ key: 'agent:main:cron:heartbeat', label: 'heartbeat', updatedAt: 9_000 }]],
  ])('creates a local default placeholder for an %s catalog', async (_catalogType, sessions) => {
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions,
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:main');
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: 'agent:main:main',
      createdLocally: true,
    }));
  });

  it('preserves an acknowledged ACP session across stale catalogs until canonical visibility', async () => {
    const pendingKey = 'agent:main:session-created';
    const survivorKey = 'agent:main:session-existing';
    gatewayRpcMock
      .mockResolvedValueOnce({
        ts: 1,
        sessions: [{ key: survivorKey, displayName: 'Existing', workspacePath: '/workspace/existing' }],
      })
      .mockResolvedValueOnce({
        ts: 2,
        sessions: [{ key: survivorKey, displayName: 'Existing', workspacePath: '/workspace/existing' }],
      })
      .mockResolvedValueOnce({
        ts: 3,
        sessions: [
          { key: pendingKey, displayName: 'Created' },
          { key: survivorKey, displayName: 'Existing', workspacePath: '/workspace/existing' },
        ],
      })
      .mockResolvedValueOnce({
        ts: 4,
        sessions: [{ key: survivorKey, displayName: 'Existing', workspacePath: '/workspace/existing' }],
      });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: pendingKey,
      currentAgentId: 'main',
      sessions: [{
        key: pendingKey,
        displayName: pendingKey,
        createdLocally: true,
        workspacePath: '/workspace/created',
      }],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    useChatStore.getState().acknowledgeAcpSessionCreated(pendingKey, '/workspace/created');

    for (let staleSnapshot = 0; staleSnapshot < 2; staleSnapshot += 1) {
      await useChatStore.getState().loadSessions({ force: true });
      expect(useChatStore.getState().currentSessionKey).toBe(pendingKey);
      expect(useChatStore.getState().sessions.find((session) => session.key === pendingKey)).toMatchObject({
        key: pendingKey,
        workspacePath: '/workspace/created',
      });
      expect(useChatStore.getState().sessions.find((session) => session.key === pendingKey)).not.toHaveProperty(
        'createdLocally',
        true,
      );
    }

    await useChatStore.getState().loadSessions({ force: true });
    expect(useChatStore.getState().currentSessionKey).toBe(pendingKey);
    expect(useChatStore.getState().sessions.find((session) => session.key === pendingKey)).toMatchObject({
      key: pendingKey,
      displayName: 'Created',
      workspacePath: '/workspace/created',
    });

    await useChatStore.getState().loadSessions({ force: true });
    expect(useChatStore.getState().currentSessionKey).toBe(survivorKey);
    expect(useChatStore.getState().sessions.some((session) => session.key === pendingKey)).toBe(false);
  });

  it('clears acknowledged-session protection when a canonical event observes the key', async () => {
    const pendingKey = 'agent:main:session-event-created';
    const survivorKey = 'agent:main:session-existing';
    gatewayRpcMock.mockResolvedValue({
      ts: 2,
      sessions: [{ key: survivorKey, displayName: 'Existing', workspacePath: '/workspace/existing' }],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: pendingKey,
      currentAgentId: 'main',
      sessions: [{ key: pendingKey, createdLocally: true, workspacePath: '/workspace/created' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    useChatStore.getState().acknowledgeAcpSessionCreated(pendingKey, '/workspace/created');
    useChatStore.getState().handleSessionsChanged({
      ts: 1,
      sessionKey: pendingKey,
      session: { key: pendingKey, displayName: 'Created by event' },
    });

    await useChatStore.getState().loadSessions({ force: true });

    expect(useChatStore.getState().currentSessionKey).toBe(survivorKey);
    expect(useChatStore.getState().sessions.some((session) => session.key === pendingKey)).toBe(false);
  });
});
