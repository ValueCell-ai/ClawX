import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

const hostEventSubscriptionMock = vi.fn();
const gatewayRpcMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    gateway: {
      rpc: gatewayRpcMock,
    },
    chat: {
      sendWithMedia: vi.fn(),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayChatMessage: (handler: unknown) => (
      hostEventSubscriptionMock('gateway:chat-message', handler)
    ),
    onGatewayAgentEvent: (handler: unknown) => (
      hostEventSubscriptionMock('gateway:agent-event', handler)
    ),
    onChatRuntimeEvent: (handler: unknown) => (
      hostEventSubscriptionMock('chat:runtime-event', handler)
    ),
    onGatewayStatus: (handler: unknown) => hostEventSubscriptionMock('gateway:status', handler),
  },
}));

describe('openclaw chat surface store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    gatewayRpcMock.mockResolvedValue({ ok: true });
  });

  it('routes chat delta host events into visible stream items', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();
    useOpenClawChatSurfaceStore.getState().setSessionKey('agent:main:main');

    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    });

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toEqual([
      expect.objectContaining({ kind: 'stream', runId: 'run-1', text: 'hello' }),
    ]);
  });

  it('accumulates deltaText-only chat host events into one visible stream item', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();
    useOpenClawChatSurfaceStore.getState().setSessionKey('agent:main:main');

    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-delta',
      deltaText: 'hello',
    });
    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-delta',
      deltaText: ' again',
    });

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toEqual([
      expect.objectContaining({ kind: 'stream', runId: 'run-delta', text: 'hello again' }),
    ]);
  });

  it('routes raw assistant agent events into visible stream items', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();
    useOpenClawChatSurfaceStore.getState().setSessionKey('agent:main:main');

    handlers.get('gateway:agent-event')?.({
      sessionKey: 'agent:main:main',
      runId: 'run-raw',
      stream: 'assistant',
      data: { text: 'raw stream text', delta: 'raw stream text' },
    });

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toEqual([
      expect.objectContaining({ kind: 'stream', runId: 'run-raw', text: 'raw stream text' }),
    ]);
  });

  it('routes runtime approval events into pending approval cards and clears resolved approvals', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.initHostSubscriptions();
    store.setSessionKey('agent:main:main');

    handlers.get('chat:runtime-event')?.({
      type: 'approval.updated',
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      approvalId: 'approval-runtime-1',
      toolCallId: 'call-runtime-1',
      title: 'Command approval requested',
      kind: 'exec',
      status: 'pending',
      command: 'echo APPROVAL_OK',
      allowedDecisions: ['allow-once', 'deny'],
    });

    expect(useOpenClawChatSurfaceStore.getState().core.runtime.approvals).toEqual([
      expect.objectContaining({
        id: 'approval-runtime-1',
        approvalId: 'approval-runtime-1',
        toolCallId: 'call-runtime-1',
        title: 'Command approval requested',
        detail: 'echo APPROVAL_OK',
        allowedDecisions: ['allow-once', 'deny'],
      }),
    ]);
    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toContainEqual(
      expect.objectContaining({
        kind: 'approval',
        approval: expect.objectContaining({ id: 'approval-runtime-1' }),
      }),
    );

    handlers.get('chat:runtime-event')?.({
      type: 'approval.updated',
      sessionKey: 'agent:main:main',
      runId: 'run-approval',
      approvalId: 'approval-runtime-1',
      toolCallId: 'call-runtime-1',
      phase: 'resolved',
      status: 'approved',
    });

    expect(useOpenClawChatSurfaceStore.getState().core.runtime.approvals).toEqual([]);
    expect(useOpenClawChatSurfaceStore.getState().core.runtime.resolvedApprovalIds).toContain('approval-runtime-1');
  });

  it('can enqueue an optimistic user message for sends owned by the legacy ChatInput path', async () => {
    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.setSessionKey('agent:main:main');

    store.enqueueOptimisticUserMessage('hello immediately');

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toContainEqual(
      expect.objectContaining({
        kind: 'queue',
        item: expect.objectContaining({ message: 'hello immediately' }),
      }),
    );
  });

  it('keeps optimistic queue items when the same surface session key is applied again', async () => {
    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.setSessionKey('agent:main:main');
    store.enqueueOptimisticUserMessage('repeat prompt');

    store.setSessionKey('agent:main:main', 'main');

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toContainEqual(
      expect.objectContaining({
        kind: 'queue',
        item: expect.objectContaining({ message: 'repeat prompt' }),
      }),
    );
  });

  it('clears optimistic send state when a chat runtime run.ended event arrives', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.initHostSubscriptions();
    store.setSessionKey('agent:main:main');
    store.enqueueOptimisticUserMessage('run long task');

    expect(useOpenClawChatSurfaceStore.getState().core.send.sending).toBe(true);

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-e2e',
      status: 'completed',
      endedAt: 1_780_000_000_000,
    });

    expect(useOpenClawChatSurfaceStore.getState().core.send).toEqual(
      expect.objectContaining({
        sending: false,
        activeRunId: null,
        canAbort: false,
      }),
    );
    expect(useOpenClawChatSurfaceStore.getState().core.runtime.runStatus).toEqual({
      phase: 'done',
      runId: 'run-e2e',
      endedAt: 1_780_000_000_000,
    });
  });

  it('passes the current thinking level when sending through the OpenClaw surface store', async () => {
    gatewayRpcMock.mockResolvedValueOnce({ runId: 'run-thinking' });
    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.setSessionKey('agent:main:main');
    store.setThinkingLevel('high');

    await store.executeComposerText('hello with thinking');

    expect(gatewayRpcMock).toHaveBeenCalledWith('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'hello with thinking',
      deliver: false,
      idempotencyKey: expect.any(String),
      thinking: 'high',
    }, 120000);
  });

  it('aborts the visible OpenClaw run and ignores late stream events from that run', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();
    store.initHostSubscriptions();
    store.setSessionKey('agent:main:main');

    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-stop',
      deltaText: 'partial',
    });

    expect(useOpenClawChatSurfaceStore.getState().visibleItems).toContainEqual(
      expect.objectContaining({ kind: 'stream', runId: 'run-stop', text: 'partial' }),
    );

    await useOpenClawChatSurfaceStore.getState().abortRun();

    handlers.get('gateway:chat-message')?.({
      state: 'delta',
      sessionKey: 'agent:main:main',
      runId: 'run-stop',
      deltaText: 'late',
    });

    expect(gatewayRpcMock).toHaveBeenCalledWith('chat.abort', {
      sessionKey: 'agent:main:main',
      runId: 'run-stop',
    }, 120000);
    expect(useOpenClawChatSurfaceStore.getState().visibleItems.some((item) => item.kind === 'stream')).toBe(false);
  });

  it('reloads transcript history after a terminal chat host event', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'chat.history') {
        return {
          messages: [
            { id: 'u1', role: 'user', content: 'hello after run' },
            { id: 'a1', role: 'assistant', content: 'done after run' },
          ],
        };
      }
      return { ok: true };
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();
    useOpenClawChatSurfaceStore.getState().setSessionKey('agent:main:main');

    handlers.get('gateway:chat-message')?.({
      state: 'final',
      sessionKey: 'agent:main:main',
      runId: 'run-1',
    });

    await waitFor(() => {
      expect(useOpenClawChatSurfaceStore.getState().visibleItems).toEqual([
        expect.objectContaining({ kind: 'message', id: 'u1' }),
        expect.objectContaining({ kind: 'message', id: 'a1' }),
      ]);
    });
  });

  it('routes upstream agent lifecycle events into run status', async () => {
    const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
    hostEventSubscriptionMock.mockImplementation((
      eventName: string,
      handler: (payload: Record<string, unknown>) => void,
    ) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    useOpenClawChatSurfaceStore.getState().initHostSubscriptions();

    handlers.get('gateway:agent-event')?.({
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'lifecycle',
      data: { phase: 'start' },
    });

    expect(useOpenClawChatSurfaceStore.getState().core.runtime.runStatus).toEqual({
      phase: 'running',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
    });
  });

  it('resolves pending approvals through gateway rpc and clears them locally', async () => {
    const { useOpenClawChatSurfaceStore } = await import('@/stores/openclaw-chat-surface');
    const store = useOpenClawChatSurfaceStore.getState();

    store.dispatch({
      type: 'approval.requested',
      approval: {
        id: 'approval-1',
        kind: 'exec',
        status: 'pending',
        title: 'Command approval requested',
        detail: 'git status',
      },
    });

    await useOpenClawChatSurfaceStore.getState().resolveApproval('approval-1', 'allow-once');

    expect(gatewayRpcMock).toHaveBeenCalledWith('exec.approval.resolve', {
      id: 'approval-1',
      decision: 'allow-once',
    }, 120000);
    expect(useOpenClawChatSurfaceStore.getState().core.runtime.approvals).toEqual([]);
  });
});
