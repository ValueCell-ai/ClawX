import { describe, expect, it, vi } from 'vitest';
import { createCronApi } from '../../electron/services/cron-api';
import type { GatewayManager } from '../../electron/gateway/manager';

type RpcParams = {
  schedule?: Record<string, unknown>;
  patch?: { schedule?: Record<string, unknown> };
};

function makeGatewayJob(schedule: Record<string, unknown>) {
  return {
    id: 'job-1',
    name: 'Test job',
    enabled: true,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    schedule,
    payload: { kind: 'agentTurn', message: 'hi' },
    delivery: { mode: 'none' },
    state: {},
  };
}

function setupCronApi() {
  const calls: Array<{ method: string; params: RpcParams }> = [];
  const rpc = vi.fn(async (method: string, params: unknown) => {
    const typed = (params ?? {}) as RpcParams;
    calls.push({ method, params: typed });
    if (method === 'cron.add') return makeGatewayJob(typed.schedule ?? { kind: 'cron', expr: '* * * * *' });
    if (method === 'cron.update') return makeGatewayJob(typed.patch?.schedule ?? { kind: 'cron', expr: '* * * * *' });
    return makeGatewayJob({ kind: 'cron', expr: '* * * * *' });
  });
  const gatewayManager = { rpc } as unknown as GatewayManager;
  const api = createCronApi({ gatewayManager });
  return { api, calls };
}

describe('cron schedule normalization', () => {
  it('wraps a plain cron expression string into a cron schedule on create', async () => {
    const { api, calls } = setupCronApi();
    await api.create({ name: 'n', message: 'm', schedule: '0 9 * * *' });
    const add = calls.find((call) => call.method === 'cron.add');
    expect(add?.params.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' });
  });

  it('passes a one-time at schedule through unchanged on create', async () => {
    const { api, calls } = setupCronApi();
    await api.create({
      name: 'n',
      message: 'm',
      schedule: { kind: 'at', at: '2030-01-01T09:00:00.000Z' },
    });
    const add = calls.find((call) => call.method === 'cron.add');
    expect(add?.params.schedule).toEqual({ kind: 'at', at: '2030-01-01T09:00:00.000Z' });
  });

  it('normalizes a cron string into a cron object on update', async () => {
    const { api, calls } = setupCronApi();
    await api.update({ id: 'job-1', input: { schedule: '30 * * * *' } });
    const update = calls.find((call) => call.method === 'cron.update');
    expect(update?.params.patch?.schedule).toEqual({ kind: 'cron', expr: '30 * * * *' });
  });

  it('passes a one-time at schedule through on update', async () => {
    const { api, calls } = setupCronApi();
    await api.update({ id: 'job-1', input: { schedule: { kind: 'at', at: '2031-02-03T10:30:00.000Z' } } });
    const update = calls.find((call) => call.method === 'cron.update');
    expect(update?.params.patch?.schedule).toEqual({ kind: 'at', at: '2031-02-03T10:30:00.000Z' });
  });
});

describe('cron session history', () => {
  it('reads SQLite-backed run summaries through cron.runs', async () => {
    const job = makeGatewayJob({ kind: 'cron', expr: '* * * * *' });
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') return { jobs: [job] };
      if (method === 'cron.runs') {
        return {
          entries: [{
            jobId: 'job-1',
            status: 'ok',
            summary: 'Time to drink water.',
            sessionId: 'run-session-1',
            ts: 1_700_000_005_000,
            runAtMs: 1_700_000_000_000,
            durationMs: 5000,
            provider: 'provider-a',
            model: 'model-a',
          }],
        };
      }
      return {};
    });
    const api = createCronApi({ gatewayManager: { rpc } as unknown as GatewayManager });

    const result = await api.sessionHistory({
      sessionKey: 'agent:main:cron:job-1',
      limit: 200,
    });

    expect(rpc).toHaveBeenCalledWith('cron.runs', {
      id: 'job-1',
      limit: 200,
      sortDir: 'asc',
    }, 8000);
    expect(result).toMatchObject({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: expect.stringContaining('Time to drink water.') },
      ],
    });
  });
});
