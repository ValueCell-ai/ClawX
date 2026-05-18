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

  it('does not clear chat sending state on non-terminal agent phase end', async () => {
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

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        data: { phase: 'end' },
      },
    });
    await flushAsyncImports();

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-1');
    expect(useChatStore.getState().pendingFinal).toBe(true);
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281731000);
  });

  it('clears chat sending state on terminal completed agent phase', async () => {
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

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-2',
        sessionKey: 'agent:main:main',
        data: { phase: 'completed' },
      },
    });
    await flushAsyncImports();

    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().pendingFinal).toBe(false);
    expect(useChatStore.getState().lastUserMessageAt).toBeNull();
  });

  it('forces terminal history reload even when non-terminal phase end just refreshed history', async () => {
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

    const notifyPhase = (phase: string) => handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-terminal-refresh',
        sessionKey: 'agent:main:main',
        data: { phase },
      },
    });

    notifyPhase('end');
    await flushAsyncImports();
    notifyPhase('completed');
    await flushAsyncImports();

    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
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

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        runId: 'run-no-seq',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
      },
    });
    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
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
      method: 'agent',
      params: {
        runId: 'run-no-seq-replay',
        sessionKey: 'agent:main:main',
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'text', text: 'same' }] },
      },
    };

    handlers.get('gateway:notification')?.(replayedDelta);
    handlers.get('gateway:notification')?.(replayedDelta);
    await flushAsyncImports();

    expect(handleChatEvent).toHaveBeenCalledTimes(1);
  });
});
