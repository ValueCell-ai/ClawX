import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();
const hostApiFetchMock = vi.fn();
const gatewayStoreGetStateMock = vi.fn();
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

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => gatewayStoreGetStateMock(),
  },
}));

vi.mock('@/stores/chat/helpers', () => ({
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  enrichWithCachedImages: (...args: unknown[]) => enrichWithCachedImages(...args),
  enrichWithToolResultFiles: (...args: unknown[]) => enrichWithToolResultFiles(...args),
  getLatestOptimisticUserMessage: (messages: Array<{ role: string; timestamp?: number }>, userTimestampMs: number) =>
    [...messages].reverse().find(
      (message) => message.role === 'user'
        && (!message.timestamp || Math.abs(toMs(message.timestamp) - userTimestampMs) < 5000),
    ),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isInternalMessage: (...args: unknown[]) => isInternalMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  loadMissingPreviews: (...args: unknown[]) => loadMissingPreviews(...args),
  matchesOptimisticUserMessage: (
    candidate: { role: string; timestamp?: number; content?: unknown; _attachedFiles?: Array<{ filePath?: string; fileName?: string; mimeType?: string; fileSize?: number }> },
    optimistic: { role: string; timestamp?: number; content?: unknown; _attachedFiles?: Array<{ filePath?: string; fileName?: string; mimeType?: string; fileSize?: number }> },
    optimisticTimestampMs: number,
  ) => {
    if (candidate.role !== 'user') return false;
    const normalizeText = (content: unknown) => (typeof content === 'string' ? content : '')
      .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const candidateText = normalizeText(candidate.content);
    const optimisticText = normalizeText(optimistic.content);
    const candidateAttachments = (candidate._attachedFiles || []).map((file) => file.filePath || `${file.fileName}|${file.mimeType}|${file.fileSize}`).sort().join('::');
    const optimisticAttachments = (optimistic._attachedFiles || []).map((file) => file.filePath || `${file.fileName}|${file.mimeType}|${file.fileSize}`).sort().join('::');
    const hasCandidateTimestamp = candidate.timestamp != null;
    const timestampMatches = hasCandidateTimestamp
      ? Math.abs(toMs(candidate.timestamp as number) - optimisticTimestampMs) < 5000
      : false;

    if (candidateText && optimisticText && candidateText === optimisticText && candidateAttachments === optimisticAttachments) return true;
    if (candidateText && optimisticText && candidateText === optimisticText && (!hasCandidateTimestamp || timestampMatches)) return true;
    if (candidateAttachments && optimisticAttachments && candidateAttachments === optimisticAttachments && (!hasCandidateTimestamp || timestampMatches)) return true;
    return false;
  },
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
    vi.resetModules();
    vi.useRealTimers();
    invokeIpcMock.mockResolvedValue({ success: true, result: { messages: [] } });
    hostApiFetchMock.mockResolvedValue({ messages: [] });
    gatewayStoreGetStateMock.mockReturnValue({
      status: { state: 'running', port: 18789, connectedAt: Date.now() },
    });
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

  it('preserves existing messages when history refresh fails for the current session', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      messages: [
        {
          role: 'assistant',
          content: 'still here',
          timestamp: 1773281732,
        },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockRejectedValueOnce(new Error('Gateway unavailable'));

    await actions.loadHistory();

    expect(h.read().messages.map((message) => message.content)).toEqual(['still here']);
    expect(h.read().error).toBe('Gateway unavailable');
    expect(h.read().loading).toBe(false);
  });

  it('retries the first foreground startup history load after a timeout and then succeeds', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);
    gatewayStoreGetStateMock.mockReturnValue({
      status: { state: 'running', port: 18789, connectedAt: Date.now() - 40_000 },
    });

    invokeIpcMock
      .mockResolvedValueOnce({ success: false, error: 'RPC timeout: chat.history' })
      .mockResolvedValueOnce({
        success: true,
        result: {
          messages: [
            { role: 'assistant', content: 'restored after retry', timestamp: 1000 },
          ],
        },
      });

    const loadPromise = actions.loadHistory();
    await vi.runAllTimersAsync();
    await loadPromise;

    expect(invokeIpcMock).toHaveBeenNthCalledWith(
      1,
      'gateway:rpc',
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    );
    expect(invokeIpcMock).toHaveBeenNthCalledWith(
      2,
      'gateway:rpc',
      'chat.history',
      { sessionKey: 'agent:main:main', limit: 200 },
      35_000,
    );
    expect(h.read().messages.map((message) => message.content)).toEqual(['restored after retry']);
    expect(h.read().error).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[chat.history] startup retry scheduled',
      expect.objectContaining({
        sessionKey: 'agent:main:main',
        attempt: 1,
        errorKind: 'timeout',
      }),
    );
    warnSpy.mockRestore();
  });

  it('stops retrying once the load no longer belongs to the active session', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockImplementationOnce(async () => {
      h.set({
        currentSessionKey: 'agent:main:other',
        loading: false,
        messages: [{ role: 'assistant', content: 'other session', timestamp: 1001 }],
      });
      return { success: false, error: 'RPC timeout: chat.history' };
    });

    await actions.loadHistory();

    expect(invokeIpcMock).toHaveBeenCalledTimes(1);
    expect(h.read().currentSessionKey).toBe('agent:main:other');
    expect(h.read().messages.map((message) => message.content)).toEqual(['other session']);
    expect(h.read().error).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('surfaces a final error only after startup retry budget is exhausted', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValue({
      success: false,
      error: 'RPC timeout: chat.history',
    });

    const loadPromise = actions.loadHistory();
    await vi.runAllTimersAsync();
    await loadPromise;

    expect(invokeIpcMock).toHaveBeenCalledTimes(5);
    expect(h.read().messages).toEqual([]);
    expect(h.read().error).toBe('RPC timeout: chat.history');
    expect(warnSpy).toHaveBeenCalledWith(
      '[chat.history] startup retry exhausted',
      expect.objectContaining({
        sessionKey: 'agent:main:main',
      }),
    );
    warnSpy.mockRestore();
  });

  it('does not retry quiet history refreshes', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValue({
      success: false,
      error: 'RPC timeout: chat.history',
    });

    await actions.loadHistory(true);

    expect(invokeIpcMock).toHaveBeenCalledTimes(1);
    expect(h.read().error).toBeNull();
  });

  it('does not retry non-retryable startup failures', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValue({
      success: false,
      error: 'Validation failed: bad session key',
    });

    await actions.loadHistory();

    expect(invokeIpcMock).toHaveBeenCalledTimes(1);
    expect(h.read().error).toBe('Validation failed: bad session key');
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

  it('drops stale history results after the user switches sessions', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    let resolveHistory: ((value: unknown) => void) | null = null;
    invokeIpcMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve;
    }));

    const h = makeHarness({
      currentSessionKey: 'agent:main:session-a',
      messages: [
        {
          role: 'assistant',
          content: 'session b content',
          timestamp: 1773281732,
        },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    const loadPromise = actions.loadHistory();
    h.set({
      currentSessionKey: 'agent:main:session-b',
      messages: [
        {
          role: 'assistant',
          content: 'session b content',
          timestamp: 1773281733,
        },
      ],
    });
    resolveHistory?.({
      success: true,
      result: {
        messages: [
          {
            role: 'assistant',
            content: 'stale session a content',
            timestamp: 1773281734,
          },
        ],
      },
    });

    await loadPromise;

    expect(h.read().currentSessionKey).toBe('agent:main:session-b');
    expect(h.read().messages.map((message) => message.content)).toEqual(['session b content']);
  });

  it('preserves newer same-session messages when preview hydration finishes later', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    let releasePreviewHydration: (() => void) | null = null;
    loadMissingPreviews.mockImplementationOnce(async (messages) => {
      await new Promise<void>((resolve) => {
        releasePreviewHydration = () => {
          messages[0]!._attachedFiles = [
            {
              fileName: 'image.png',
              mimeType: 'image/png',
              fileSize: 42,
              preview: 'data:image/png;base64,abc',
              filePath: '/tmp/image.png',
            },
          ];
          resolve();
        };
      });
      return true;
    });

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            id: 'history-1',
            role: 'assistant',
            content: 'older message',
            timestamp: 1000,
          },
        ],
      },
    });

    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    await actions.loadHistory();

    h.set((state) => ({
      messages: [
        ...state.messages,
        {
          id: 'newer-1',
          role: 'assistant',
          content: 'newer message',
          timestamp: 1001,
        },
      ],
    }));

    releasePreviewHydration?.();
    await Promise.resolve();

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'older message',
      'newer message',
    ]);
    expect(h.read().messages[0]?._attachedFiles?.[0]?.preview).toBe('data:image/png;base64,abc');
  });

  it('does not append an optimistic duplicate when history already includes the user message without timestamp', async () => {
    const { createHistoryActions } = await import('@/stores/chat/history-actions');
    const h = makeHarness({
      currentSessionKey: 'agent:main:main',
      sending: true,
      lastUserMessageAt: 1_773_281_732_000,
      messages: [
        {
          role: 'user',
          content: '[Fri 2026-03-13 10:00 GMT+8] Open browser, search for tech news, and take a screenshot',
          timestamp: 1_773_281_732,
        },
      ],
    });
    const actions = createHistoryActions(h.set as never, h.get as never);

    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        messages: [
          {
            role: 'user',
            content: 'Open browser, search for tech news, and take a screenshot',
          },
          {
            role: 'assistant',
            content: 'Processing',
            timestamp: 1_773_281_733,
          },
        ],
      },
    });

    await actions.loadHistory(true);

    expect(h.read().messages.map((message) => message.content)).toEqual([
      'Open browser, search for tech news, and take a screenshot',
      'Processing',
    ]);
  });
});
