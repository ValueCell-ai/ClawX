import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();

function flushAsyncImports(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hostApiFetchMock.mockResolvedValue({ state: 'running', port: 18789 });
  });

  it('subscribes to host events through subscribeHostEvent on init', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:health', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:presence', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('chat:runtime-event', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');

    handlers.get('gateway:health')?.({ ok: true, ts: 1 });
    expect(useGatewayStore.getState().health?.openclawHealth).toEqual({ ok: true, ts: 1 });

    handlers.get('gateway:presence')?.([{ mode: 'gateway', ts: 2 }]);
    expect(useGatewayStore.getState().health?.presence).toEqual([{ mode: 'gateway', ts: 2 }]);
  });

  it('propagates gatewayReady field from status events', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789, gatewayReady: false });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    // Initially gatewayReady=false from the status fetch
    expect(useGatewayStore.getState().status.gatewayReady).toBe(false);

    // Simulate gateway.ready event setting gatewayReady=true
    handlers.get('gateway:status')?.({ state: 'running', port: 18789, gatewayReady: true });
    expect(useGatewayStore.getState().status.gatewayReady).toBe(true);
  });

  it('treats undefined gatewayReady as ready for backwards compatibility', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    const status = useGatewayStore.getState().status;
    // gatewayReady is undefined (old gateway version) — should be treated as ready
    expect(status.gatewayReady).toBeUndefined();
    expect(status.state === 'running' && status.gatewayReady !== false).toBe(true);
  });

  it('does not clear chat sending state on non-terminal runtime events', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: 'run-1',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'tool.completed',
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      toolCallId: 'call-1',
      name: 'read',
      result: { summary: 'done' },
      isError: false,
    });
    await flushAsyncImports();

    expect(loadHistory).not.toHaveBeenCalled();
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-1');
    expect(useChatStore.getState().pendingFinal).toBe(true);
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281731000);
    expect(useChatStore.getState().streamingTools).toEqual([]);
    expect(useChatStore.getState().runtimeRuns['run-1']?.events).toEqual([
      expect.objectContaining({ type: 'tool.completed', toolCallId: 'call-1', name: 'read' }),
    ]);
  });

  it('clears chat sending state on terminal run.ended runtime event', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: 'run-2',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-2',
      sessionKey: 'agent:main:main',
      status: 'completed',
      endedAt: 123,
    });
    await flushAsyncImports();

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().lastUserMessageAt).toBeNull();
  });

  it('does not clear the active send when a stale run.ended arrives for the same session', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: 'run-active',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-stale',
      sessionKey: 'agent:main:main',
      status: 'completed',
      endedAt: 123,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-active');
    expect(useChatStore.getState().pendingFinal).toBe(true);
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281731000);
  });

  it('ignores session-less runtime terminals that do not match the active run', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: 'run-active',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-background',
      status: 'completed',
      endedAt: 123,
    });
    await flushAsyncImports();

    expect(loadHistory).not.toHaveBeenCalled();
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-active');
    expect(useChatStore.getState().pendingFinal).toBe(true);
  });

  it('tracks a current-session run.started even when the optimistic send is already active', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: 1773281731000,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.started',
      runId: 'run-started-before-rpc-return',
      sessionKey: 'agent:main:main',
      startedAt: 1773281731001,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-started-before-rpc-return');
  });

  it('forces a terminal history reload when the runtime emits run.ended', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      sending: true,
      activeRunId: 'run-terminal-refresh',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'tool.completed',
      runId: 'run-terminal-refresh',
      sessionKey: 'agent:main:main',
      toolCallId: 'call-2',
      name: 'grep',
      result: { summary: 'done' },
      isError: false,
    });
    await flushAsyncImports();
    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-terminal-refresh',
      sessionKey: 'agent:main:main',
      status: 'completed',
      endedAt: 456,
    });
    await flushAsyncImports();

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('forwards normalized chat runtime events through the dedicated host event channel', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const handleRuntimeEvent = vi.fn();
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      activeRunId: 'run-runtime',
      handleRuntimeEvent,
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'tool.started',
      runId: 'run-runtime',
      sessionKey: 'agent:main:main',
      toolCallId: 'call-1',
      name: 'read',
      args: { filePath: '/tmp/demo.md' },
    });
    await flushAsyncImports();

    expect(handleRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool.started',
      runId: 'run-runtime',
      toolCallId: 'call-1',
    }));
    expect(loadHistory).not.toHaveBeenCalled();

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-runtime',
      sessionKey: 'agent:main:main',
      status: 'completed',
      endedAt: 123,
    });
    await flushAsyncImports();

    expect(handleRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.ended',
      runId: 'run-runtime',
      status: 'completed',
    }));
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it('passes progressive delta notifications without seq through to chat store', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const handleChatEvent = vi.fn();
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      handleChatEvent,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:chat-message')?.({
      message: {
        runId: 'run-no-seq',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
      },
    });
    handlers.get('gateway:chat-message')?.({
      message: {
        runId: 'run-no-seq',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first second' }] },
      },
    });
    await flushAsyncImports();

    expect(handleChatEvent).toHaveBeenCalledTimes(2);
    expect(handleChatEvent.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run-no-seq',
      state: 'delta',
      message: { content: [{ text: 'first' }] },
    });
    expect(handleChatEvent.mock.calls[1]?.[0]).toMatchObject({
      runId: 'run-no-seq',
      state: 'delta',
      message: { content: [{ text: 'first second' }] },
    });
  });

  it('dedupes exact replayed delta notifications without seq', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const handleChatEvent = vi.fn();
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      handleChatEvent,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    const replayedDelta = {
      message: {
        runId: 'run-no-seq-replay',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'same' }] },
      },
    };

    handlers.get('gateway:chat-message')?.(replayedDelta);
    handlers.get('gateway:chat-message')?.(replayedDelta);
    await flushAsyncImports();

    expect(handleChatEvent).toHaveBeenCalledTimes(1);
  });
});
