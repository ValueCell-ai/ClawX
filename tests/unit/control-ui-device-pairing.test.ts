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
  CONTROL_UI_BROWSER_CLIENT_ID,
  isControlUiBrowserPairingRequest,
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
        expect(params).toEqual({ requestId: 'req-control-ui' });
        return { requestId: 'req-control-ui' };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const approved = await approvePendingControlUiPairingRequests({
      isConnected: () => true,
      getStatus: () => ({ port: 18789 }),
      rpc,
    });

    expect(approved).toEqual(['req-control-ui']);
    expect(rpc).toHaveBeenCalledTimes(2);
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
