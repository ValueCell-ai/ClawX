import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

describe('handleCronRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates cron jobs with external delivery configuration', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'Weather delivery',
      message: 'Summarize today',
      schedule: '0 9 * * *',
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_weather',
      },
      enabled: true,
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-1',
      name: 'Weather delivery',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Summarize today' },
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).toHaveBeenCalledWith('cron.add', expect.objectContaining({
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
    }));
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-1',
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_weather' },
      }),
    );
  });

  it('updates cron jobs with transformed payload and delivery fields', async () => {
    parseJsonBodyMock.mockResolvedValue({
      message: 'Updated prompt',
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_next',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-2',
      name: 'Updated job',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 3,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Updated prompt' },
      delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs/job-2'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-2',
      patch: {
        payload: { kind: 'agentTurn', message: 'Updated prompt' },
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      },
    });
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      200,
      expect.objectContaining({
        id: 'job-2',
        message: 'Updated prompt',
        delivery: { mode: 'announce', channel: 'feishu', to: 'user:ou_next' },
      }),
    );
  });

  it('passes through delivery.accountId for multi-account cron jobs', async () => {
    parseJsonBodyMock.mockResolvedValue({
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        to: 'user:ou_owner',
        accountId: 'feishu-0d009958',
      },
    });

    const rpc = vi.fn().mockResolvedValue({
      id: 'job-account',
      name: 'Account job',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 4,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { kind: 'agentTurn', message: 'Prompt' },
      delivery: { mode: 'announce', channel: 'feishu', accountId: 'feishu-0d009958', to: 'user:ou_owner' },
      state: {},
    });

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    await handleCronRoutes(
      { method: 'PUT' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs/job-account'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(rpc).toHaveBeenCalledWith('cron.update', {
      id: 'job-account',
      patch: {
        delivery: {
          mode: 'announce',
          channel: 'feishu',
          to: 'user:ou_owner',
          accountId: 'feishu-0d009958',
        },
      },
    });
  });

  it('rejects WeChat scheduled delivery because the plugin requires a live context token', async () => {
    parseJsonBodyMock.mockResolvedValue({
      name: 'WeChat delivery',
      message: 'Send update',
      schedule: '0 10 * * *',
      delivery: {
        mode: 'announce',
        channel: 'wechat',
        to: 'wechat:wxid_target',
        accountId: 'wechat-bot',
      },
      enabled: true,
    });

    const rpc = vi.fn();

    const { handleCronRoutes } = await import('@electron/api/routes/cron');
    const handled = await handleCronRoutes(
      { method: 'POST' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/cron/jobs'),
      {
        gatewayManager: { rpc },
      } as never,
    );

    expect(handled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(
      expect.anything(),
      400,
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('WeChat scheduled delivery is not supported'),
      }),
    );
  });
});
