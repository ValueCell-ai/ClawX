import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();
const clearHistoryPoll = vi.fn();
const enrichWithCachedImages = vi.fn((messages) => messages);
const enrichWithToolResultFiles = vi.fn((messages) => messages);
const getMessageText = vi.fn((content: unknown) => typeof content === 'string' ? content : '');
const hasNonToolAssistantContent = vi.fn((message: { content?: unknown } | undefined) => {
  if (!message) return false;
  return typeof message.content === 'string' ? message.content.trim().length > 0 : true;
});
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult' || role === 'tool_result');
const isInternalMessage = vi.fn((msg: { role?: unknown; content?: unknown }) => {
  if (msg.role === 'system') return true;
  if (msg.role === 'assistant') {
    const text = typeof msg.content === 'string' ? msg.content : '';
    if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/.test(text)) return true;
  }
  return false;
});
const loadMissingPreviews = vi.fn(async () => false);
const toMs = vi.fn((ts: number) => ts < 1e12 ? ts * 1000 : ts);

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/chat/helpers', () => ({
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  enrichWithCachedImages: (...args: unknown[]) => enrichWithCachedImages(...args),
  enrichWithToolResultFiles: (...args: unknown[]) => enrichWithToolResultFiles(...args),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isInternalMessage: (...args: unknown[]) => isInternalMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  loadMissingPreviews: (...args: unknown[]) => loadMissingPreviews(...args),
  toMs: (...args: unknown[]) => toMs(...args as Parameters<typeof toMs>),
}));

type ChatLikeState = {
  currentSessionKey: string;
  messages: Array<{ role: string; timestamp?: number; content?: unknown; _attachedFiles?: unknown[] }>;
  loading: boolean;
  error: string | null;
  sending: boolean;
  lastUserMessageAt: number | null;
  pendingFinal: boolean;
  sessionLabels: Record<string, string>;
  sessionLastActivity: Record<string, number>;
  thinkingLevel: string | null;
  activeRunId: string | null;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    currentSessionKey: 'agent:main:main',
    messages: [],
    loading: false,
    error: null,
    sending: false,
    lastUserMessageAt: null,
    pendingFinal: false,
    sessionLabels: {},
    sessionLastActivity: {},
    thinkingLevel: null,
    activeRunId: null,
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat history actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeIpcMock.mockResolvedValue({ success: true, result: { messages: [] } });
    hostApiFetchMock.mockResolvedValue({ messages: [] });
  });

  it('uses cron session fallback when gateway history is empty', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:cron:job-1',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    hostApiFetchMock.mockResolvedValueOnce({
      messages: [
        {
          id: 'cron-meta-job-1',
          role: 'system',
          content: 'Scheduled task: Drink water',
          timestamp: 1773281731495,
        },
        {
          id: 'cron-run-1',
          role: 'assistant',
          content: 'Drink water 💧',
          timestamp: 1773281732751,
        },
      ],
    });

    await actions.loadHistory();

    expect(hostApiFetchMock).toHaveBeenCalledWith(
      '/api/cron/session-history?sessionKey=agent%3Amain%3Acron%3Ajob-1&limit=200',
    );
    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Drink water 💧',
    ]);
    expect(h.read().sessionLastActivity['agent:main:cron:job-1']).toBe(1773281732751);
    expect(h.read().loading).toBe(false);
  });

  it('does not use cron fallback for normal sessions', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    await actions.loadHistory();

    expect(hostApiFetchMock).not.toHaveBeenCalled();
    expect(h.read().messages).toEqual([]);
    expect(h.read().loading).toBe(false);
  });

  it('filters out system messages from loaded history', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'system', content: 'Gateway restarted', timestamp: 1001 },
          { role: 'assistant', content: 'Hi there!', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Hi there!',
    ]);
  });

  it('filters out HEARTBEAT_OK assistant messages', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'HEARTBEAT_OK', timestamp: 1001 },
          { role: 'assistant', content: 'Real response', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Real response',
    ]);
  });

  it('filters out NO_REPLY assistant messages', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'Hello', timestamp: 1000 },
          { role: 'assistant', content: 'NO_REPLY', timestamp: 1001 },
          { role: 'assistant', content: 'Actual answer', timestamp: 1002 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'Hello',
      'Actual answer',
    ]);
  });

  it('keeps normal assistant messages that contain HEARTBEAT_OK as substring', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness();
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          { role: 'user', content: 'What is HEARTBEAT_OK?', timestamp: 1000 },
          { role: 'assistant', content: 'HEARTBEAT_OK is a status code', timestamp: 1001 },
        ],
      },
    });

    await actions.loadHistory();

    expect(h.read().messages.map((m) => m.content)).toEqual([
      'What is HEARTBEAT_OK?',
      'HEARTBEAT_OK is a status code',
    ]);
  });
});
