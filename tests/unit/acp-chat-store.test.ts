import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  loadAcpSession: vi.fn(),
  sendAcpPrompt: vi.fn(),
  cancelAcpSession: vi.fn(),
  respondAcpPermission: vi.fn(),
  mediaThumbnails: vi.fn(),
  recordAcpTrace: vi.fn(),
  sessionsHistory: vi.fn(),
}));

const hostEventsMock = vi.hoisted(() => ({
  updateListener: null as ((payload: unknown) => void) | null,
  permissionListener: null as ((payload: unknown) => void) | null,
  gatewayChatMessageListener: null as ((payload: unknown) => void) | null,
  runtimeEventListener: null as ((payload: unknown) => void) | null,
  onAcpSessionUpdate: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.updateListener = listener;
    return () => { hostEventsMock.updateListener = null; };
  }),
  onAcpPermissionRequest: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.permissionListener = listener;
    return () => { hostEventsMock.permissionListener = null; };
  }),
  onGatewayChatMessage: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.gatewayChatMessageListener = listener;
    return () => { hostEventsMock.gatewayChatMessageListener = null; };
  }),
  onChatRuntimeEvent: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.runtimeEventListener = listener;
    return () => { hostEventsMock.runtimeEventListener = null; };
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
    media: {
      thumbnails: hostApiMock.mediaThumbnails,
    },
    diagnostics: {
      recordAcpTrace: hostApiMock.recordAcpTrace,
    },
    sessions: {
      history: hostApiMock.sessionsHistory,
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onAcpSessionUpdate: hostEventsMock.onAcpSessionUpdate,
    onAcpPermissionRequest: hostEventsMock.onAcpPermissionRequest,
    onGatewayChatMessage: hostEventsMock.onGatewayChatMessage,
    onChatRuntimeEvent: hostEventsMock.onChatRuntimeEvent,
  },
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => {
      const labels: Record<string, string> = {
        'chat:imageGeneration.generatedReady': 'Generated image is ready.',
        'chat:imageGeneration.generatedReadyWithMissing': 'Generated image is ready. Some images could not be loaded.',
        'chat:imageGeneration.previewUnavailable': 'Image generation completed, but the preview could not be loaded.',
        'chat:acp.image': 'Image',
      };
      return labels[key] ?? key;
    },
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
    hostApiMock.mediaThumbnails.mockReset().mockResolvedValue({});
    hostApiMock.recordAcpTrace.mockReset().mockResolvedValue({ success: true });
    hostApiMock.sessionsHistory.mockReset().mockResolvedValue({ success: true, messages: [] });
    hostEventsMock.updateListener = null;
    hostEventsMock.permissionListener = null;
    hostEventsMock.gatewayChatMessageListener = null;
    hostEventsMock.runtimeEventListener = null;
    hostEventsMock.onAcpSessionUpdate.mockClear();
    hostEventsMock.onAcpPermissionRequest.mockClear();
    hostEventsMock.onGatewayChatMessage.mockClear();
    hostEventsMock.onChatRuntimeEvent.mockClear();
  });

  it('prepares a local pending session by clearing renderer state without loading ACP', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo-a' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'old' },
        },
      },
    });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual(['msg-1:0']);
    hostApiMock.loadAcpSession.mockClear();

    useAcpChatSessionStore.getState().prepareLocalSession({
      sessionKey: 'agent:pi:session-local',
      cwd: '/repo-b',
    });

    expect(hostApiMock.loadAcpSession).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState()).toMatchObject({
      activeSessionKey: 'agent:pi:session-local',
      cwd: '/repo-b',
      loading: false,
      sending: false,
      cancelling: false,
      error: null,
    });
    expect(useAcpChatSessionStore.getState().timeline).toMatchObject({
      sessionId: 'agent:pi:session-local',
      itemOrder: [],
    });
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
    expect(hostEventsMock.onGatewayChatMessage).toHaveBeenCalledTimes(1);
    expect(hostEventsMock.onChatRuntimeEvent).toHaveBeenCalledTimes(1);
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

  it('marks replay tool updates as historical from the ACP envelope without marking live prompt updates', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'replayed-tool',
          title: 'Read history',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'historical output' } }],
        },
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemsById['tool:replayed-tool']).toMatchObject({
      kind: 'tool-call',
      historical: true,
    });

    const promptDeferred = createDeferred<{ success: true }>();
    hostApiMock.sendAcpPrompt.mockReturnValueOnce(promptDeferred.promise);
    const promptPromise = useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'live prompt',
      messageId: 'live-message',
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'live-tool',
          title: 'Live tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'live output' } }],
        },
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemsById['tool:live-tool']).toMatchObject({
      kind: 'tool-call',
      historical: false,
    });

    promptDeferred.resolve({ success: true });
    await promptPromise;
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

  it('projects trusted image-generation Gateway media into the ACP timeline', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).',
            },
          }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/sky.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/sky.png', mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png', alt: 'Image' },
      ],
    });
  });

  it('records image-generation start detection trace entries', async () => {
    const taskId = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${taskId}).`,
            },
          }],
        },
      },
    });

    expect(hostApiMock.recordAcpTrace).toHaveBeenCalledWith(expect.objectContaining({
      event: 'image-generation:start-detected',
      direction: 'projection',
      sessionKey: 'agent:pi:s1',
      generation: 1,
      details: expect.objectContaining({ taskId }),
    }));
  });

  it('records projection rejection when generated media lacks fresh image-generation context', async () => {
    const { useAcpChatSessionStore } = await importStore();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    await useAcpChatSessionStore.getState().projectImageGenerationCompletion({
      sessionKey: 'agent:pi:s1',
      source: 'gateway-chat-message',
      evidenceId: 'gateway:run-1:/tmp/sky.png',
      caption: 'Generated image is ready.',
      candidates: [{ key: '/tmp/sky.png', filePath: '/tmp/sky.png', mimeType: 'image/png' }],
    });

    expect(hostApiMock.recordAcpTrace).toHaveBeenCalledWith(expect.objectContaining({
      event: 'image-generation:projection-rejected',
      direction: 'projection',
      sessionKey: 'agent:pi:s1',
      generation: 1,
      details: expect.objectContaining({
        reason: 'no-fresh-context',
        source: 'gateway-chat-message',
        candidateCount: 1,
      }),
    }));
  });

  it('supplements historical ACP image-generation completions from transcript history', async () => {
    const taskId = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
    hostApiMock.sessionsHistory.mockResolvedValueOnce({
      success: true,
      messages: [
        {
          role: 'toolresult',
          toolCallId: 'image-tool',
          toolName: 'image_generate',
          content: [{
            type: 'text',
            text: `Background task started for image generation (${taskId}).`,
          }],
          details: { taskId },
        },
        {
          role: 'assistant',
          id: 'assistant-image-ready',
          content: [{
            type: 'text',
            text: '图片生成完成！\n\nMEDIA:/tmp/replayed-sky.png',
          }],
        },
      ],
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/replayed-sky.png': { preview: 'data:image/png;base64,replayed', fileSize: 67 },
    });
    const { useAcpChatSessionStore } = await importStore();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.sessionsHistory).toHaveBeenCalledWith({ sessionKey: 'agent:pi:s1', limit: 1000 });
    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/replayed-sky.png', mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,replayed', mimeType: 'image/png', alt: 'Image' },
      ],
    });
  });

  it('anchors supplemented historical image-generation previews after the originating tool card', async () => {
    const taskId = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
    const history = createDeferred<{
      success: true;
      messages: Array<Record<string, unknown>>;
    }>();
    hostApiMock.sessionsHistory.mockReturnValueOnce(history.promise);
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/replayed-sky.png': { preview: 'data:image/png;base64,replayed', fileSize: 67 },
    });
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'user_message',
          messageId: 'image-user',
          content: [{ type: 'text', text: 'Generate an image' }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'image-tool',
          title: 'image_generate',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${taskId}).` } }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'user_message',
          messageId: 'thanks-user',
          content: [{ type: 'text', text: 'Thanks' }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message',
          messageId: 'welcome-assistant',
          content: [{ type: 'text', text: 'You are welcome' }],
        },
      },
    });

    history.resolve({
      success: true,
      messages: [
        {
          role: 'toolresult',
          toolCallId: 'image-tool',
          toolName: 'image_generate',
          content: `Background task started for image generation (${taskId}).`,
          details: { taskId },
        },
        {
          role: 'assistant',
          id: 'assistant-image-ready',
          content: '图片生成完成！\n\nMEDIA:/tmp/replayed-sky.png',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemOrder).toEqual([
      'image-user:0',
      'tool:image-tool',
      syntheticId,
      'thanks-user:0',
      'welcome-assistant:0',
    ]);
  });

  it('uses transcript task ids to anchor image completions when transcript toolCallId is missing', async () => {
    const firstTaskId = '11111111-1111-4111-8111-111111111111';
    const secondTaskId = '22222222-2222-4222-8222-222222222222';
    const history = createDeferred<{
      success: true;
      messages: Array<Record<string, unknown>>;
    }>();
    hostApiMock.sessionsHistory.mockReturnValueOnce(history.promise);
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/first-sky.png': { preview: 'data:image/png;base64,first', fileSize: 67 },
    });
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    for (const [toolCallId, taskId] of [['first-image-tool', firstTaskId], ['second-image-tool', secondTaskId]] as const) {
      hostEventsMock.updateListener?.({
        sessionKey: 'agent:pi:s1',
        generation: 1,
        historical: true,
        notification: {
          sessionId: 'agent:pi:s1',
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: toolCallId,
            status: 'completed',
            content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${taskId}).` } }],
          },
        },
      });
    }

    history.resolve({
      success: true,
      messages: [
        {
          role: 'toolresult',
          toolName: 'image_generate',
          content: `Background task started for image generation (${firstTaskId}).`,
          details: { taskId: firstTaskId },
        },
        {
          role: 'assistant',
          id: 'first-image-ready',
          content: '第一张图片完成！\n\nMEDIA:/tmp/first-sky.png',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemOrder).toEqual([
      'tool:first-image-tool',
      syntheticId,
      'tool:second-image-tool',
    ]);
  });

  it('drops a pending transcript supplement when a new prompt starts before thumbnail hydration completes', async () => {
    const taskId = '0d2ee919-2dfd-4b72-9da3-d87e6ee56747';
    const thumbnail = createDeferred<Record<string, { preview: string | null; fileSize: number }>>();
    const prompt = createDeferred<{ success: true }>();
    hostApiMock.sessionsHistory.mockResolvedValueOnce({
      success: true,
      messages: [
        {
          role: 'toolresult',
          toolCallId: 'image-tool',
          toolName: 'image_generate',
          content: `Background task started for image generation (${taskId}).`,
          details: { taskId },
        },
        {
          role: 'assistant',
          id: 'assistant-image-ready',
          content: '图片生成完成！\n\nMEDIA:/tmp/replayed-sky.png',
        },
      ],
    });
    hostApiMock.mediaThumbnails.mockReturnValueOnce(thumbnail.promise);
    hostApiMock.sendAcpPrompt.mockReturnValueOnce(prompt.promise);
    const { useAcpChatSessionStore } = await importStore();

    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/replayed-sky.png', mimeType: 'image/png' }],
    });

    const promptPromise = useAcpChatSessionStore.getState().sendPrompt({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      message: 'live prompt',
      messageId: 'live-user',
    });
    thumbnail.resolve({
      '/tmp/replayed-sky.png': { preview: 'data:image/png;base64,replayed', fileSize: 67 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
    expect(timeline.itemsById['live-user:0']).toMatchObject({
      kind: 'message-segment',
      role: 'user',
      parts: [{ kind: 'markdown', text: 'live prompt' }],
    });

    prompt.resolve({ success: true });
    await promptPromise;
  });

  it('does not read transcript history for freshly created ACP sessions', async () => {
    const { useAcpChatSessionStore } = await importStore();

    await useAcpChatSessionStore.getState().loadSession({
      sessionKey: 'agent:pi:s1',
      cwd: '/repo',
      createIfMissing: true,
    });

    expect(hostApiMock.sessionsHistory).not.toHaveBeenCalled();
  });

  it('projects a recorded image-generation background task completion from its task session', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${taskId}).`,
            },
          }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });

    hostEventsMock.runtimeEventListener?.({
      type: 'tool.completed',
      sessionKey: `image_generate:${taskId}`,
      runId: `image_generate:${taskId}:ok`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        details: {
          status: 'ok',
          deliveryStatus: 'sent',
          sourceReplySink: 'internal-ui',
          sourceReply: { mediaUrls: ['/tmp/sky.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/sky.png', mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png', alt: 'Image' },
      ],
    });
  });

  it('reprojects image-generation previews from historical ACP replay tool output', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/replayed-sky.png': { preview: 'data:image/png;base64,replayed', fileSize: 67 },
    });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${taskId}).`,
            },
          }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'message-tool',
          status: 'completed',
          rawOutput: {
            details: {
              status: 'ok',
              deliveryStatus: 'sent',
              sourceReplySink: 'internal-ui',
              sourceReply: { mediaUrls: ['/tmp/replayed-sky.png'] },
            },
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/replayed-sky.png', mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,replayed', mimeType: 'image/png', alt: 'Image' },
      ],
    });
  });

  it('reprojects image-generation previews from historical ACP assistant MEDIA text', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const generatedPath = '/Users/me/.openclaw/media/tool-image-generation/clawx-image-1.png';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      [generatedPath]: { preview: 'data:image/png;base64,replayed-media-text', fileSize: 67 },
    });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${taskId}).`,
            },
          }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'replayed-image-result',
          content: {
            type: 'text',
            text: `图片生成完成！这是为你创建的蓝天白云风景图。\n\nMEDIA:${generatedPath}`,
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: generatedPath, mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,replayed-media-text', mimeType: 'image/png', alt: 'Image' },
      ],
    });
  });

  it('does not let historical replay context authorize live ACP media updates', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${taskId}).`,
            },
          }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'message-tool',
          status: 'completed',
          rawOutput: {
            details: {
              sourceReply: { mediaUrls: ['/tmp/live-after-replay.png'] },
            },
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
  });

  it('does not let live image-generation context authorize historical ACP MEDIA text', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${taskId}).` } }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'historical-media-with-live-context',
          content: { type: 'text', text: 'Done\n\nMEDIA:/tmp/live-context-only.png' },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
  });

  it('does not project ACP rawOutput media without internal-ui delivery evidence', async () => {
    const taskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${taskId}).` } }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'read-tool',
          status: 'completed',
          rawOutput: {
            details: {
              sourceReply: { mediaUrls: ['/tmp/not-internal-ui-delivery.png'] },
            },
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
  });

  it('does not let historical task ids become runtime-eligible after a live image-generation start', async () => {
    const historicalTaskId = '32aa3a12-a05b-4074-af4e-246cc4a9a303';
    const liveTaskId = '42bb4b23-b16c-4185-b05f-357dd5ba0414';
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'historical-image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${historicalTaskId}).` } }],
        },
      },
    });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'live-image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: `Background task started for image generation (${liveTaskId}).` } }],
        },
      },
    });

    hostEventsMock.runtimeEventListener?.({
      type: 'tool.completed',
      sessionKey: `image_generate:${historicalTaskId}`,
      runId: `image_generate:${historicalTaskId}:ok`,
      toolCallId: 'message-tool',
      name: 'message',
      result: {
        details: {
          sourceReply: { mediaUrls: ['/tmp/stale-replayed-task.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
  });

  it('does not project media without recent image-generation context', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/not-from-image-generation.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });

  it('does not trust Gateway media from historical image-generation replay context', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      historical: true,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).',
            },
          }],
        },
      },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/replayed-image.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(0);
  });

  it('dedupes repeated image-generation media delivery records', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValue({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });
    const delivery = {
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    };

    hostEventsMock.gatewayChatMessageListener?.(delivery);
    hostEventsMock.gatewayChatMessageListener?.(delivery);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledTimes(1);
    expect(useAcpChatSessionStore.getState().timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(1);
  });

  it('dedupes image-generation media delivered by Gateway and runtime streams', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValue({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    });
    hostEventsMock.runtimeEventListener?.({
      type: 'tool.completed',
      sessionKey: 'agent:pi:s1',
      runId: 'run-1',
      name: 'message',
      result: { mediaUrls: ['/tmp/sky.png'] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledTimes(1);
    expect(useAcpChatSessionStore.getState().timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(1);
  });

  it('keeps distinct image-generation completions when evidence keys collide under 32-bit hashing', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValue({
      '5JYWuT}ThLA}x[G': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
      'bb7CGq|v9x5xCZb': { preview: 'data:image/png;base64,def456', fileSize: 68 },
    });

    hostEventsMock.runtimeEventListener?.({
      type: 'assistant.delta',
      sessionKey: 'agent:pi:s1',
      runId: 'run-1',
      mimeType: 'image/png',
      mediaUrls: ['5JYWuT}ThLA}x[G'],
    });
    hostEventsMock.runtimeEventListener?.({
      type: 'assistant.delta',
      sessionKey: 'agent:pi:s1',
      runId: 'run-1',
      mimeType: 'image/png',
      mediaUrls: ['bb7CGq|v9x5xCZb'],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticIds = timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'));
    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledTimes(2);
    expect(syntheticIds).toHaveLength(2);
    expect(new Set(syntheticIds).size).toBe(2);
  });

  it('appends a text fallback when trusted image-generation completion previews cannot be loaded', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/sky.png': { preview: null, fileSize: 0 },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      parts: [{ kind: 'markdown', text: 'Image generation completed, but the preview could not be loaded.' }],
    });
  });

  it('drops stale image-generation hydrated previews after a session generation changes', async () => {
    const thumbnailDeferred = createDeferred<Record<string, { preview: string | null; fileSize: number }>>();
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockReturnValueOnce(thumbnailDeferred.promise);
    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    });

    hostApiMock.loadAcpSession.mockResolvedValueOnce({ success: true, generation: 2 });
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-2' });
    thumbnailDeferred.resolve({ '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAcpChatSessionStore.getState()).toMatchObject({ activeSessionKey: 'agent:pi:s2', generation: 2 });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });
});
