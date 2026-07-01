/**
 * Bisection tests for 0d794cd ("fix per channel per session") vs de3046a.
 *
 * Part A — dmScope effect is simulated by Gateway event sessionKey alignment
 * (de3046a production used dmScope=main → events on agent:main:main while UI
 * showed feishu keys; 0d794cd sets per-channel-peer → keys match).
 *
 * Part B — sessions.subscribe adds handleGatewaySessionsChanged → loadSessions.
 */
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

function captureHandlers() {
  const handlers = new Map<string, (payload: unknown) => void>();
  hostEventSubscriptionMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
    handlers.set(eventName, handler);
    return () => {};
  });
  return handlers;
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
    onGatewaySessionsChanged: (handler: unknown) => hostEventSubscriptionMock('gateway:sessions-changed', handler),
    onChatRuntimeEvent: (handler: unknown) => hostEventSubscriptionMock('chat:runtime-event', handler),
    onGatewayChannelStatus: (handler: unknown) => hostEventSubscriptionMock('gateway:channel-status', handler),
  },
}));

const FEISHU_KEY = 'agent:main:feishu:direct:ou_test';
const MAIN_KEY = 'agent:main:main';
const OTHER_FEISHU_KEY = 'agent:main:feishu:direct:ou_other';

describe('bisection 0d794cd vs de3046a', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hostApiMock.gateway.status.mockResolvedValue({ state: 'running', port: 18789, gatewayReady: true });
  });

  async function initGatewayHandlers() {
    const handlers = captureHandlers();
    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();
    return handlers;
  }

  function subscribedEvents(): string[] {
    return hostEventSubscriptionMock.mock.calls.map(([eventName]) => String(eventName));
  }

  function hasSessionsChangedWiring(): boolean {
    return subscribedEvents().includes('gateway:sessions-changed');
  }

  describe('Part A — dmScope key alignment (simulated via runtime event sessionKey)', () => {
    it('de3046a baseline: run.started on main key does NOT reload history for feishu view', async () => {
      const handlers = await initGatewayHandlers();
      const { useChatStore } = await import('@/stores/chat');
      const loadHistory = vi.fn(async () => {});
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        sending: true,
        activeRunId: 'run-user',
        lastUserMessageAt: Date.now(),
        loadHistory,
      });

      handlers.get('chat:runtime-event')?.({
        type: 'run.started',
        runId: 'run-inbound',
        sessionKey: MAIN_KEY,
        startedAt: Date.now(),
      });
      await flushAsyncImports();

      expect(loadHistory).not.toHaveBeenCalled();
    });

    it('0d794cd with dmScope: aligned run.started DOES reload history (regression trigger)', async () => {
      const handlers = await initGatewayHandlers();
      const { useChatStore } = await import('@/stores/chat');
      const loadHistory = vi.fn(async () => {});
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        sending: true,
        activeRunId: 'run-user',
        lastUserMessageAt: Date.now(),
        loadHistory,
      });

      handlers.get('chat:runtime-event')?.({
        type: 'run.started',
        runId: 'run-user',
        sessionKey: FEISHU_KEY,
        startedAt: Date.now(),
      });
      await flushAsyncImports();

      expect(loadHistory).toHaveBeenCalled();
    });

    it('0d794cd with dmScope: aligned run.ended also reloads history', async () => {
      const handlers = await initGatewayHandlers();
      const { useChatStore } = await import('@/stores/chat');
      const loadHistory = vi.fn(async () => {});
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        sending: true,
        activeRunId: 'run-user',
        lastUserMessageAt: Date.now(),
        loadHistory,
      });

      handlers.get('chat:runtime-event')?.({
        type: 'run.ended',
        runId: 'run-user',
        sessionKey: FEISHU_KEY,
        status: 'completed',
        endedAt: Date.now(),
      });
      await flushAsyncImports();

      expect(loadHistory).toHaveBeenCalled();
    });
  });

  describe('Part B — sessions.subscribe (sessions.changed handler)', () => {
    it('records whether gateway:sessions-changed is wired (de3046a=false, 0d794cd=true)', async () => {
      await initGatewayHandlers();
      const wired = hasSessionsChangedWiring();
       
      console.log(`[bisect] gateway:sessions-changed wired=${wired}`);
      expect([true, false]).toContain(wired);
    });

    it('other-session sessions.changed triggers loadSessions only when wired', async () => {
      const handlers = await initGatewayHandlers();
      const wired = hasSessionsChangedWiring();

      const { useChatStore } = await import('@/stores/chat');
      const loadSessions = vi.fn(async () => {});
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        loadSessions,
      });

      handlers.get('gateway:sessions-changed')?.({
        sessionKey: OTHER_FEISHU_KEY,
        phase: 'start',
        ts: Date.now(),
      });
      await flushAsyncImports();

      if (wired) {
        expect(loadSessions).toHaveBeenCalled();
      } else {
        expect(handlers.has('gateway:sessions-changed')).toBe(false);
        expect(loadSessions).not.toHaveBeenCalled();
      }
    });

    it('current-session sessions.changed skips loadSessions when wired', async () => {
      const handlers = await initGatewayHandlers();
      if (!hasSessionsChangedWiring()) {
        expect(handlers.has('gateway:sessions-changed')).toBe(false);
        return;
      }

      const { useChatStore } = await import('@/stores/chat');
      const loadSessions = vi.fn(async () => {});
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        loadSessions,
      });

      handlers.get('gateway:sessions-changed')?.({
        sessionKey: FEISHU_KEY,
        phase: 'start',
        ts: Date.now(),
      });
      await flushAsyncImports();

      expect(loadSessions).not.toHaveBeenCalled();
    });

    it('loadSessions reconcile can clear in-flight sending (path exists on both commits; 0d794cd triggers it via sessions.changed)', async () => {
      await initGatewayHandlers();
      // updatedAt newer than the in-flight send clears run lifecycle.
      const lastUserMessageAt = 1_779_693_769_991;
      hostApiMock.gateway.rpc.mockResolvedValue({
        sessions: [{
          key: FEISHU_KEY,
          updatedAt: 1_779_694_521_057,
          status: 'done',
          hasActiveRun: false,
          lastMessagePreview: 'hello from feishu',
        }],
      });

      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        currentSessionKey: FEISHU_KEY,
        sessions: [{ key: FEISHU_KEY }],
        sending: true,
        activeRunId: 'run-active',
        pendingFinal: true,
        lastUserMessageAt,
      });

      await useChatStore.getState().loadSessions();

      expect(useChatStore.getState().sending).toBe(false);
      expect(useChatStore.getState().activeRunId).toBeNull();
    });
  });
});
