import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, sessionDeleteMock, sessionRenameMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  sessionRenameMock: vi.fn(),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: { getState: () => ({ rpc: gatewayRpcMock }) },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      summaries: vi.fn(async () => ({ success: true, summaries: [] })),
      delete: sessionDeleteMock,
      rename: sessionRenameMock,
    },
  },
}));

describe('chat session management', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    sessionDeleteMock.mockReset().mockResolvedValue({ success: true });
    sessionRenameMock.mockReset().mockResolvedValue({ success: true });
  });

  it('drops only an abandoned local placeholder when switching sessions', async () => {
    const localKey = 'agent:main:session-local';
    const persistedKey = 'agent:main:persisted';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: localKey,
      currentAgentId: 'main',
      sessions: [
        { key: localKey, createdLocally: true, workspacePath: '/draft' },
        { key: persistedKey, workspacePath: '/persisted' },
      ],
      sessionLabels: { [localKey]: 'Draft' },
      sessionLastActivity: { [localKey]: 10 },
    });

    useChatStore.getState().switchSession(persistedKey);

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: persistedKey,
      sessions: [{ key: persistedKey, workspacePath: '/persisted' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    useChatStore.getState().switchSession('agent:main:other');
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({ key: persistedKey }));
  });

  it('keeps workspace identity when selecting and acknowledging an ACP session', async () => {
    const key = 'agent:research:session-new';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    useChatStore.getState().selectAcpSession(key, '/workspace/research');
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: key,
      currentAgentId: 'research',
    });
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key,
      workspacePath: '/workspace/research',
      createdLocally: true,
    }));

    useChatStore.getState().acknowledgeAcpSessionCreated(key, '/workspace/research', 'Investigate issue');

    expect(useChatStore.getState().sessions.find((session) => session.key === key)).toMatchObject({
      workspacePath: '/workspace/research',
    });
    expect(useChatStore.getState().sessions.find((session) => session.key === key)).not.toHaveProperty('createdLocally');
    expect(useChatStore.getState().sessionLabels[key]).toBe('Investigate issue');
  });

  it('deletes an acknowledged session that is awaiting catalog confirmation', async () => {
    const key = 'agent:research:session-created';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: key,
      currentAgentId: 'research',
      sessions: [{ key, createdLocally: true, workspacePath: '/workspace/research' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    useChatStore.getState().acknowledgeAcpSessionCreated(key, '/workspace/research');

    await expect(useChatStore.getState().deleteSession(key)).resolves.toEqual({ success: true });

    expect(useChatStore.getState().currentSessionKey).not.toBe(key);
    expect(useChatStore.getState().sessions.some((session) => session.key === key)).toBe(false);
  });

  it('hard-deletes workspace sessions sequentially and selects a survivor', async () => {
    let resolveFirst!: (value: { success: boolean }) => void;
    sessionDeleteMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ success: true });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-a',
      sessions: [
        { key: 'agent:main:session-a', workspacePath: '/missing' },
        { key: 'agent:other:session-b', workspacePath: '/missing' },
        { key: 'agent:main:session-c', workspacePath: '/kept' },
      ],
      sessionLabels: {
        'agent:main:session-a': 'A',
        'agent:other:session-b': 'B',
        'agent:main:session-c': 'C',
      },
      sessionLastActivity: {},
    });

    const deletion = useChatStore.getState().deleteSessions([
      'agent:main:session-a',
      'agent:other:session-b',
    ]);
    await vi.waitFor(() => expect(sessionDeleteMock).toHaveBeenCalledTimes(1));
    resolveFirst({ success: true });

    await expect(deletion).resolves.toEqual({
      deletedKeys: ['agent:main:session-a', 'agent:other:session-b'],
      failedKeys: [],
    });
    expect(sessionDeleteMock.mock.calls.map(([key]) => key)).toEqual([
      'agent:main:session-a',
      'agent:other:session-b',
    ]);
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: 'agent:main:session-c',
      currentAgentId: 'main',
      sessionLabels: { 'agent:main:session-c': 'C' },
    });
  });

  it('creates a local placeholder instead of selecting cron or channel survivors after bulk delete', async () => {
    const currentKey = 'agent:research:session-current';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: currentKey,
      currentAgentId: 'research',
      sessions: [
        { key: currentKey },
        { key: 'agent:main:cron:heartbeat', updatedAt: 9_000 },
        { key: 'agent:main:feishu:ou_abc', updatedAt: 8_000 },
      ],
      sessionLabels: { [currentKey]: 'Delete me' },
      sessionLastActivity: { [currentKey]: 123 },
    });

    await expect(useChatStore.getState().deleteSessions([currentKey])).resolves.toEqual({
      deletedKeys: [currentKey],
      failedKeys: [],
    });

    const state = useChatStore.getState();
    expect(state).toMatchObject({
      currentAgentId: 'research',
      sessionLabels: {},
      sessionLastActivity: {},
    });
    expect(state.currentSessionKey).toMatch(/^agent:research:session-\d+$/);
    expect(state.sessions).toEqual([
      { key: 'agent:main:cron:heartbeat', updatedAt: 9_000 },
      { key: 'agent:main:feishu:ou_abc', updatedAt: 8_000 },
      expect.objectContaining({ key: state.currentSessionKey, createdLocally: true }),
    ]);
  });

  it('creates a local placeholder when bulk delete leaves no survivors', async () => {
    const currentKey = 'agent:research:session-current';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: currentKey,
      currentAgentId: 'research',
      sessions: [{ key: currentKey }],
      sessionLabels: { [currentKey]: 'Delete me' },
      sessionLastActivity: { [currentKey]: 123 },
    });

    await expect(useChatStore.getState().deleteSessions([currentKey])).resolves.toEqual({
      deletedKeys: [currentKey],
      failedKeys: [],
    });

    const state = useChatStore.getState();
    expect(state).toMatchObject({
      currentAgentId: 'research',
      sessionLabels: {},
      sessionLastActivity: {},
    });
    expect(state.currentSessionKey).toMatch(/^agent:research:session-\d+$/);
    expect(state.sessions).toEqual([
      expect.objectContaining({ key: state.currentSessionKey, createdLocally: true }),
    ]);
    expect(state.currentSessionKey).not.toBe('agent:main:main');
  });

  it('keeps sessions whose hard delete fails', async () => {
    sessionDeleteMock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'locked' });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-c',
      sessions: [
        { key: 'agent:main:session-a' },
        { key: 'agent:main:session-b' },
        { key: 'agent:main:session-c' },
      ],
      sessionLabels: {
        'agent:main:session-a': 'A',
        'agent:main:session-b': 'B',
        'agent:main:session-c': 'C',
      },
      sessionLastActivity: {},
    });

    await expect(useChatStore.getState().deleteSessions([
      'agent:main:session-a',
      'agent:main:session-b',
    ])).resolves.toEqual({
      deletedKeys: ['agent:main:session-a'],
      failedKeys: ['agent:main:session-b'],
    });
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-b',
      'agent:main:session-c',
    ]);
  });

  it('cleans persisted attention after a successful hard delete', async () => {
    const deletedKey = 'agent:main:delete-me';
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }, { key: deletedKey }],
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [deletedKey]: { observedBusy: false, unread: true } },
      visibleSessionKey: null,
    });

    await expect(useChatStore.getState().deleteSession(deletedKey)).resolves.toEqual({ success: true });

    expect(useSessionAttentionStore.getState().bySessionKey[deletedKey]).toBeUndefined();
    expect(window.localStorage.getItem('clawx.session-attention')).not.toContain(deletedKey);
  });

  it('retains session state when a single hard delete reports failure', async () => {
    const key = 'agent:main:delete-failed';
    sessionDeleteMock.mockResolvedValueOnce({ success: false, error: 'locked' });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: key,
      currentAgentId: 'main',
      sessions: [{ key, workspacePath: '/workspace' }],
      sessionLabels: { [key]: 'Keep me' },
      sessionLastActivity: { [key]: 123 },
    });

    await expect(useChatStore.getState().deleteSession(key)).resolves.toEqual({
      success: false,
      error: 'locked',
    });
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: key,
      currentAgentId: 'main',
      sessions: [{ key, workspacePath: '/workspace' }],
      sessionLabels: { [key]: 'Keep me' },
      sessionLastActivity: { [key]: 123 },
    });
  });

  it('retains session state when a single hard delete throws', async () => {
    const key = 'agent:research:delete-threw';
    sessionDeleteMock.mockRejectedValueOnce(new Error('offline'));
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: key,
      currentAgentId: 'research',
      sessions: [{ key }],
      sessionLabels: { [key]: 'Keep me too' },
      sessionLastActivity: { [key]: 456 },
    });

    await expect(useChatStore.getState().deleteSession(key)).resolves.toEqual({
      success: false,
      error: 'Error: offline',
    });
    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: key,
      currentAgentId: 'research',
      sessions: [{ key }],
      sessionLabels: { [key]: 'Keep me too' },
      sessionLastActivity: { [key]: 456 },
    });
  });

  it('persists a rename and updates the catalog label', async () => {
    const key = 'agent:main:rename-me';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key, label: 'Old' }],
      sessionLabels: { [key]: 'Old' },
      sessionLastActivity: {},
    });

    await useChatStore.getState().renameSession(key, '  New title  ');

    expect(sessionRenameMock).toHaveBeenCalledWith(key, 'New title');
    expect(useChatStore.getState().sessions[0]?.label).toBe('New title');
    expect(useChatStore.getState().sessionLabels[key]).toBe('New title');
  });
});
