import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiMock = vi.hoisted(() => ({
  gateway: {
    status: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    health: vi.fn(),
    rpc: vi.fn(),
  },
  sessions: {
    summaries: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
  },
}));
const hostEventSubscriptionMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsyncImports(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

vi.mock('@/lib/host-api', () => ({ hostApi: hostApiMock }));

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
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => (
      method === 'sessions.list' ? { ts: 1, sessions: [] } : {}
    ));
    hostApiMock.sessions.summaries.mockResolvedValue({ success: true, summaries: [] });
  });

  it('keeps status, presence, channel, and catalog subscriptions out of legacy chat projections', async () => {
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
    expect(hostEventSubscriptionMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));
    expect(hostEventSubscriptionMock).not.toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(hostEventSubscriptionMock).not.toHaveBeenCalledWith('chat:runtime-event', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
    handlers.get('gateway:health')?.({ ok: true, ts: 1 });
    expect(useGatewayStore.getState().health?.openclawHealth).toEqual({ ok: true, ts: 1 });
    handlers.get('gateway:presence')?.([{ mode: 'gateway', ts: 2 }]);
    expect(useGatewayStore.getState().health?.presence).toEqual([{ mode: 'gateway', ts: 2 }]);
  });

  it('subscribes and force-hydrates once for each ready runtime identity', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
    const firstEpoch = {
      state: 'running' as const,
      port: 18789,
      pid: 10,
      connectedAt: 100,
      gatewayReady: true,
    };
    hostApiMock.gateway.status.mockResolvedValue(firstEpoch);

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.some(([method]) => method === 'sessions.list')).toBe(true);
    });
    const initialSubscribeCalls = hostApiMock.gateway.rpc.mock.calls.filter(
      ([method]) => method === 'sessions.subscribe',
    ).length;
    const initialListCalls = hostApiMock.gateway.rpc.mock.calls.filter(
      ([method]) => method === 'sessions.list',
    ).length;

    handlers.get('gateway:status')?.(firstEpoch);
    handlers.get('gateway:status')?.({ ...firstEpoch, pid: 11, connectedAt: 200 });
    await vi.waitFor(() => {
      expect(hostApiMock.gateway.rpc.mock.calls.filter(
        ([method]) => method === 'sessions.subscribe',
      )).toHaveLength(initialSubscribeCalls + 1);
      expect(hostApiMock.gateway.rpc.mock.calls.filter(
        ([method]) => method === 'sessions.list',
      )).toHaveLength(initialListCalls + 1);
    });
  });

  it('routes sessions.changed through the generic notification handler', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });
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
  });

  it('queues a new generation behind an in-flight list and fences the old response', async () => {
    const firstList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method === 'sessions.subscribe') return Promise.resolve({});
      if (method === 'sessions.list') {
        listCalls += 1;
        return listCalls === 1
          ? firstList.promise
          : Promise.resolve({ ts: 20, sessions: [{ key: 'agent:main:main', status: 'done' }] });
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

    firstList.resolve({ ts: 10, sessions: [{ key: 'agent:main:old', status: 'running' }] });
    await ordinaryLoad;
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(useChatStore.getState().sessions).toEqual([
      expect.objectContaining({ key: 'agent:main:main', status: 'done' }),
    ]);
  });

  it('folds buffered session transitions transactionally into attention state', async () => {
    const list = deferred<Record<string, unknown>>();
    hostApiMock.gateway.rpc.mockImplementation((method: string) => (
      method === 'sessions.list' ? list.promise : Promise.resolve({})
    ));
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
    list.resolve({ ts: 10, sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }] });
    await loading;

    expect(useChatStore.getState().sessions[0]).toMatchObject({ status: 'done', hasActiveRun: false });
    expect(useSessionAttentionStore.getState().bySessionKey['agent:main:main']).toEqual({
      observedBusy: false,
      unread: true,
    });
  });

  it('keeps activity monotonic and cleans metadata on sessions.changed deletion', async () => {
    const changedKey = 'agent:changed:main';
    const unrelatedKey = 'agent:unrelated:main';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [
        { key: changedKey, updatedAt: 1_700_000_000_100 },
        { key: unrelatedKey, updatedAt: 1_700_000_001_100 },
      ],
      currentSessionKey: changedKey,
      sessionLabels: { [changedKey]: 'Changed', [unrelatedKey]: 'Unrelated' },
      sessionLastActivity: {
        [changedKey]: 1_700_000_000_900,
        [unrelatedKey]: 1_700_000_001_900,
      },
    });

    useChatStore.getState().handleSessionsChanged({
      key: changedKey,
      ts: 10,
      session: { key: changedKey, updatedAt: 1_700_000_000_200, status: 'running' },
    });
    expect(useChatStore.getState().sessionLastActivity[changedKey]).toBe(1_700_000_000_900);

    useChatStore.getState().handleSessionsChanged({
      sessionKey: changedKey,
      reason: 'delete',
      ts: 11,
    });
    expect(useChatStore.getState().sessionLabels).toEqual({ [unrelatedKey]: 'Unrelated' });
    expect(useChatStore.getState().sessionLastActivity).toEqual({
      [unrelatedKey]: 1_700_000_001_900,
    });
  });

  it('selects a valid fallback when a standalone event deletes the current session', async () => {
    const deletedKey = 'agent:main:current';
    const fallbackKey = 'agent:main:fallback';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: deletedKey }, { key: fallbackKey, updatedAt: 10 }],
      currentSessionKey: deletedKey,
      currentAgentId: 'main',
      sessionLabels: { [deletedKey]: 'Deleted', [fallbackKey]: 'Fallback' },
      sessionLastActivity: { [deletedKey]: 20, [fallbackKey]: 10 },
    });

    useChatStore.getState().handleSessionsChanged({
      sessionKey: deletedKey,
      reason: 'delete',
      ts: 11,
    });

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: fallbackKey,
      currentAgentId: 'main',
      sessions: [{ key: fallbackKey, updatedAt: 10 }],
      sessionLabels: { [fallbackKey]: 'Fallback' },
      sessionLastActivity: { [fallbackKey]: 10 },
    });
  });

  it('selects a valid fallback when an exact update hides the current session', async () => {
    const hiddenKey = 'agent:main:feishu:current';
    const fallbackKey = 'agent:main:fallback';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [
        { key: hiddenKey, lastMessagePreview: 'real message' },
        { key: fallbackKey, updatedAt: 10 },
      ],
      currentSessionKey: hiddenKey,
      currentAgentId: 'main',
      sessionLabels: { [hiddenKey]: 'Channel', [fallbackKey]: 'Fallback' },
      sessionLastActivity: { [hiddenKey]: 20, [fallbackKey]: 10 },
    });

    useChatStore.getState().handleSessionsChanged({
      key: hiddenKey,
      ts: 11,
      session: { key: hiddenKey, lastMessagePreview: null },
    });

    expect(useChatStore.getState()).toMatchObject({
      currentSessionKey: fallbackKey,
      sessions: [{ key: fallbackKey, updatedAt: 10 }],
      sessionLabels: { [fallbackKey]: 'Fallback' },
      sessionLastActivity: { [fallbackKey]: 10 },
    });
  });

  it('selects a fallback during failed-list exact-current deletion reduction', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1
        ? failedList.promise
        : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:current' }, { key: 'agent:main:fallback', updatedAt: 10 }],
      currentSessionKey: 'agent:main:current',
      currentAgentId: 'main',
      sessionLabels: { 'agent:main:current': 'Current', 'agent:main:fallback': 'Fallback' },
      sessionLastActivity: {},
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      sessionKey: 'agent:main:current', reason: 'delete', ts: 11,
    });
    failedList.reject(new Error('list failed'));
    await vi.waitFor(() => {
      expect(useChatStore.getState().currentSessionKey).toBe('agent:main:fallback');
    });
    expect(useChatStore.getState().sessions.some(
      (session) => session.key === 'agent:main:current',
    )).toBe(false);
    retryList.resolve({ ts: 20, sessions: [{ key: 'agent:main:fallback', updatedAt: 10 }] });
    await loading;

    expect(listCalls).toBe(2);
    expect(useChatStore.getState().sessions.some(
      (session) => session.key === 'agent:main:current',
    )).toBe(false);
  });

  it('recovers an untimestamped event with one forced catalog reload', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 20,
      sessions: [{ key: 'agent:main:main', status: 'done' }],
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'running' }],
      currentSessionKey: 'agent:main:main',
    });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', status: 'done',
    });

    await vi.waitFor(() => expect(hostApiMock.gateway.rpc).toHaveBeenCalledWith(
      'sessions.list',
      { includeDerivedTitles: true, includeLastMessage: true },
      undefined,
    ));
    await vi.waitFor(() => expect(useChatStore.getState().sessions[0]?.status).toBe('done'));
  });

  it('reduces finite events after list failure and retries the catalog once', async () => {
    const failedList = deferred<Record<string, unknown>>();
    const retryList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1 ? failedList.promise : retryList.promise;
    });
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      sessions: [{ key: 'agent:main:main', status: 'done' }],
      currentSessionKey: 'agent:main:main',
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:main', ts: 11, status: 'running', hasActiveRun: true,
    });
    failedList.reject(new Error('list failed'));

    await vi.waitFor(() => expect(useChatStore.getState().sessions[0]).toMatchObject({
      status: 'running', hasActiveRun: true,
    }));
    await vi.waitFor(() => expect(listCalls).toBe(2));
    retryList.resolve({
      ts: 20,
      sessions: [{ key: 'agent:main:main', status: 'done', hasActiveRun: false }],
    });
    await loading;

    expect(useChatStore.getState().sessions[0]).toMatchObject({
      status: 'done', hasActiveRun: false,
    });
  });

  it('resets the standalone timestamp floor across Gateway generations', async () => {
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation(async (method: string) => {
      if (method !== 'sessions.list') return {};
      listCalls += 1;
      return {
        ts: listCalls === 1 ? 100 : 10,
        sessions: [{ key: 'agent:main:main', status: 'done' }],
      };
    });
    const { useChatStore } = await import('@/stores/chat');
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 2 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:new',
      ts: 20,
      session: { key: 'agent:main:new', status: 'running' },
    });

    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: 'agent:main:new', status: 'running',
    }));
  });

  it('runs a forced reload queued during in-flight settlement', async () => {
    const firstList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      return listCalls === 1
        ? firstList.promise
        : Promise.resolve({ ts: 20, sessions: [{ key: 'agent:main:new' }] });
    });
    const { useChatStore } = await import('@/stores/chat');

    const first = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    const forced = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    firstList.resolve({ ts: 10, sessions: [{ key: 'agent:main:old' }] });
    await Promise.all([first, forced]);

    expect(listCalls).toBe(2);
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: 'agent:main:new',
    }));
  });

  it('rejects stale standalone insertion below the successful-list floor', async () => {
    hostApiMock.gateway.rpc.mockResolvedValue({
      ts: 100,
      sessions: [{ key: 'agent:main:main' }],
    });
    const { useChatStore } = await import('@/stores/chat');
    await useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });

    useChatStore.getState().handleSessionsChanged({
      key: 'agent:main:stale',
      ts: 50,
      session: { key: 'agent:main:stale', status: 'running' },
    });

    expect(useChatStore.getState().sessions.some(
      (session) => session.key === 'agent:main:stale',
    )).toBe(false);
  });

  it('replays complete delete/recreate ordering into row metadata and attention', async () => {
    const list = deferred<Record<string, unknown>>();
    const key = 'agent:main:recreated';
    hostApiMock.gateway.rpc.mockImplementation((method: string) => (
      method === 'sessions.list' ? list.promise : Promise.resolve({})
    ));
    const { useChatStore } = await import('@/stores/chat');
    const { useSessionAttentionStore } = await import('@/stores/session-attention');
    useChatStore.setState({
      sessions: [{ key, label: 'Old', updatedAt: 1_000 }],
      currentSessionKey: key,
      sessionLabels: { [key]: 'Old' },
      sessionLastActivity: { [key]: 1_000 },
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [key]: { observedBusy: false, unread: false } },
      visibleSessionKey: null,
    });

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    useChatStore.getState().handleSessionsChanged({ sessionKey: key, reason: 'delete', ts: 11 });
    useChatStore.getState().handleSessionsChanged({
      key,
      ts: 12,
      session: { key, label: 'New', updatedAt: 2_000, status: 'running', hasActiveRun: true },
    });
    useChatStore.getState().handleSessionsChanged({
      key,
      ts: 13,
      session: { key, label: 'New', updatedAt: 3_000, status: 'done', hasActiveRun: false },
    });
    list.resolve({ ts: 10, sessions: [{ key, label: 'Old', updatedAt: 1_000 }] });
    await loading;

    expect(useChatStore.getState().sessions.find((session) => session.key === key)).toMatchObject({
      label: 'New', updatedAt: 3_000_000, status: 'done', hasActiveRun: false,
    });
    expect(useChatStore.getState().sessionLabels[key]).toBe('New');
    expect(useChatStore.getState().sessionLastActivity[key]).toBe(3_000_000);
    expect(useSessionAttentionStore.getState().bySessionKey[key]).toEqual({
      observedBusy: false,
      unread: true,
    });
  });

  it('does not suppress a recreated row when a queued load advances generations', async () => {
    const firstList = deferred<Record<string, unknown>>();
    const secondList = deferred<Record<string, unknown>>();
    let listCalls = 0;
    const key = 'agent:main:recreated-generation';
    hostApiMock.gateway.rpc.mockImplementation((method: string) => {
      if (method !== 'sessions.list') return Promise.resolve({});
      listCalls += 1;
      if (listCalls === 1) return firstList.promise;
      if (listCalls === 2) return secondList.promise;
      return Promise.resolve({ ts: 20, sessions: [{ key, label: 'Recreated' }] });
    });
    const { useChatStore } = await import('@/stores/chat');

    const loading = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 1 });
    const sameGenerationReload = useChatStore.getState().loadSessions({
      force: true,
      gatewayGeneration: 1,
    });
    useChatStore.getState().handleSessionsChanged({ sessionKey: key, reason: 'delete', ts: 11 });
    firstList.resolve({ ts: 10, sessions: [{ key, label: 'Old' }] });
    await vi.waitFor(() => expect(listCalls).toBe(2));
    const nextGeneration = useChatStore.getState().loadSessions({ force: true, gatewayGeneration: 2 });
    secondList.resolve({ ts: 12, sessions: [{ key, label: 'Old' }] });
    await Promise.all([loading, sameGenerationReload, nextGeneration]);

    expect(listCalls).toBe(3);
    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key,
      label: 'Recreated',
    }));
  });
});
