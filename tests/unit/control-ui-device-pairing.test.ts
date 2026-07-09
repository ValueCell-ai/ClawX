import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: vi.fn() },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => 'test-gateway-token'),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/openclaw',
  getOpenClawDir: () => '/tmp/openclaw/pkg',
  getOpenClawEntryPath: () => '/tmp/openclaw/pkg/openclaw.mjs',
}));

import {
  approvePendingControlUiPairingRequests,
  approvePendingLocalDeviceRequests,
  CONTROL_UI_BROWSER_CLIENT_ID,
  isControlUiBrowserPairingRequest,
  isLocalLoopbackDeviceAutoApprovalRequest,
  OPENCLAW_CLI_CLIENT_ID,
} from '@electron/utils/control-ui-device-pairing';

describe('control-ui-device-pairing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects Control UI browser pairing requests', () => {
    expect(
      isControlUiBrowserPairingRequest({
        clientId: CONTROL_UI_BROWSER_CLIENT_ID,
        clientMode: 'webchat',
      }),
    ).toBe(true);
    expect(isControlUiBrowserPairingRequest({ clientId: 'gateway-client' })).toBe(false);
    expect(isControlUiBrowserPairingRequest({ clientId: 'cli' })).toBe(false);
  });

  it('detects trusted loopback auto-approval clients', () => {
    expect(isLocalLoopbackDeviceAutoApprovalRequest({ clientId: CONTROL_UI_BROWSER_CLIENT_ID })).toBe(true);
    expect(isLocalLoopbackDeviceAutoApprovalRequest({ clientId: OPENCLAW_CLI_CLIENT_ID })).toBe(true);
    expect(isLocalLoopbackDeviceAutoApprovalRequest({ clientId: 'gateway-client' })).toBe(true);
    expect(isLocalLoopbackDeviceAutoApprovalRequest({ clientId: 'unknown-remote-client' })).toBe(false);
  });

  it('approves pending local trusted requests via gateway RPC', async () => {
    const rpc = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'device.pair.list') {
        return {
          pending: [
            {
              requestId: 'req-control-ui',
              clientId: CONTROL_UI_BROWSER_CLIENT_ID,
              clientMode: 'webchat',
            },
            {
              requestId: 'req-cli',
              clientId: OPENCLAW_CLI_CLIENT_ID,
              clientMode: 'cli',
            },
            {
              requestId: 'req-remote',
              clientId: 'unknown-remote-client',
              clientMode: 'webchat',
            },
          ],
        };
      }
      if (method === 'device.pair.approve') {
        expect(['req-control-ui', 'req-cli']).toContain((params as { requestId?: string }).requestId);
        return params;
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const approved = await approvePendingLocalDeviceRequests({
      isConnected: () => true,
      getStatus: () => ({ port: 18789 }),
      rpc,
    });

    expect(approved).toEqual(['req-control-ui', 'req-cli']);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[1]?.[0]).toBe('device.pair.approve');
    expect(rpc.mock.calls[2]?.[0]).toBe('device.pair.approve');
  });

  it('approves pending Control UI requests via gateway RPC', async () => {
    const rpc = vi.fn(async (method: string, params?: unknown) => {
      if (method === 'device.pair.list') {
        return {
          pending: [
            {
              requestId: 'req-control-ui',
              clientId: CONTROL_UI_BROWSER_CLIENT_ID,
              clientMode: 'webchat',
            },
            {
              requestId: 'req-cli',
              clientId: 'cli',
              clientMode: 'cli',
            },
          ],
        };
      }
      if (method === 'device.pair.approve') {
        expect(['req-control-ui', 'req-cli']).toContain((params as { requestId?: string }).requestId);
        return params;
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const approved = await approvePendingControlUiPairingRequests({
      isConnected: () => true,
      getStatus: () => ({ port: 18789 }),
      rpc,
    });

    expect(approved).toEqual(['req-control-ui', 'req-cli']);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[1]?.[0]).toBe('device.pair.approve');
  });

  it('does not approve the same request twice in one pass', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'device.pair.list') {
        return {
          pending: [
            {
              requestId: 'req-1',
              clientId: CONTROL_UI_BROWSER_CLIENT_ID,
            },
          ],
        };
      }
      return {};
    });

    const approvedRequestIds = new Set<string>(['req-1']);
    const approved = await approvePendingControlUiPairingRequests(
      { isConnected: () => true, getStatus: () => ({ port: 18789 }), rpc },
      { approvedRequestIds },
    );

    expect(approved).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
