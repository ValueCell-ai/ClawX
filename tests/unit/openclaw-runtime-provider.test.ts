// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { renameSessionMock } = vi.hoisted(() => ({
  renameSessionMock: vi.fn(),
}));

vi.mock('@electron/services/sessions-api', () => ({
  createSessionsApi: () => ({
    delete: vi.fn(async () => ({ success: true })),
    history: vi.fn(async () => ({ success: true, messages: [] })),
    rename: renameSessionMock,
    summaries: vi.fn(async () => ({ success: true, summaries: [] })),
  }),
}));

function createGatewayManagerMock() {
  return {
    on: vi.fn(),
    getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
    checkHealth: vi.fn(async () => ({ ok: true })),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    debouncedReload: vi.fn(),
    debouncedRestart: vi.fn(),
    rpc: vi.fn(),
  };
}

function gatewayCronJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cron-1',
    name: 'Daily summary',
    enabled: true,
    createdAtMs: Date.parse('2026-06-09T00:00:00.000Z'),
    updatedAtMs: Date.parse('2026-06-09T00:00:00.000Z'),
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    payload: { kind: 'agentTurn', message: 'summarize' },
    state: {},
    ...overrides,
  };
}

describe('OpenClawRuntimeProvider runtime contract adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes session rename through the OpenClaw session API facade', async () => {
    const gatewayManager = createGatewayManagerMock();
    renameSessionMock.mockResolvedValueOnce({ success: true });
    const { OpenClawRuntimeProvider } = await import('@electron/runtime/openclaw-provider');
    const provider = new OpenClawRuntimeProvider(gatewayManager as never);

    await expect(provider.rpc('sessions.rename', {
      sessionKey: 'agent:main:abc123',
      label: 'Renamed OpenClaw',
    })).resolves.toEqual({ success: true });

    expect(renameSessionMock).toHaveBeenCalledWith({
      sessionKey: 'agent:main:abc123',
      label: 'Renamed OpenClaw',
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('accepts Host cron.create payloads and adapts them to Gateway cron.add', async () => {
    const gatewayManager = createGatewayManagerMock();
    gatewayManager.rpc.mockResolvedValueOnce(gatewayCronJob());
    const { OpenClawRuntimeProvider } = await import('@electron/runtime/openclaw-provider');
    const provider = new OpenClawRuntimeProvider(gatewayManager as never);

    await expect(provider.rpc('cron.create', {
      name: 'Daily summary',
      message: 'summarize',
      schedule: '0 9 * * *',
      enabled: true,
      agentId: 'main',
      delivery: { mode: 'none' },
    })).resolves.toMatchObject({
      id: 'cron-1',
      name: 'Daily summary',
      message: 'summarize',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      agentId: 'main',
    });

    expect(gatewayManager.rpc).toHaveBeenCalledWith('cron.add', {
      name: 'Daily summary',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'summarize' },
      enabled: true,
      wakeMode: 'next-heartbeat',
      sessionTarget: 'isolated',
      agentId: 'main',
      delivery: { mode: 'none' },
    });
  });

  it('accepts Host cron.update payloads and adapts them to Gateway cron.update patches', async () => {
    const gatewayManager = createGatewayManagerMock();
    gatewayManager.rpc.mockResolvedValueOnce(gatewayCronJob({
      payload: { kind: 'agentTurn', message: 'updated summary' },
      schedule: { kind: 'cron', expr: '0 10 * * *' },
    }));
    const { OpenClawRuntimeProvider } = await import('@electron/runtime/openclaw-provider');
    const provider = new OpenClawRuntimeProvider(gatewayManager as never);

    await expect(provider.rpc('cron.update', {
      id: 'cron-1',
      input: {
        message: 'updated summary',
        schedule: '0 10 * * *',
        enabled: false,
      },
    })).resolves.toMatchObject({
      id: 'cron-1',
      message: 'updated summary',
      schedule: { kind: 'cron', expr: '0 10 * * *' },
    });

    expect(gatewayManager.rpc).toHaveBeenCalledWith('cron.update', {
      id: 'cron-1',
      patch: {
        schedule: { kind: 'cron', expr: '0 10 * * *' },
        enabled: false,
        payload: { kind: 'agentTurn', message: 'updated summary' },
      },
    });
  });

  it('delegates channel config refresh policy to the OpenClaw gateway lifecycle', async () => {
    const gatewayManager = createGatewayManagerMock();
    const { OpenClawRuntimeProvider } = await import('@electron/runtime/openclaw-provider');
    const provider = new OpenClawRuntimeProvider(gatewayManager as never);

    await provider.refreshConfig?.({ scope: 'channels', reason: 'channel:saveConfig:feishu', forceRestart: false });
    await provider.refreshConfig?.({ scope: 'channels', reason: 'channel:setEnabled:feishu', forceRestart: true });

    expect(gatewayManager.debouncedReload).toHaveBeenCalledWith(150);
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(150);
  });
});
