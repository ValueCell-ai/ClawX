import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

type ChatLikeState = {
  currentSessionKey: string;
  sessions: Array<{ key: string; displayName?: string; updatedAt?: number }>;
  messages: Array<{ role: string; timestamp?: number; content?: unknown }>;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: unknown[];
  activeRunId: string | null;
  error: string | null;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  pendingToolImages: unknown[];
  loadHistory: ReturnType<typeof vi.fn>;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    currentSessionKey: 'agent:main:main',
    sessions: [{ key: 'agent:main:main' }],
    messages: [],
    sessionLabels: {},
    sessionLastActivity: {},
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    activeRunId: null,
    error: null,
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    loadHistory: vi.fn(),
    ...initial,
  };
  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat session actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeIpcMock.mockResolvedValue({ success: true });
  });

  it('switchSession preserves non-main session that has activity history', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [{ key: 'agent:foo:session-a' }, { key: 'agent:foo:main' }],
      messages: [],
      sessionLabels: { 'agent:foo:session-a': 'A' },
      sessionLastActivity: { 'agent:foo:session-a': 1 },
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.switchSession('agent:foo:main');
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:foo:main');
    // Session with labels and activity should NOT be removed even though messages is empty,
    // because messages get cleared eagerly during switchSession before loadHistory completes.
    expect(next.sessions.find((s) => s.key === 'agent:foo:session-a')).toBeDefined();
    expect(next.sessionLabels['agent:foo:session-a']).toBe('A');
    expect(next.sessionLastActivity['agent:foo:session-a']).toBe(1);
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('switchSession removes truly empty non-main session (no activity, no labels)', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-b',
      sessions: [{ key: 'agent:foo:session-b' }, { key: 'agent:foo:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.switchSession('agent:foo:main');
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:foo:main');
    // Truly empty session (no labels, no activity) should be cleaned up
    expect(next.sessions.find((s) => s.key === 'agent:foo:session-b')).toBeUndefined();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('deleteSession updates current session and keeps sidebar consistent', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:session-a',
      sessions: [{ key: 'agent:foo:session-a' }, { key: 'agent:foo:main' }],
      sessionLabels: { 'agent:foo:session-a': 'A' },
      sessionLastActivity: { 'agent:foo:session-a': 1 },
      messages: [{ role: 'user' }],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    await actions.deleteSession('agent:foo:session-a');
    const next = h.read();
    expect(invokeIpcMock).toHaveBeenCalledWith('session:delete', 'agent:foo:session-a');
    expect(next.currentSessionKey).toBe('agent:foo:main');
    expect(next.sessions.map((s) => s.key)).toEqual(['agent:foo:main']);
    expect(next.sessionLabels['agent:foo:session-a']).toBeUndefined();
    expect(next.sessionLastActivity['agent:foo:session-a']).toBeUndefined();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('newSession creates a canonical session key and clears transient state', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:foo:main',
      sessions: [{ key: 'agent:foo:main' }],
      messages: [{ role: 'assistant' }],
      streamingText: 'streaming',
      activeRunId: 'r1',
      pendingFinal: true,
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    actions.newSession();
    const next = h.read();
    expect(next.currentSessionKey).toBe('agent:foo:session-1711111111111');
    expect(next.sessions.some((s) => s.key === 'agent:foo:session-1711111111111')).toBe(true);
    expect(next.messages).toEqual([]);
    expect(next.streamingText).toBe('');
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    nowSpy.mockRestore();
  });

  it('seeds sessionLastActivity from backend updatedAt metadata', async () => {
    const { createSessionActions } = await import('@/stores/chat/session-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sessions: [],
    });
    const actions = createSessionActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        sessions: [
          {
            key: 'agent:main:main',
            displayName: 'Main',
            updatedAt: 1773281700000,
          },
          {
            key: 'agent:main:cron:job-1',
            label: 'Cron: Drink water',
            updatedAt: 1773281731621,
          },
        ],
      },
    });

    await actions.loadSessions();

    expect(h.read().sessionLastActivity['agent:main:main']).toBe(1773281700000);
    expect(h.read().sessionLastActivity['agent:main:cron:job-1']).toBe(1773281731621);
    expect(h.read().sessions.find((session) => session.key === 'agent:main:cron:job-1')?.updatedAt).toBe(1773281731621);
  });
});

