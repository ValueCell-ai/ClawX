import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  gateway: {
    status: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    health: vi.fn(),
    controlUi: vi.fn(),
    rpc: vi.fn(),
  },
  settings: {
    getAll: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    setMany: vi.fn(),
    reset: vi.fn(),
  },
  logs: {
    recent: vi.fn(),
    dir: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
  },
}));
const hostEventSubscriptionMock = vi.fn();

function flushAsyncImports(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayStatus: (handler: unknown) => hostEventSubscriptionMock('gateway:status', handler),
    onGatewayError: (handler: unknown) => hostEventSubscriptionMock('gateway:error', handler),
    onGatewayNotification: (handler: unknown) => hostEventSubscriptionMock('gateway:notification', handler),
    onGatewayHealth: (handler: unknown) => hostEventSubscriptionMock('gateway:health', handler),
    onGatewayPresence: (handler: unknown) => hostEventSubscriptionMock('gateway:presence', handler),
    onGatewayChatMessage: (handler: unknown) => hostEventSubscriptionMock('gateway:chat-message', handler),
    onChatRuntimeEvent: (handler: unknown) => hostEventSubscriptionMock('chat:runtime-event', handler),
    onGatewayChannelStatus: (handler: unknown) => hostEventSubscriptionMock('gateway:channel-status', handler),
  },
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hostApiMock.gateway.status.mockResolvedValue({ state: 'running', port: 18789 });
  });

  it('subscribes to typed host events on init', async () => {
    hostApiMock.gateway.status.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:health', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:presence', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('chat:runtime-event', expect.any(Function));
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');

    handlers.get('gateway:health')?.({ ok: true, ts: 1 });
    expect(useGatewayStore.getState().health?.openclawHealth).toEqual({ ok: true, ts: 1 });

    handlers.get('gateway:presence')?.([{ mode: 'gateway', ts: 2 }]);
    expect(useGatewayStore.getState().health?.presence).toEqual([{ mode: 'gateway', ts: 2 }]);
  });

  it('propagates gatewayReady field from status events', async () => {
    hostApiMock.gateway.status.mockResolvedValueOnce({ state: 'running', port: 18789, gatewayReady: false });

    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostApiMock.gateway.status.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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

  it('does not let a stale send RPC re-arm a completed run after a newer send starts', async () => {
    let now = 1773281731000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const firstSend = deferred<{ runId?: string }>();
    const secondSend = deferred<{ runId?: string }>();
    const sendPromises = [firstSend.promise, secondSend.promise];
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method === 'chat.send') return sendPromises.shift();
      return Promise.resolve({});
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });

    const first = useChatStore.getState().sendMessage('first image request');
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281731000);

    // History/media delivery can prove the first run is complete before the
    // blocking chat.send RPC returns. The composer is then allowed to send a
    // second turn; the late first ack must not overwrite that newer lifecycle.
    useChatStore.setState({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
    });
    now = 1773281732000;
    const second = useChatStore.getState().sendMessage('second prompt');
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281732000);

    firstSend.resolve({ runId: 'run-first' });
    await first;
    expect(useChatStore.getState().activeRunId).not.toBe('run-first');
    expect(useChatStore.getState().lastUserMessageAt).toBe(1773281732000);

    secondSend.resolve({ runId: 'run-second' });
    await second;
    expect(useChatStore.getState().activeRunId).toBe('run-second');

    nowSpy.mockRestore();
  });

  it('preserves a running session lifecycle when creating a new chat and switching back', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1773281731555);
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:a',
      sessions: [{ key: 'agent:main:a' }],
      messages: [{ role: 'user', content: 'run in a' }],
      sending: true,
      activeRunId: 'run-a',
      pendingFinal: false,
      lastUserMessageAt: 1773281731000,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      loadHistory,
    });

    useChatStore.getState().newSession();
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1773281731555');
    expect(useChatStore.getState().sending).toBe(false);

    useChatStore.getState().switchSession('agent:main:a');

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-a');
    expect(useChatStore.getState().messages).toEqual([{ role: 'user', content: 'run in a' }]);
    nowSpy.mockRestore();
  });

  it('retains inactive-session runtime events for graph reconstruction after switching back', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:a',
      sessions: [{ key: 'agent:main:a' }, { key: 'agent:main:b' }],
      messages: [{ role: 'user', content: 'run in a' }],
      sending: true,
      activeRunId: 'run-a',
      pendingFinal: false,
      lastUserMessageAt: 1773281731000,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      loadHistory,
    });
    useChatStore.getState().switchSession('agent:main:b');

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'tool.started',
      runId: 'run-a',
      sessionKey: 'agent:main:a',
      toolCallId: 'call-read',
      name: 'read',
      args: { path: '/tmp/input.txt' },
    });
    await flushAsyncImports();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:b');
    expect(useChatStore.getState().runtimeRuns['run-a']?.events).toEqual([
      expect.objectContaining({ type: 'tool.started', toolCallId: 'call-read', name: 'read' }),
    ]);

    useChatStore.getState().switchSession('agent:main:a');

    expect(useChatStore.getState().activeRunId).toBe('run-a');
    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().runtimeRuns['run-a']?.events).toEqual([
      expect.objectContaining({ type: 'tool.started', toolCallId: 'call-read', name: 'read' }),
    ]);
  });

  it('clears cached inactive-session run state when run.ended arrives while another session is selected', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:a',
      sessions: [{ key: 'agent:main:a' }, { key: 'agent:main:b' }],
      messages: [{ role: 'user', content: 'run in a' }],
      sending: true,
      activeRunId: 'run-a',
      pendingFinal: true,
      lastUserMessageAt: 1773281731000,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      loadHistory,
    });
    useChatStore.getState().switchSession('agent:main:b');

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-a',
      sessionKey: 'agent:main:a',
      status: 'completed',
      endedAt: 1773281732000,
    });
    await flushAsyncImports();

    useChatStore.getState().switchSession('agent:main:a');

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(useChatStore.getState().runtimeRuns['run-a']?.status).toBe('completed');
  });

  it('clears chat sending state on terminal run.ended runtime event', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
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

  it('renders a cron run live when its run-scoped events bind to the base cron session in view', async () => {
    const baseKey = 'agent:product:cron:294717ee-6dde-45a8-8f67-900e2831cc4f';
    const runKey = `${baseKey}:run:0bfbc08a-7582-4c88-9fd3-47c484e17660`;

    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: baseKey,
      sessions: [{ key: baseKey }],
      messages: [{ role: 'user', content: '[cron:294717ee 早报] 执行ai-news-summarizer' }],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      runtimeRuns: {},
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.started',
      runId: 'run-cron',
      sessionKey: runKey,
      startedAt: 1,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-cron');
    expect(loadHistory).toHaveBeenCalledTimes(1);

    handlers.get('chat:runtime-event')?.({
      type: 'tool.started',
      runId: 'run-cron',
      sessionKey: runKey,
      toolCallId: 'call-1',
      name: 'web_search',
      args: { query: 'AI news' },
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().runtimeRuns['run-cron']?.events).toContainEqual(
      expect.objectContaining({ type: 'tool.started', toolCallId: 'call-1', name: 'web_search' }),
    );

    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-cron',
      sessionKey: runKey,
      status: 'completed',
      endedAt: 2,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  it('adopts an in-progress cron run when joining mid-flight without a run.started event', async () => {
    const baseKey = 'agent:main:cron:job-cron-midflight';
    const runKey = `${baseKey}:run:session-mid`;

    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: baseKey,
      sessions: [{ key: baseKey }],
      messages: [{ role: 'user', content: '[cron:job-cron-midflight] write a doc' }],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      runtimeRuns: {},
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    // First event the renderer sees for this session is a mid-run tool event
    // (run.started was emitted before the user opened the cron session).
    handlers.get('chat:runtime-event')?.({
      type: 'tool.completed',
      runId: 'run-cron-mid',
      sessionKey: runKey,
      toolCallId: 'call-read',
      name: 'read',
      result: { summary: 'SKILL.md' },
      isError: false,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(true);
    expect(useChatStore.getState().activeRunId).toBe('run-cron-mid');
    expect(useChatStore.getState().runtimeRuns['run-cron-mid']?.events).toContainEqual(
      expect.objectContaining({ type: 'tool.completed', toolCallId: 'call-read' }),
    );

    // The run still settles when the terminal event finally arrives.
    handlers.get('chat:runtime-event')?.({
      type: 'run.ended',
      runId: 'run-cron-mid',
      sessionKey: runKey,
      status: 'completed',
      endedAt: 10,
    });
    await flushAsyncImports();

    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('does not adopt a background :main inbound run from a mid-flight tool event', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      runtimeRuns: {},
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'tool.completed',
      runId: 'run-inbound',
      sessionKey: 'agent:main:main',
      toolCallId: 'call-x',
      name: 'read',
      result: { summary: 'done' },
      isError: false,
    });
    await flushAsyncImports();

    // Background inbound runs on the main session must not flip into a tracked
    // "Thinking" state from a stray tool event.
    expect(useChatStore.getState().sending).toBe(false);
    expect(useChatStore.getState().activeRunId).toBeNull();
  });

  it('does not surface a Thinking state for background :main heartbeat runs', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useChatStore } = await import('@/stores/chat');
    const loadHistory = vi.fn(async () => {});
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      runtimeRuns: {},
      loadHistory,
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('chat:runtime-event')?.({
      type: 'run.started',
      runId: 'run-heartbeat',
      sessionKey: 'agent:main:main',
      startedAt: 1,
    });
    await flushAsyncImports();

    // The background heartbeat must not flip the composer into a "Thinking"
    // (sending) state — that gate is what suppresses the indicator.
    expect(useChatStore.getState().sending).toBe(false);
  });
});
