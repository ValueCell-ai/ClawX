import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearErrorRecoveryTimer = vi.fn();
const clearHistoryPoll = vi.fn();
const collectToolUpdates = vi.fn(() => []);
const extractImagesAsAttachedFiles = vi.fn(() => []);
const extractMediaRefs = vi.fn(() => []);
const extractRawFilePaths = vi.fn(() => []);
const getMessageText = vi.fn(() => '');
const getToolCallFilePath = vi.fn(() => undefined);
const hasErrorRecoveryTimer = vi.fn(() => false);
const hasNonToolAssistantContent = vi.fn(() => true);
const isInternalMessage = vi.fn(() => false);
const isToolOnlyMessage = vi.fn(() => false);
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult' || role === 'toolResult' || role === 'tool_result');
const makeAttachedFile = vi.fn((ref: { filePath: string; mimeType: string }, source?: 'user-upload' | 'tool-result' | 'message-ref') => ({
  fileName: ref.filePath.split('/').pop() || 'file',
  mimeType: ref.mimeType,
  fileSize: 0,
  preview: null,
  filePath: ref.filePath,
  source,
}));
const normalizeStreamingMessage = vi.fn((message: unknown) => message);
const setErrorRecoveryTimer = vi.fn();
const snapshotStreamingAssistantMessage = vi.fn((currentStream: unknown) => currentStream ? [currentStream] : []);
const upsertToolStatuses = vi.fn((_current, updates) => updates);

vi.mock('@/stores/chat/helpers', () => ({
  clearErrorRecoveryTimer: (...args: unknown[]) => clearErrorRecoveryTimer(...args),
  clearHistoryPoll: (...args: unknown[]) => clearHistoryPoll(...args),
  collectToolUpdates: (...args: unknown[]) => collectToolUpdates(...args),
  extractImagesAsAttachedFiles: (...args: unknown[]) => extractImagesAsAttachedFiles(...args),
  extractMediaRefs: (...args: unknown[]) => extractMediaRefs(...args),
  extractRawFilePaths: (...args: unknown[]) => extractRawFilePaths(...args),
  getMessageText: (...args: unknown[]) => getMessageText(...args),
  getToolCallFilePath: (...args: unknown[]) => getToolCallFilePath(...args),
  hasErrorRecoveryTimer: (...args: unknown[]) => hasErrorRecoveryTimer(...args),
  hasNonToolAssistantContent: (...args: unknown[]) => hasNonToolAssistantContent(...args),
  isInternalMessage: (...args: unknown[]) => isInternalMessage(...args),
  isToolOnlyMessage: (...args: unknown[]) => isToolOnlyMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  makeAttachedFile: (...args: unknown[]) => makeAttachedFile(...args),
  normalizeStreamingMessage: (...args: unknown[]) => normalizeStreamingMessage(...args),
  setErrorRecoveryTimer: (...args: unknown[]) => setErrorRecoveryTimer(...args),
  snapshotStreamingAssistantMessage: (...args: unknown[]) => snapshotStreamingAssistantMessage(...args),
  upsertToolStatuses: (...args: unknown[]) => upsertToolStatuses(...args),
}));

type ChatLikeState = {
  sending: boolean;
  activeRunId: string | null;
  error: string | null;
  streamingMessage: unknown | null;
  streamingTools: unknown[];
  messages: Array<Record<string, unknown>>;
  pendingToolImages: unknown[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  streamingText: string;
  loadHistory: ReturnType<typeof vi.fn>;
};

function makeHarness(initial?: Partial<ChatLikeState>) {
  let state: ChatLikeState = {
    sending: false,
    activeRunId: null,
    error: 'stale error',
    streamingMessage: null,
    streamingTools: [],
    messages: [],
    pendingToolImages: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    streamingText: '',
    loadHistory: vi.fn(),
    ...initial,
  };

  const set = (partial: Partial<ChatLikeState> | ((s: ChatLikeState) => Partial<ChatLikeState>)) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  return { set, get, read: () => state };
}

describe('chat runtime event handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hasErrorRecoveryTimer.mockReturnValue(false);
    collectToolUpdates.mockReturnValue([]);
    normalizeStreamingMessage.mockImplementation((message: unknown) => message);
    snapshotStreamingAssistantMessage.mockImplementation((currentStream: unknown) => currentStream ? [currentStream as Record<string, unknown>] : []);
    upsertToolStatuses.mockImplementation((_current, updates) => updates);
  });

  it('marks sending on started event', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ sending: false, activeRunId: null, error: 'err' });

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'started', 'run-1');
    const next = h.read();
    expect(next.sending).toBe(true);
    expect(next.activeRunId).toBe('run-1');
    expect(next.error).toBeNull();
  });

  it('applies delta event and clears stale error when recovery timer exists', async () => {
    hasErrorRecoveryTimer.mockReturnValue(true);
    collectToolUpdates.mockReturnValue([{ name: 'tool-a', status: 'running', updatedAt: 1 }]);

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      error: 'old',
      streamingTools: [],
      streamingMessage: { role: 'assistant', content: 'old' },
    });
    const event = { message: { role: 'assistant', content: 'delta' } };

    handleRuntimeEventState(h.set as never, h.get as never, event, 'delta', 'run-2');
    const next = h.read();
    expect(clearErrorRecoveryTimer).toHaveBeenCalledTimes(1);
    expect(next.error).toBeNull();
    expect(next.streamingMessage).toEqual(event.message);
    expect(next.streamingTools).toEqual([{ name: 'tool-a', status: 'running', updatedAt: 1 }]);
  });

  it('loads history when final event has no message', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness();

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'final', 'run-3');
    const next = h.read();
    expect(next.pendingFinal).toBe(true);
    expect(next.streamingMessage).toBeNull();
    expect(h.read().loadHistory).toHaveBeenCalledTimes(1);
  });

  it('marks tool-result attachments before appending them to the final assistant reply', async () => {
    extractMediaRefs.mockReturnValue([{ filePath: '/tmp/CHECKLIST.md', mimeType: 'text/markdown' }]);
    getMessageText.mockReturnValue('[media attached: /tmp/CHECKLIST.md (text/markdown) | /tmp/CHECKLIST.md]');
    hasNonToolAssistantContent.mockReturnValue(true);

    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      pendingToolImages: [],
      streamingMessage: {
        role: 'assistant',
        id: 'streaming-assistant',
        content: [{ type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/CHECKLIST.md' } }],
      },
    });

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        content: [{ type: 'text', text: '[media attached: /tmp/CHECKLIST.md (text/markdown) | /tmp/CHECKLIST.md]' }],
      },
    }, 'final', 'run-4');

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'assistant',
        id: 'final-assistant',
        content: [{ type: 'text', text: 'Done.' }],
      },
    }, 'final', 'run-4');

    expect(h.read().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'final-assistant',
        _attachedFiles: [
          expect.objectContaining({
            filePath: '/tmp/CHECKLIST.md',
            source: 'tool-result',
          }),
        ],
      }),
    ]));
  });

  it('handles error event and finalizes immediately when not sending', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ sending: false, activeRunId: 'r1', lastUserMessageAt: 123 });

    handleRuntimeEventState(h.set as never, h.get as never, { errorMessage: 'boom' }, 'error', 'r1');
    const next = h.read();
    expect(clearHistoryPoll).toHaveBeenCalledTimes(1);
    expect(next.error).toBe('boom');
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.lastUserMessageAt).toBeNull();
    expect(next.streamingTools).toEqual([]);
  });

  it('delta with empty object does not overwrite existing streamingMessage', async () => {
    // Regression test for multi-model fallback: Gateway emits {} during model switch.
    // The existing streamingMessage content must be preserved.
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const existing = { role: 'assistant', content: [{ type: 'text', text: 'hello' }] };
    const h = makeHarness({ streamingMessage: existing });

    handleRuntimeEventState(h.set as never, h.get as never, { message: {} }, 'delta', 'run-x');
    expect(h.read().streamingMessage).toEqual(existing);
  });

  it('delta with role-only object does not overwrite existing streamingMessage', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const existing = { role: 'assistant', content: [{ type: 'text', text: 'partial' }] };
    const h = makeHarness({ streamingMessage: existing });

    handleRuntimeEventState(h.set as never, h.get as never, { message: { role: 'assistant' } }, 'delta', 'run-x');
    expect(h.read().streamingMessage).toEqual(existing);
  });

  it('delta with empty object is accepted when streamingMessage is null (initial state)', async () => {
    // When streaming hasn't started yet, even an empty delta should be let
    // through so the UI can show a typing indicator immediately.
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ streamingMessage: null });

    handleRuntimeEventState(h.set as never, h.get as never, { message: { role: 'assistant' } }, 'delta', 'run-x');
    expect(h.read().streamingMessage).toEqual({ role: 'assistant' });
  });

  it('delta with actual content replaces streamingMessage', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const existing = { role: 'assistant', content: [{ type: 'text', text: 'old' }] };
    const incoming = { role: 'assistant', content: [{ type: 'text', text: 'new' }] };
    const h = makeHarness({ streamingMessage: existing });

    handleRuntimeEventState(h.set as never, h.get as never, { message: incoming }, 'delta', 'run-x');
    expect(h.read().streamingMessage).toEqual(incoming);
  });

  it('normalizes cumulative text and thinking blocks while streaming', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({ streamingMessage: null });
    normalizeStreamingMessage.mockReturnValue({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'thinking 1 2 3' },
        { type: 'text', text: '1 2 3' },
      ],
    });

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'thinking 1' },
          { type: 'thinking', thinking: 'thinking 1 2' },
          { type: 'thinking', thinking: 'thinking 1 2 3' },
          { type: 'text', text: '1' },
          { type: 'text', text: '1 2' },
          { type: 'text', text: '1 2 3' },
        ],
      },
    }, 'delta', 'run-stream');

    expect(h.read().streamingMessage).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'thinking 1 2 3' },
        { type: 'text', text: '1 2 3' },
      ],
    });
  });

  it('snapshots normalized streaming content when tool results arrive', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    normalizeStreamingMessage.mockImplementation((message: unknown) => {
      const msg = message as { role: string; id: string; content: unknown[] };
      return {
        ...msg,
        content: [
          { type: 'thinking', thinking: 'thinking 1 2 3' },
          { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/demo.md' } },
          { type: 'text', text: '1 2 3' },
        ],
      };
    });
    snapshotStreamingAssistantMessage.mockImplementation((currentStream: unknown) => {
      const msg = currentStream as { role: string; id: string; content: unknown[] };
      return [{
        ...msg,
        content: [
          { type: 'thinking', thinking: 'thinking 1 2 3' },
          { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/demo.md' } },
          { type: 'text', text: '1 2 3' },
        ],
      }];
    });
    const h = makeHarness({
      streamingMessage: {
        role: 'assistant',
        id: 'streaming-assistant',
        content: [
          { type: 'thinking', thinking: 'thinking 1' },
          { type: 'thinking', thinking: 'thinking 1 2 3' },
          { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/demo.md' } },
          { type: 'text', text: '1' },
          { type: 'text', text: '1 2 3' },
        ],
      },
    });

    handleRuntimeEventState(h.set as never, h.get as never, {
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'done' }],
      },
    }, 'final', 'run-normalize');

    expect(h.read().messages).toEqual([
      {
        role: 'assistant',
        id: 'streaming-assistant',
        content: [
          { type: 'thinking', thinking: 'thinking 1 2 3' },
          { type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: '/tmp/demo.md' } },
          { type: 'text', text: '1 2 3' },
        ],
      },
    ]);
  });

  it('clears runtime state on aborted event', async () => {
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'r2',
      streamingText: 'abc',
      pendingFinal: true,
      lastUserMessageAt: 5,
      pendingToolImages: [{ fileName: 'x' }],
    });

    handleRuntimeEventState(h.set as never, h.get as never, {}, 'aborted', 'r2');
    const next = h.read();
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.streamingText).toBe('');
    expect(next.pendingFinal).toBe(false);
    expect(next.lastUserMessageAt).toBeNull();
    expect(next.pendingToolImages).toEqual([]);
  });

  it('filters out NO_REPLY internal message in final event without adding to messages', async () => {
    isInternalMessage.mockReturnValueOnce(true);
    const { handleRuntimeEventState } = await import('@/stores/chat/runtime-event-handlers');
    const h = makeHarness({
      sending: true,
      activeRunId: 'r3',
      messages: [{ role: 'user', content: 'hello', id: 'u1' }],
    });

    handleRuntimeEventState(
      h.set as never,
      h.get as never,
      { message: { role: 'assistant', content: 'NO_REPLY', id: 'a1' } },
      'final',
      'r3',
    );
    const next = h.read();
    // NO_REPLY must not appear in messages
    expect(next.messages).toEqual([{ role: 'user', content: 'hello', id: 'u1' }]);
    expect(next.sending).toBe(false);
    expect(next.activeRunId).toBeNull();
    expect(next.pendingFinal).toBe(false);
    expect(next.streamingText).toBe('');
    expect(next.streamingMessage).toBeNull();
    // Should trigger history reload
    expect(clearHistoryPoll).toHaveBeenCalled();
    expect(next.loadHistory).toHaveBeenCalledWith(true);
  });
});
