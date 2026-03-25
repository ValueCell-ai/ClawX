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
const isToolOnlyMessage = vi.fn(() => false);
const isToolResultRole = vi.fn((role: unknown) => role === 'toolresult');
const makeAttachedFile = vi.fn((ref: { filePath: string; mimeType: string }) => ({
  fileName: ref.filePath.split('/').pop() || 'file',
  mimeType: ref.mimeType,
  fileSize: 0,
  preview: null,
  filePath: ref.filePath,
}));
const setErrorRecoveryTimer = vi.fn();
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
  isToolOnlyMessage: (...args: unknown[]) => isToolOnlyMessage(...args),
  isToolResultRole: (...args: unknown[]) => isToolResultRole(...args),
  makeAttachedFile: (...args: unknown[]) => makeAttachedFile(...args),
  setErrorRecoveryTimer: (...args: unknown[]) => setErrorRecoveryTimer(...args),
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
});

