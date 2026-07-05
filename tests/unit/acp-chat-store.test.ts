import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  loadAcpSession: vi.fn(),
  sendAcpPrompt: vi.fn(),
  cancelAcpSession: vi.fn(),
  respondAcpPermission: vi.fn(),
}));

const hostEventsMock = vi.hoisted(() => ({
  updateListener: null as ((payload: unknown) => void) | null,
  permissionListener: null as ((payload: unknown) => void) | null,
  onAcpSessionUpdate: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.updateListener = listener;
    return () => { hostEventsMock.updateListener = null; };
  }),
  onAcpPermissionRequest: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.permissionListener = listener;
    return () => { hostEventsMock.permissionListener = null; };
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    chat: {
      loadAcpSession: hostApiMock.loadAcpSession,
      sendAcpPrompt: hostApiMock.sendAcpPrompt,
      cancelAcpSession: hostApiMock.cancelAcpSession,
      respondAcpPermission: hostApiMock.respondAcpPermission,
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onAcpSessionUpdate: hostEventsMock.onAcpSessionUpdate,
    onAcpPermissionRequest: hostEventsMock.onAcpPermissionRequest,
  },
}));

async function importStore() {
  return import('@/stores/acp-chat-session');
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe('ACP Chat store', () => {
  beforeEach(() => {
    vi.resetModules();
    hostApiMock.loadAcpSession.mockReset().mockResolvedValue({ success: true, generation: 1 });
    hostApiMock.sendAcpPrompt.mockReset().mockResolvedValue({ success: true });
    hostApiMock.cancelAcpSession.mockReset().mockResolvedValue({ success: true });
    hostApiMock.respondAcpPermission.mockReset().mockResolvedValue({ success: true });
    hostEventsMock.updateListener = null;
    hostEventsMock.permissionListener = null;
    hostEventsMock.onAcpSessionUpdate.mockClear();
    hostEventsMock.onAcpPermissionRequest.mockClear();
  });

  it('loads a session, resets the timeline, subscribes once, and ignores stale generation updates', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    ensureAcpChatSubscriptions();

    await expect(useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' })).resolves.toBe(true);
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'fresh' },
        },
      },
    });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual(['msg-1:0']);

    hostApiMock.loadAcpSession.mockResolvedValueOnce({ success: true, generation: 2 });
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'stale-msg',
          content: { type: 'text', text: 'stale' },
        },
      },
    });

    expect(hostEventsMock.onAcpSessionUpdate).toHaveBeenCalledTimes(1);
    expect(hostEventsMock.onAcpPermissionRequest).toHaveBeenCalledTimes(1);
    expect(hostApiMock.loadAcpSession).toHaveBeenLastCalledWith({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:s1',
      cwd: '/repo',
      generation: 2,
      loading: false,
      error: null,
    });
    expect(useAcpChatSessionStore.getState().timeline).toMatchObject({
      sessionId: 'agent:pi:s1',
      loadGeneration: 2,
      itemOrder: [],
    });
  });

  it('applies matching generation updates', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'fresh' },
        },
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual(['msg-1:0']);
    expect(useAcpChatSessionStore.getState().timeline.itemsById['msg-1:0']).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      parts: [{ kind: 'markdown', text: 'fresh' }],
    });
  });

  it('ignores stale loadSession completion after a newer load', async () => {
    const staleLoad = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    const currentLoad = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.loadAcpSession
      .mockReset()
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(currentLoad.promise);
    const { useAcpChatSessionStore } = await importStore();

    const staleLoadPromise = useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });
    const currentLoadPromise = useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-b' });
    currentLoad.resolve({ success: true, generation: 2 });
    await currentLoadPromise;
    staleLoad.resolve({ success: false, error: 'stale load failed', generation: 1 });
    await staleLoadPromise;

    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:s2',
      cwd: '/repo-b',
      generation: 2,
      loading: false,
      error: null,
    });
    expect(useAcpChatSessionStore.getState().timeline).toMatchObject({
      sessionId: 'agent:pi:s2',
      loadGeneration: 2,
      itemOrder: [],
    });
  });

  it('inserts permission requests and responds with the selected outcome', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'Need permission.' },
        },
      },
    });

    hostEventsMock.permissionListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      requestId: 'perm-1',
      request: {
        sessionId: 'agent:pi:s1',
        toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual(['msg-1:0', 'permission:perm-1']);
    expect(useAcpChatSessionStore.getState().timeline.openMessageSegments).toEqual({});
    expect(useAcpChatSessionStore.getState().timeline.itemsById['permission:perm-1']).toMatchObject({
      kind: 'permission',
      requestId: 'perm-1',
      toolCallId: 'tool-1',
      title: 'Edit file',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      status: 'pending',
    });

    await useAcpChatSessionStore.getState().respondPermission('perm-1', 'allow-once');

    expect(hostApiMock.respondAcpPermission).toHaveBeenCalledWith({
      sessionKey: 'agent:pi:s1',
      requestId: 'perm-1',
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    expect(useAcpChatSessionStore.getState().timeline.itemsById['permission:perm-1']).toMatchObject({
      kind: 'permission',
      status: 'selected',
    });
  });

  it('sends prompts, cancels the active session, and clears errors', async () => {
    hostApiMock.sendAcpPrompt.mockResolvedValueOnce({ success: false, error: 'prompt failed' });
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    await expect(useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello',
      media: [{ filePath: '/repo/image.png', fileName: 'image.png', mimeType: 'image/png' }],
    })).resolves.toBe(false);
    expect(hostApiMock.sendAcpPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello',
      media: [{ filePath: '/repo/image.png', fileName: 'image.png', mimeType: 'image/png' }],
      messageId: expect.any(String),
    });
    expect(useAcpChatSessionStore.getState()).toMatchObject({
      sending: false,
      error: 'prompt failed',
    });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);

    useAcpChatSessionStore.getState().clearError();
    expect(useAcpChatSessionStore.getState().error).toBeNull();

    await useAcpChatSessionStore.getState().cancel();
    expect(hostApiMock.cancelAcpSession).toHaveBeenCalledWith({ sessionKey: 'agent:pi:s1' });
    expect(useAcpChatSessionStore.getState().cancelling).toBe(false);
  });

  it('adds an optimistic user segment immediately before ACP echoes a user update', async () => {
    const prompt = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.sendAcpPrompt.mockReturnValueOnce(prompt.promise);
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    const sendPromise = useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello from user',
      media: [{ filePath: '/repo/notes.txt', fileName: 'notes.txt', mimeType: 'text/plain' }],
    });

    const state = useAcpChatSessionStore.getState();
    expect(state.timeline.itemOrder).toHaveLength(1);
    const itemId = state.timeline.itemOrder[0];
    const item = state.timeline.itemsById[itemId];
    expect(item).toMatchObject({
      kind: 'message-segment',
      role: 'user',
      segmentIndex: 0,
      parts: [
        { kind: 'markdown', text: 'hello from user' },
        { kind: 'file', path: '/repo/notes.txt', name: 'notes.txt', mimeType: 'text/plain' },
      ],
    });
    expect(hostApiMock.sendAcpPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello from user',
      media: [{ filePath: '/repo/notes.txt', fileName: 'notes.txt', mimeType: 'text/plain' }],
      messageId: expect.any(String),
    });

    prompt.resolve({ success: true });
    await expect(sendPromise).resolves.toBe(true);
  });

  it('keeps a reconciled user segment when prompt completion fails after ACP echo', async () => {
    const prompt = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.sendAcpPrompt.mockReturnValueOnce(prompt.promise);
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    const sendPromise = useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'hello from user',
    });
    const sentPayload = hostApiMock.sendAcpPrompt.mock.calls[0]?.[0] as { messageId: string };

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'user_message_chunk',
          messageId: sentPayload.messageId,
          content: { type: 'text', text: 'hello from user' },
        },
      },
    });
    prompt.resolve({ success: false, error: 'prompt failed after echo' });
    await expect(sendPromise).resolves.toBe(false);

    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toHaveLength(1);
    expect(useAcpChatSessionStore.getState().timeline.itemsById[`${sentPayload.messageId}:0`]).toMatchObject({
      kind: 'message-segment',
      role: 'user',
      optimistic: false,
      parts: [{ kind: 'markdown', text: 'hello from user' }],
    });
  });

  it('does not respond to missing or already-resolved permission requests', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    await useAcpChatSessionStore.getState().respondPermission('missing', 'allow-once');

    expect(hostApiMock.respondAcpPermission).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState().error).toBeNull();

    hostEventsMock.permissionListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      requestId: 'perm-1',
      request: {
        sessionId: 'agent:pi:s1',
        toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    });
    await useAcpChatSessionStore.getState().respondPermission('perm-1', 'allow-once');
    hostApiMock.respondAcpPermission.mockClear();

    await useAcpChatSessionStore.getState().respondPermission('perm-1', 'allow-once');

    expect(hostApiMock.respondAcpPermission).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState().error).toBeNull();
  });

  it('ignores stale sendPrompt completion after switching sessions', async () => {
    const prompt = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.loadAcpSession
      .mockReset()
      .mockResolvedValueOnce({ success: true, generation: 1 })
      .mockResolvedValueOnce({ success: true, generation: 2 });
    hostApiMock.sendAcpPrompt.mockReturnValueOnce(prompt.promise);
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });

    const promptPromise = useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo-a',
      message: 'hello',
    });
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-b' });
    prompt.resolve({ success: false, error: 'stale prompt failed', generation: 1 });
    await promptPromise;

    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:s2',
      generation: 2,
      sending: false,
      error: null,
    });
  });

  it('returns false and does not prompt when the session is not active', async () => {
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });

    await expect(useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s2',
      cwd: '/repo-b',
      message: 'wrong session',
    })).resolves.toBe(false);

    expect(hostApiMock.sendAcpPrompt).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState().error).toBeNull();
  });

  it('ignores stale cancel completion after switching sessions', async () => {
    const cancel = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.loadAcpSession
      .mockReset()
      .mockResolvedValueOnce({ success: true, generation: 1 })
      .mockResolvedValueOnce({ success: true, generation: 2 });
    hostApiMock.cancelAcpSession.mockReturnValueOnce(cancel.promise);
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });

    const cancelPromise = useAcpChatSessionStore.getState().cancel();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-b' });
    cancel.resolve({ success: false, error: 'stale cancel failed', generation: 1 });
    await cancelPromise;

    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:s2',
      generation: 2,
      cancelling: false,
      error: null,
    });
  });

  it('ignores stale respondPermission completion after switching sessions', async () => {
    const permissionResponse = createDeferred<{ success: boolean; error?: string; generation?: number }>();
    hostApiMock.loadAcpSession
      .mockReset()
      .mockResolvedValueOnce({ success: true, generation: 1 })
      .mockResolvedValueOnce({ success: true, generation: 2 });
    hostApiMock.respondAcpPermission.mockReturnValueOnce(permissionResponse.promise);
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });
    hostEventsMock.permissionListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      requestId: 'perm-1',
      request: {
        sessionId: 'agent:pi:s1',
        toolCall: { toolCallId: 'tool-1', title: 'Edit file', status: 'pending' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    });

    const responsePromise = useAcpChatSessionStore.getState().respondPermission('perm-1', 'allow-once');
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-b' });
    permissionResponse.resolve({ success: false, error: 'stale permission failed', generation: 1 });
    await responsePromise;

    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:s2',
      generation: 2,
      error: null,
    });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });

  it('sets an error and clears loading when session load fails', async () => {
    hostApiMock.loadAcpSession.mockResolvedValueOnce({ success: false, error: 'load failed' });
    const { useAcpChatSessionStore } = await importStore();

    const loaded = await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    expect(loaded).toBe(false);
    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: null,
      cwd: null,
      loading: false,
      error: 'load failed',
    });
  });
});
