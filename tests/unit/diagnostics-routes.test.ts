import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'http';

const buildChannelAccountsViewMock = vi.fn();
const getChannelStatusDiagnosticsMock = vi.fn();
const sendJsonMock = vi.fn();
const readLogFileMock = vi.fn();

const testOpenClawConfigDir = join(tmpdir(), 'clawx-tests', 'diagnostics-routes-openclaw');

vi.mock('@electron/api/routes/channels', () => ({
  buildChannelAccountsView: (...args: unknown[]) => buildChannelAccountsViewMock(...args),
  getChannelStatusDiagnostics: (...args: unknown[]) => getChannelStatusDiagnosticsMock(...args),
}));

vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    readLogFile: (...args: unknown[]) => readLogFileMock(...args),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawConfigDir,
}));

describe('handleDiagnosticsRoutes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
    mkdirSync(join(testOpenClawConfigDir, 'logs'), { recursive: true });
    buildChannelAccountsViewMock.mockResolvedValue({
      channels: [
        {
          channelType: 'feishu',
          defaultAccountId: 'default',
          status: 'degraded',
          accounts: [
            {
              accountId: 'default',
              name: 'Primary Account',
              configured: true,
              status: 'degraded',
              statusReason: 'channels_status_timeout',
              isDefault: true,
            },
          ],
        },
      ],
      gatewayHealth: {
        state: 'degraded',
        reasons: ['channels_status_timeout'],
        consecutiveHeartbeatMisses: 1,
      },
    });
    getChannelStatusDiagnosticsMock.mockReturnValue({
      lastChannelsStatusOkAt: 100,
      lastChannelsStatusFailureAt: 200,
    });
    readLogFileMock.mockResolvedValue('clawx-log-tail');
  });

  afterAll(() => {
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
  });

  it('returns diagnostics snapshot with channel view and tailed logs', async () => {
    writeFileSync(join(testOpenClawConfigDir, 'logs', 'gateway.log'), 'gateway-line-1\ngateway-line-2\n');

    const { handleDiagnosticsRoutes } = await import('@electron/api/routes/diagnostics');
    const handled = await handleDiagnosticsRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/diagnostics/gateway-snapshot'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', port: 18789, connectedAt: 50 }),
          getDiagnostics: () => ({
            lastAliveAt: 60,
            lastRpcSuccessAt: 70,
            consecutiveHeartbeatMisses: 1,
            consecutiveRpcFailures: 0,
          }),
        },
      } as never,
    );

    expect(handled).toBe(true);
    const payload = sendJsonMock.mock.calls.at(-1)?.[2] as {
      platform?: string;
      channels?: Array<{ channelType: string; status: string }>;
      clawxLogTail?: string;
      gatewayLogTail?: string;
      gatewayErrLogTail?: string;
      gateway?: { state?: string; reasons?: string[] };
    };
    expect(payload.platform).toBe(process.platform);
    expect(payload.channels).toEqual([
      expect.objectContaining({
        channelType: 'feishu',
        status: 'degraded',
      }),
    ]);
    expect(payload.clawxLogTail).toBe('clawx-log-tail');
    expect(payload.gatewayLogTail).toContain('gateway-line-1');
    expect(payload.gatewayErrLogTail).toBe('');
    expect(payload.gateway?.state).toBe('degraded');
    expect(payload.gateway?.reasons).toEqual(expect.arrayContaining(['gateway_degraded']));
  });

  it('returns empty gateway log tails when log files are missing', async () => {
    const { handleDiagnosticsRoutes } = await import('@electron/api/routes/diagnostics');
    await handleDiagnosticsRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/diagnostics/gateway-snapshot'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', port: 18789 }),
          getDiagnostics: () => ({
            consecutiveHeartbeatMisses: 0,
            consecutiveRpcFailures: 0,
          }),
        },
      } as never,
    );

    const payload = sendJsonMock.mock.calls.at(-1)?.[2] as {
      gatewayLogTail?: string;
      gatewayErrLogTail?: string;
    };
    expect(payload.gatewayLogTail).toBe('');
    expect(payload.gatewayErrLogTail).toBe('');
  });

  it('reads tailed logs without leaking unread buffer bytes', async () => {
    writeFileSync(join(testOpenClawConfigDir, 'logs', 'gateway.log'), 'only-one-line');

    const { handleDiagnosticsRoutes } = await import('@electron/api/routes/diagnostics');
    await handleDiagnosticsRoutes(
      { method: 'GET' } as IncomingMessage,
      {} as ServerResponse,
      new URL('http://127.0.0.1:13210/api/diagnostics/gateway-snapshot'),
      {
        gatewayManager: {
          getStatus: () => ({ state: 'running', port: 18789 }),
          getDiagnostics: () => ({
            consecutiveHeartbeatMisses: 0,
            consecutiveRpcFailures: 0,
          }),
        },
      } as never,
    );

    const payload = sendJsonMock.mock.calls.at(-1)?.[2] as {
      gatewayLogTail?: string;
    };
    expect(payload.gatewayLogTail).toBe('only-one-line');
  });
});
