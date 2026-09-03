// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCronApi } from '@electron/services/cron-api';

const configState = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: vi.fn(async (
    mutator: (config: Record<string, unknown>) => void | Promise<void>,
  ) => {
    await mutator(configState.value);
    return true;
  }),
}));

function heartbeatJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'heartbeat-main',
    declarationKey: 'heartbeat:main',
    name: 'heartbeat-main',
    displayName: 'Heartbeat (main)',
    agentId: 'main',
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 1_800_000 },
    payload: { kind: 'heartbeat' },
    state: {},
    ...overrides,
  };
}

describe('cron API OpenClaw 8.1 system monitors', () => {
  beforeEach(() => {
    configState.value = {
      agents: {
        defaults: {
          heartbeat: { target: 'owner' },
        },
        entries: {
          main: { default: true },
        },
      },
    };
  });

  it('disables a heartbeat through agent config instead of cron.update', async () => {
    const jobs = [heartbeatJob()];
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') return { jobs };
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    await api.toggle({ id: 'heartbeat-main', enabled: false });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('cron.list', { includeDisabled: true }, 8000);
    expect(configState.value).toMatchObject({
      agents: {
        entries: {
          main: {
            default: true,
            heartbeat: { every: '0m' },
          },
        },
      },
    });
  });

  it('restores the persisted heartbeat monitor cadence when re-enabled', async () => {
    configState.value = {
      agents: {
        entries: {
          main: { default: true, heartbeat: { every: '0m', target: 'owner' } },
        },
      },
    };
    const jobs = [heartbeatJob({ enabled: false })];
    const rpc = vi.fn(async () => ({ jobs }));
    const api = createCronApi({ gatewayManager: { rpc } as never });

    await api.toggle({ id: 'heartbeat-main', enabled: true });

    expect(configState.value).toMatchObject({
      agents: {
        entries: {
          main: {
            heartbeat: { every: '30m', target: 'owner' },
          },
        },
      },
    });
  });

  it('keeps ordinary scheduled tasks on cron.update', async () => {
    const jobs = [{
      ...heartbeatJob(),
      id: 'reminder',
      declarationKey: undefined,
      payload: { kind: 'agentTurn', message: 'Drink water' },
    }];
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') return { jobs };
      if (method === 'cron.update') return { ok: true };
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    await api.toggle({ id: 'reminder', enabled: false });

    expect(rpc).toHaveBeenLastCalledWith('cron.update', {
      id: 'reminder',
      patch: { enabled: false },
    });
  });
});
