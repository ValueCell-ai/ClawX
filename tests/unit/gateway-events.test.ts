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
    window.localStorage.clear();
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

  it('subscribes and force-hydrates exactly once for each ready runtime identity', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const firstEpoch = { state: 'running' as const, port: 18789, pid: 10, connectedAt: 100, gatewayReady: true };
    hostApiMock.gateway.status.mockResolvedValue(firstEpoch);
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => {
      if (method === 'sessions.subscribe') return {};
      if (method === 'sessions.list') return { ts: 1, sessions: [] };
      return {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(1);
    });

    handlers.get('gateway:status')?.(firstEpoch);
    handlers.get('gateway:status')?.({ ...firstEpoch, pid: 11, connectedAt: 200 });
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(2);
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(2);
    });
  });

  it('hydrates after subscribe failure and retries subscription only in the next epoch', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const firstEpoch = { state: 'running' as const, port: 18789, pid: 10, connectedAt: 100 };
    hostApiMock.gateway.status.mockResolvedValue(firstEpoch);
    let subscribeCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => {
      if (method === 'sessions.subscribe') {
        subscribeCalls += 1;
        if (subscribeCalls === 1) throw new Error('subscribe unavailable');
        return {};
      }
      if (method === 'sessions.list') return { ts: subscribeCalls, sessions: [] };
      return {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(1);
    });

    handlers.get('gateway:status')?.(firstEpoch);
    await flushAsyncImports();
    expect(subscribeCalls).toBe(1);

    handlers.get('gateway:status')?.({ ...firstEpoch, connectedAt: 101 });
    await vi.waitFor(() => expect(subscribeCalls).toBe(2));
  });

  it('queues a new epoch hydration behind an ordinary in-flight list and fences the old response', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const firstList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method === 'sessions.subscribe') return Promise.resolve({});
      if (method === 'sessions.list') {
        listCalls += 1;
        if (listCalls === 1) return firstList.promise;
        return Promise.resolve({ ts: 20, sessions: [{ key: 'agent:main:main', status: 'done' }] });
      }
      return Promise.resolve({});
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({ sessions: [], currentSessionKey: 'agent:main:main' });
    const ordinaryLoad = useChatStore.getState().loadSessions();

    hostApiMock.gateway.status.mockResolvedValue({
      state: 'running', port: 18789, pid: 20, connectedAt: 200, gatewayReady: true,
    });
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.some(([method]) => method === 'sessions.subscribe')).toBe(true);
    });
    await flushAsyncImports();

    firstList.resolve({ ts: 10, sessions: [{ key: 'agent:main:old', status: 'running' }] });
    await ordinaryLoad;
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions).toEqual([expect.objectContaining({ key: 'agent:main:main', status: 'done' })]);
  });

  it('routes sessions.changed through the generic notification handler', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => (
      method === 'sessions.list' ? { ts: 1, sessions: [] } : {}
    ));
    const { useChatStore } = await import('@/stores/chat');
    const handleSessionsChanged = vi.fn();
    useChatStore.setState({ handleSessionsChanged });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    handlers.get('gateway:notification')?.({
      method: 'sessions.changed',
      params: { key: 'agent:main:main', ts: 2, status: 'running' },
    });
    await flushAsyncImports();

    expect(handleSessionsChanged).toHaveBeenCalledWith({
      key: 'agent:main:main', ts: 2, status: 'running',
    });
    expect(hostEventSubscriptionMock).not.toHaveBeenCalledWith('gateway:sessions-changed', expect.any(Function));
  });

  it('buffers events during an ordinary list and publishes only the transaction final row', async () => {
    const list = deferred<Record<string, unknown>>();
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method === 'sessions.list') return list.promise;
      return Promise.resolve({});
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }],
      currentSessionKey: 'agent:main:main',
    });
    useSessionAttentionStore.setState({
      bySessionKey: { 'agent:main:main': { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });
    const publishedStatuses: Array<string | undefined> = [];
    const unsubscribe = useChatStore.subscribe((state) => {
      publishedStatuses.push(state.sessions[0]?.status);
    });

    const loading = useChatStore.getState().loadSessions();
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main',
      ts: 11,
      session: { key: 'agent:main:main', status: 'running', hasActiveRun: true },
    });
    list.resolve({ ts: 10, sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }] });
    await loading;
    unsubscribe();

    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'running', hasActiveRun: true });
    expect(publishedStatuses).not.toContain('done');
    expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
      observedBusy: true,
      unread: true,
    });
  });

  it.each(['success', 'failure'] as const)(
    'folds buffered busy to idle transactionally after list %s',
    async (outcome) => {
      const firstList = deferred<Record<string, unknown>>();
      let listCalls = 0;
      hostApiMock.gateway.rpc.mockImplementation((method: string) => {
        if (method !== 'sessions.list') return Promise.resolve({});
        listCalls += 1;
        if (listCalls === 1) return firstList.promise;
        return Promise.resolve({ ts: 20, sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }] });
      });
      const { useChatStore } = await import('@/stores/chat');
      const { useSessionAttentionStore } = await import('@/stores/session-attention');
      useChatStore.setState({
        sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
        currentSessionKey: 'agent:main:main',
      });
      useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });

      const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
      useChatStore.getState().handleSessionsChanged({
        key: 'agent:main:main', ts: 11, status: 'running', hasActiveRun: true,
      });
      useChatStore.getState().handleSessionsChanged({
        key: 'agent:main:main', ts: 12, status: 'done', hasActiveRun: false,
      });
      if (outcome === 'success') {
        firstList.resolve({ ts: 10, sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }] });
      } else {
        firstList.reject(new Error('list failed'));
      }
      await loading;

      expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
      expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
        observedBusy: false,
        unread: true,
      });
      if (outcome === 'failure') expect(listCalls).toBe(2);
    },
  );

  it('does not speculatively merge unorderable buffered events and schedules one forced follow-up', async () => {
    const firstList = deferred<Record<string, unknown>>();
    const secondList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      if (listCalls === 1) return firstList.promise;
      return secondList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }],
      currentSessionKey: 'agent:main:main',
    });
    useSessionAttentionStore.setState({
      bySessionKey: { 'agent:main:main': { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', status: 'running', hasActiveRun: true,
    });
    firstList.resolve({ sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }] });
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
      observedBusy: true,
      unread: false,
    });
    secondList.resolve({
      ts: 20,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    await loading;

    expect(listCalls).toBe(2);
    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
    expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
      observedBusy: false,
      unread: true,
    });
  });

  it('preserves attention for an unorderable event after list failure and retries once', async () => {
    const firstList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      if (listCalls === 1) return firstList.promise;
      return Promise.resolve({ ts: 20, sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }] });
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }],
      currentSessionKey: 'agent:main:main',
    });
    useSessionAttentionStore.setState({
      bySessionKey: { 'agent:main:main': { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', status: 'done', hasActiveRun: false,
    });
    firstList.reject(new Error('list failed'));
    await loading;

    expect(listCalls).toBe(2);
    expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
      observedBusy: true,
      unread: false,
    });
  });

  it('resets event timestamp fences for a new numeric Gateway generation', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 10,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', ts: 100, status: 'running', hasActiveRun: true,
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 2 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', ts: 20, status: 'running', hasActiveRun: true,
    });

    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'running', hasActiveRun: true });
  });

  it('advances row fences to list.ts before accepting delayed standalone events', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 100,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }],
      currentSessionKey: 'agent:main:main',
    });

    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', ts: 50, status: 'running', hasActiveRun: true,
    });

    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
  });

  it('retains current-generation events while an old list and the new subscription are pending', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const oldList = deferred<Record<string, unknown>>();
    const subscribe = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method === 'sessions.subscribe') return subscribe.promise;
      if (method === 'sessions.list') {
        listCalls += 1;
        if (listCalls === 1) return oldList.promise;
        return Promise.resolve({
          ts: 10,
          sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
        });
      }
      return Promise.resolve({});
    });

    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });
    const oldLoad = useChatStore.getState().loadSessions();

    hostApiMock.gateway.status.mockResolvedValue({
      state: 'running', port: 18789, pid: 30, connectedAt: 300, gatewayReady: true,
    });
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.some(([method]) => method === 'sessions.subscribe')).toBe(true);
    });

    handlers.get('gateway:notification')?.({
      method: 'sessions.changed',
      params: {
        key: 'agent:main:main',
        ts: 11,
        session: { key: 'agent:main:main', status: 'running', hasActiveRun: true },
      },
    });
    handlers.get('gateway:notification')?.({
      method: 'sessions.changed',
      params: {
        key: 'agent:main:main',
        ts: 12,
        session: { key: 'agent:main:main', status: 'done', hasActiveRun: false },
      },
    });
    await flushAsyncImports();

    oldList.resolve({
      ts: 5,
      sessions: [{ key: 'agent:main:old', status: 'running', hasActiveRun: true }],
    });
    await oldLoad;
    expect(listCalls).toBe(1);

    subscribe.resolve({});
    await vi.waitFor(() => expect(listCalls).toBe(2));
    await vi.waitFor(() => {
      expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
        observedBusy: false,
        unread: true,
      });
    });
    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
  });

  it('folds finite per-key transitions when another buffered key is unorderable', async () => {
    const firstList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? firstList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    const keyA = 'agent:main:session-a';
    const keyB = 'agent:main:session-b';
    useChatStore.setState({
      sessions: [
        { key: keyA, status: 'done', hasActiveRun: false },
        { key: keyB, status: 'running', hasActiveRun: true },
      ],
      currentSessionKey: keyB,
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [keyB]: { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: keyA, ts: 11, status: 'running', hasActiveRun: true,
    });
    useChatStore.getState().handleSessionsChanged({
      key: keyB, status: 'done', hasActiveRun: false,
    });
    useChatStore.getState().handleSessionsChanged({
      key: keyA, ts: 12, status: 'done', hasActiveRun: false,
    });
    firstList.resolve({
      ts: 10,
      sessions: [
        { key: keyA, status: 'done', hasActiveRun: false },
        { key: keyB, status: 'done', hasActiveRun: false },
      ],
    });

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useSessionAttentionStore.getState().bySessionKey[keyA]).toEqual({
      observedBusy: false,
      unread: true,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[keyB]).toEqual({
      observedBusy: true,
      unread: false,
    });

    retryList.resolve({
      ts: 20,
      sessions: [
        { key: keyA, status: 'done', hasActiveRun: false },
        { key: keyB, status: 'running', hasActiveRun: true },
      ],
    });
    await loading;
    expect(listCalls).toBe(2);
  });

  it('forces one post-flight recovery for a buffered partial event', async () => {
    const firstList = deferred<Record<string, unknown>>();
    const recoveryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? firstList.promise : recoveryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', ts: 11, status: 'running', hasActiveRun: true,
    });
    firstList.resolve({
      ts: 10,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });

    await vi.waitFor(() => expect(listCalls).toBe(2));
    recoveryList.resolve({
      ts: 12,
      sessions: [{ key: 'agent:main:main', status: 'running', hasActiveRun: true }],
    });
    await loading;
    expect(listCalls).toBe(2);
  });

  it('forces throttled recovery for a standalone mismatched snapshot', async () => {
    const recoveryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve({
          ts: 10,
          sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
        });
      }
      return recoveryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main',
      ts: 11,
      session: { key: 'agent:main:other', status: 'running', hasActiveRun: true },
    });
    await vi.waitFor(() => expect(listCalls).toBe(2));

    recoveryList.resolve({
      ts: 12,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    await flushAsyncImports();
    await flushAsyncImports();
    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
    expect(listCalls).toBe(2);
  });

  it('preserves uncertain exact-key attention while reducing finite events after list failure', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    const sessionKey = 'agent:main:uncertain';
    useChatStore.setState({
      sessions: [{ key: sessionKey, status: 'done', hasActiveRun: false }],
      currentSessionKey: sessionKey,
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sessionKey]: { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey, ts: 11, status: 'running', hasActiveRun: true,
    });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey, status: 'done', hasActiveRun: false,
    });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey, ts: 12, status: 'done', hasActiveRun: false,
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
    expect(useSessionAttentionStore.getState().bySessionKey[sessionKey]).toEqual({
      observedBusy: true,
      unread: false,
    });

    retryList.resolve({
      ts: 20,
      sessions: [{ key: sessionKey, status: 'running', hasActiveRun: true }],
    });
    await loading;
    expect(listCalls).toBe(2);
  });

  it('folds an unrelated reliable key after list failure while preserving uncertain attention', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    const uncertainKey = 'agent:main:uncertain';
    const reliableKey = 'agent:main:reliable';
    useChatStore.setState({
      sessions: [
        { key: uncertainKey, status: 'done', hasActiveRun: false },
        { key: reliableKey, status: 'done', hasActiveRun: false },
      ],
      currentSessionKey: uncertainKey,
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [uncertainKey]: { observedBusy: true, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: uncertainKey, ts: 11, status: 'running', hasActiveRun: true,
    });
    useChatStore.getState().handleSessionsChanged({
      key: uncertainKey, status: 'done', hasActiveRun: false,
    });
    useChatStore.getState().handleSessionsChanged({
      key: uncertainKey, ts: 12, status: 'done', hasActiveRun: false,
    });
    useChatStore.getState().handleSessionsChanged({
      key: reliableKey, ts: 13, status: 'running', hasActiveRun: true,
    });
    useChatStore.getState().handleSessionsChanged({
      key: reliableKey, ts: 14, status: 'done', hasActiveRun: false,
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useSessionAttentionStore.getState().bySessionKey[uncertainKey]).toEqual({
      observedBusy: true,
      unread: false,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[reliableKey]).toEqual({
      observedBusy: false,
      unread: true,
    });

    retryList.resolve({
      ts: 20,
      sessions: [
        { key: uncertainKey, status: 'running', hasActiveRun: true },
        { key: reliableKey, status: 'done', hasActiveRun: false },
      ],
    });
    await loading;
    expect(listCalls).toBe(2);
  });

  it('preserves all attention for unscoped failed-list uncertainty while reducing catalog rows', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    const sessionKey = 'agent:main:reliable';
    useChatStore.setState({
      sessions: [{ key: sessionKey, status: 'done', hasActiveRun: false }],
      currentSessionKey: sessionKey,
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sessionKey]: { observedBusy: false, unread: true } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey, ts: 11, status: 'running', hasActiveRun: true,
    });
    useChatStore.getState().handleSessionsChanged({ status: 'done', hasActiveRun: false });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'running', hasActiveRun: true });
    expect(useSessionAttentionStore.getState().bySessionKey[sessionKey]).toEqual({
      observedBusy: false,
      unread: true,
    });

    retryList.resolve({
      ts: 20,
      sessions: [{ key: sessionKey, status: 'running', hasActiveRun: true }],
    });
    await loading;
    expect(listCalls).toBe(2);
  });

  it('consumes a forced reload queued during list-flight settlement', async () => {
    const firstList = deferred<Record<string, unknown>>();
    const recoveryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? firstList.promise : recoveryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    let queued = false;
    const unsubscribe = useChatStore.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        useChatStore.getState().handleSessionsChanged({
          key: 'agent:main:main',
          ts: 11,
          session: { key: 'agent:main:other', status: 'running', hasActiveRun: true },
        });
      });
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    firstList.resolve({
      ts: 10,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });

    await vi.waitFor(() => expect(listCalls).toBe(2));
    recoveryList.resolve({
      ts: 12,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    await loading;
    unsubscribe();
    expect(listCalls).toBe(2);
  });

  it('rejects a stale standalone insertion for a key absent from the successful list', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 100,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:stale:main',
      ts: 99,
      session: { key: 'agent:stale:main', status: 'running', hasActiveRun: true },
    });

    expect(useChatStore.getState().sessions.some((session) => session.key === 'agent:stale:main')).toBe(false);
  });

  it('allows equal and newer standalone insertions after a successful list', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 100,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:equal:main',
      ts: 100,
      session: { key: 'agent:equal:main', status: 'running', hasActiveRun: true },
    });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:newer:main',
      ts: 101,
      session: { key: 'agent:newer:main', status: 'running', hasActiveRun: true },
    });

    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual(expect.arrayContaining([
      'agent:equal:main',
      'agent:newer:main',
    ]));
  });

  it('resets the successful-list timestamp floor for a new Gateway generation', async () => {
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => {
      if (method !== 'sessions.list') return {};
      listCalls += 1;
      return {
        ts: listCalls === 1 ? 100 : 10,
        sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      };
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 2 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:reset:main',
      ts: 20,
      session: { key: 'agent:reset:main', status: 'running', hasActiveRun: true },
    });

    expect(useChatStore.getState().sessions.some((session) => session.key === 'agent:reset:main')).toBe(true);
  });

  it('keeps standalone activity monotonic for changed and unrelated rows and still cleans deletion', async () => {
    const changedKey = 'agent:changed:main';
    const unrelatedKey = 'agent:unrelated:main';
    const changedActivity = 1_700_000_000_900;
    const unrelatedActivity = 1_700_000_001_900;
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [
        { key: changedKey, updatedAt: 1_700_000_000_100 },
        { key: unrelatedKey, updatedAt: 1_700_000_001_100 },
      ],
      currentSessionKey: changedKey,
      sessionLastActivity: {
        [changedKey]: changedActivity,
        [unrelatedKey]: unrelatedActivity,
      },
    });

    useChatStore.getState().handleSessionsChanged({
      key: changedKey,
      ts: 10,
      session: { key: changedKey, updatedAt: 1_700_000_000_200, status: 'running' },
    });

    expect(useChatStore.getState().sessionLastActivity).toMatchObject({
      [changedKey]: changedActivity,
      [unrelatedKey]: unrelatedActivity,
    });

    useChatStore.getState().handleSessionsChanged({
      sessionKey: changedKey,
      reason: 'delete',
      ts: 11,
    });
    expect(useChatStore.getState().sessionLastActivity[changedKey]).toBeUndefined();
    expect(useChatStore.getState().sessionLastActivity[unrelatedKey]).toBe(unrelatedActivity);
  });

  it('keeps failed-list activity monotonic while reducing older catalog timestamps', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    const changedKey = 'agent:changed:main';
    const unrelatedKey = 'agent:unrelated:main';
    const changedActivity = 1_700_000_000_900;
    const unrelatedActivity = 1_700_000_001_900;
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [
        { key: changedKey, updatedAt: 1_700_000_000_100 },
        { key: unrelatedKey, updatedAt: 1_700_000_001_100 },
      ],
      currentSessionKey: changedKey,
      sessionLastActivity: {
        [changedKey]: changedActivity,
        [unrelatedKey]: unrelatedActivity,
      },
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: changedKey,
      ts: 10,
      session: { key: changedKey, updatedAt: 1_700_000_000_200, status: 'running' },
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessionLastActivity).toMatchObject({
      [changedKey]: changedActivity,
      [unrelatedKey]: unrelatedActivity,
    });

    retryList.resolve({
      ts: 20,
      sessions: [
        { key: changedKey, updatedAt: 1_700_000_000_300 },
        { key: unrelatedKey, updatedAt: 1_700_000_001_300 },
      ],
    });
    await loading;
  });

  it('periodic reconciliation restores subscription after a missed running event', async () => {
    vi.useFakeTimers();
    try {
      const handlers = new Map<string, (payload: unknown) => void>();
      hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
        handlers.set(eventName, handler);
        return () => {};
      });
      const running = {
        state: 'running' as const, port: 18789, pid: 40, connectedAt: 400, gatewayReady: true,
      };
      hostApiMock.gateway.status.mockResolvedValue(running);
      hostApiMock.gateway.rpc.mockImplementation(async (method: string) => (
        method === 'sessions.list' ? { ts: 1, sessions: [] } : {}
      ));
      await import('@/stores/chat');
      const { useGatewayStore } = await import('@/stores/gateway');
      await useGatewayStore.getState().init();
      await vi.advanceTimersByTimeAsync(0);
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(1);

      handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
      expect(useGatewayStore.getState().status.state).toBe('stopped');

      hostApiMock.gateway.status.mockResolvedValue(running);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(useGatewayStore.getState().status).toMatchObject({ state: 'running', pid: 40, connectedAt: 400 });
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('periodic reconciliation subscribes once for a same-state new identity and ignores duplicates', async () => {
    vi.useFakeTimers();
    try {
      const firstIdentity = {
        state: 'running' as const, port: 18789, pid: 50, connectedAt: 500, gatewayReady: true,
      };
      hostApiMock.gateway.status.mockResolvedValue(firstIdentity);
      hostApiMock.gateway.rpc.mockImplementation(async (method: string) => (
        method === 'sessions.list' ? { ts: 1, sessions: [] } : {}
      ));
      await import('@/stores/chat');
      const { useGatewayStore } = await import('@/stores/gateway');
      await useGatewayStore.getState().init();
      await vi.advanceTimersByTimeAsync(0);
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(1);

      const secondIdentity = { ...firstIdentity, pid: 51, connectedAt: 501 };
      hostApiMock.gateway.status.mockResolvedValue(secondIdentity);
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(useGatewayStore.getState().status).toMatchObject({ pid: 51, connectedAt: 501 });
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(hostApiMock.gateway.rpc.mock.calls.filter(([method]) => method === 'sessions.subscribe')).toHaveLength(2);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('applies the successful-list floor while reducing buffered events after list failure', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve({
          ts: 100,
          sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
        });
      }
      return listCalls === 2 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
      currentSessionKey: 'agent:main:main',
    });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:stale:main',
      ts: 99,
      session: { key: 'agent:stale:main', status: 'running', hasActiveRun: true },
    });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:equal:main',
      ts: 100,
      session: { key: 'agent:equal:main', status: 'running', hasActiveRun: true },
    });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:newer:main',
      ts: 101,
      session: { key: 'agent:newer:main', status: 'running', hasActiveRun: true },
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(3));
    const sessionKeys = useChatStore.getState().sessions.map((session) => session.key);
    expect(sessionKeys).not.toContain('agent:stale:main');
    expect(sessionKeys).toEqual(expect.arrayContaining(['agent:equal:main', 'agent:newer:main']));

    retryList.reject(new Error('retry failed'));
    await loading;
    expect(listCalls).toBe(3);
  });

  it('cleans exact deleted metadata and attention during failed-list reduction', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    const deletedKey = 'agent:deleted:main';
    const unrelatedKey = 'agent:unrelated:main';
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: deletedKey }, { key: unrelatedKey }],
      currentSessionKey: unrelatedKey,
      sessionLabels: {
        [deletedKey]: 'Deleted label',
        [unrelatedKey]: 'Unrelated label',
      },
      sessionLastActivity: {
        [deletedKey]: 1_700_000_009_000,
        [unrelatedKey]: 1_700_000_010_000,
      },
    });
    useSessionAttentionStore.setState({
      bySessionKey: {
        [deletedKey]: { observedBusy: false, unread: true },
        [unrelatedKey]: { observedBusy: true, unread: false },
      },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      sessionKey: deletedKey,
      reason: 'delete',
      ts: 10,
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);
    expect(useChatStore.getState().sessionLabels).toEqual({ [unrelatedKey]: 'Unrelated label' });
    expect(useChatStore.getState().sessionLastActivity).toEqual({
      [unrelatedKey]: 1_700_000_010_000,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[deletedKey]).toBeUndefined();
    expect(useSessionAttentionStore.getState().bySessionKey[unrelatedKey]).toEqual({
      observedBusy: true,
      unread: false,
    });

    retryList.reject(new Error('retry failed'));
    await loading;
    expect(listCalls).toBe(2);
  });

  it('transactionally rebuilds attention and metadata for successful delete-recreate replay', async () => {
    const list = deferred<Record<string, unknown>>();
    const sessionKey = 'agent:main:recreated';
    const unrelatedKey = 'agent:main:unrelated';
    hostApiMock.gateway.rpc.mockImplementation((method: string) => (
      method === 'sessions.list' ? list.promise : Promise.resolve({})
    ));
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: sessionKey }, { key: unrelatedKey }],
      currentSessionKey: sessionKey,
      sessionLabels: {
        [sessionKey]: 'Old label',
        [unrelatedKey]: 'Unrelated label',
      },
      sessionLastActivity: {
        [sessionKey]: 1_700_000_009_000,
        [unrelatedKey]: 1_700_000_010_000,
      },
    });
    useSessionAttentionStore.setState({
      bySessionKey: {
        [sessionKey]: { observedBusy: false, unread: true },
        [unrelatedKey]: { observedBusy: true, unread: false },
      },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      sessionKey,
      reason: 'delete',
      ts: 11,
    });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey,
      ts: 12,
      session: {
        key: sessionKey,
        label: 'New label',
        updatedAt: 1_700_000_001_000,
        status: 'running',
        hasActiveRun: true,
      },
    });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey,
      ts: 13,
      session: {
        key: sessionKey,
        label: 'New label',
        updatedAt: 1_700_000_002_000,
        status: 'done',
        hasActiveRun: false,
      },
    });
    list.resolve({
      ts: 10,
      sessions: [
        { key: sessionKey, label: 'Old label', updatedAt: 1_700_000_000_000, status: 'done', hasActiveRun: false },
        { key: unrelatedKey },
      ],
    });
    await loading;

    expect(useChatStore.getState().sessions.find((session) => session.key === sessionKey)).toMatchObject({
      label: 'New label',
      updatedAt: 1_700_000_002_000,
      status: 'done',
      hasActiveRun: false,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[sessionKey]).toEqual({
      observedBusy: false,
      unread: true,
    });
    expect(useChatStore.getState().sessionLabels).toEqual({
      [sessionKey]: 'New label',
      [unrelatedKey]: 'Unrelated label',
    });
    expect(useChatStore.getState().sessionLastActivity).toEqual({
      [sessionKey]: 1_700_000_002_000,
      [unrelatedKey]: 1_700_000_010_000,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[unrelatedKey]).toEqual({
      observedBusy: true,
      unread: false,
    });
  });

  it('transactionally rebuilds attention and metadata for failed delete-recreate reduction', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    const sessionKey = 'agent:main:recreated';
    const unrelatedKey = 'agent:main:unrelated';
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    const {
      beginSessionLabelHydration,
      finishSessionLabelHydration,
      getSessionLabelHydrationVersion,
    } = await import('@/stores/chat/session-label-hydration');
    const hydrationSession = {
      key: sessionKey,
      updatedAt: 1_700_000_002_000,
      label: 'New label',
    };
    const oldHydrationVersion = getSessionLabelHydrationVersion(hydrationSession, {});
    expect(beginSessionLabelHydration(sessionKey, oldHydrationVersion)).toBe(true);
    useChatStore.setState({
      sessions: [{ key: sessionKey }, { key: unrelatedKey }],
      currentSessionKey: sessionKey,
      sessionLabels: {
        [sessionKey]: 'Old label',
        [unrelatedKey]: 'Unrelated label',
      },
      sessionLastActivity: {
        [sessionKey]: 1_700_000_009_000,
        [unrelatedKey]: 1_700_000_010_000,
      },
    });
    useSessionAttentionStore.setState({
      bySessionKey: {
        [sessionKey]: { observedBusy: false, unread: true },
        [unrelatedKey]: { observedBusy: true, unread: false },
      },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({ sessionKey, reason: 'delete', ts: 11 });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey,
      ts: 12,
      session: {
        key: sessionKey,
        label: 'New label',
        updatedAt: 1_700_000_001_000,
        status: 'running',
        hasActiveRun: true,
      },
    });
    useChatStore.getState().handleSessionsChanged({
      key: sessionKey,
      ts: 13,
      session: {
        key: sessionKey,
        label: 'New label',
        updatedAt: 1_700_000_002_000,
        status: 'done',
        hasActiveRun: false,
      },
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions.find((session) => session.key === sessionKey)).toMatchObject({
      label: 'New label',
      updatedAt: 1_700_000_002_000,
      status: 'done',
      hasActiveRun: false,
    });
    expect(useSessionAttentionStore.getState().bySessionKey[sessionKey]).toEqual({
      observedBusy: false,
      unread: true,
    });
    expect(useChatStore.getState().sessionLabels).toEqual({
      [sessionKey]: 'New label',
      [unrelatedKey]: 'Unrelated label',
    });
    expect(useChatStore.getState().sessionLastActivity).toEqual({
      [sessionKey]: 1_700_000_002_000,
      [unrelatedKey]: 1_700_000_010_000,
    });
    const newHydrationVersion = getSessionLabelHydrationVersion(hydrationSession, {});
    expect(newHydrationVersion).not.toBe(oldHydrationVersion);
    finishSessionLabelHydration(sessionKey, oldHydrationVersion, 'error');
    expect(beginSessionLabelHydration(sessionKey, newHydrationVersion)).toBe(true);

    retryList.reject(new Error('retry failed'));
    await loading;
    expect(listCalls).toBe(2);
  });

  it('removes attention and metadata for successful buffered deletion without recreation', async () => {
    const list = deferred<Record<string, unknown>>();
    const deletedKey = 'agent:main:deleted';
    const unrelatedKey = 'agent:main:unrelated';
    hostApiMock.gateway.rpc.mockImplementation((method: string) => (
      method === 'sessions.list' ? list.promise : Promise.resolve({})
    ));
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key: deletedKey }, { key: unrelatedKey }],
      currentSessionKey: unrelatedKey,
      sessionLabels: { [deletedKey]: 'Deleted label', [unrelatedKey]: 'Unrelated label' },
      sessionLastActivity: { [deletedKey]: 9_000, [unrelatedKey]: 10_000 },
    });
    useSessionAttentionStore.setState({
      bySessionKey: {
        [deletedKey]: { observedBusy: false, unread: true },
        [unrelatedKey]: { observedBusy: true, unread: false },
      },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({ sessionKey: deletedKey, reason: 'delete', ts: 11 });
    list.resolve({ ts: 10, sessions: [{ key: deletedKey }, { key: unrelatedKey }] });
    await loading;

    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);
    expect(useSessionAttentionStore.getState().bySessionKey[deletedKey]).toBeUndefined();
    expect(useChatStore.getState().sessionLabels).toEqual({ [unrelatedKey]: 'Unrelated label' });
    expect(useChatStore.getState().sessionLastActivity).toEqual({ [unrelatedKey]: 10_000 });
    expect(useSessionAttentionStore.getState().bySessionKey[unrelatedKey]).toEqual({
      observedBusy: true,
      unread: false,
    });
  });
});
