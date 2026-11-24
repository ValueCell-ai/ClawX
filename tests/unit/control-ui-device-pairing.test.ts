// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'fs/promises';
import { getSetting } from '@electron/utils/store';
import { getUvMirrorEnv } from '@electron/utils/uv-env';
import { forkOpenClawUtilityProcess } from '@electron/utils/openclaw-utility-process';

vi.mock('fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs/promises')>(),
  readFile: vi.fn(async () => '{}'),
}));

vi.mock('@electron/utils/uv-env', () => ({ getUvMirrorEnv: vi.fn(async () => ({})) }));
vi.mock('@electron/utils/openclaw-utility-process', async () => {
  const { EventEmitter } = await import('node:events');
  return { forkOpenClawUtilityProcess: vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  }) };
});

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
  getOpenClawEntryPath: () => import.meta.filename,
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
  it('waits for desktop readiness before polling or approving a pending device', async () => {
    const rpc = vi.fn().mockResolvedValue({ pending: [] });
    const status = { state: 'running', gatewayReady: false };
    const gateway = { isConnected: () => true, getStatus: () => status, rpc };
    expect(await approvePendingLocalDeviceRequests(gateway)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    status.gatewayReady = true;
    await approvePendingLocalDeviceRequests(gateway);
    expect(rpc).toHaveBeenCalledWith('device.pair.list', {}, expect.any(Number));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['disconnect', 'replacement', 'startup'])('abandons listed requests after %s', async (change) => {
    let connected = true;
    const status = { state: 'running', gatewayReady: true, connectedAt: 100 };
    const rpc = vi.fn().mockImplementationOnce(async () => {
      if (change === 'disconnect') connected = false;
      if (change === 'replacement') status.connectedAt++;
      if (change === 'startup') status.gatewayReady = false;
      return { pending: [{ requestId: 'previous-poll', clientId: CONTROL_UI_BROWSER_CLIENT_ID }] };
    });
    expect(await approvePendingLocalDeviceRequests({ isConnected: () => connected, getStatus: () => status, rpc })).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(getSetting).not.toHaveBeenCalled();
    expect(forkOpenClawUtilityProcess).not.toHaveBeenCalled();
  });

  it('does not fall back to the CLI when an approval RPC loses its connection', async () => {
    let connected = true;
    const rpc = vi.fn()
      .mockResolvedValueOnce({ pending: [{ requestId: 'lost', clientId: OPENCLAW_CLI_CLIENT_ID }] })
      .mockImplementationOnce(async () => {
        connected = false;
        throw new Error('closed');
      });
    const getStatus = () => ({ state: 'running', gatewayReady: true, connectedAt: 100 });
    expect(await approvePendingLocalDeviceRequests({ isConnected: () => connected, getStatus, rpc })).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(getSetting).not.toHaveBeenCalled();
    expect(forkOpenClawUtilityProcess).not.toHaveBeenCalled();
  });

  it('checks the original connection again after asynchronously preparing the CLI environment', async () => {
    const status = { state: 'running', gatewayReady: true, connectedAt: 100 };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ pending: [{ requestId: 'stale', clientId: OPENCLAW_CLI_CLIENT_ID }] })
      .mockRejectedValueOnce(new Error('approval RPC unavailable'));
    vi.mocked(getUvMirrorEnv).mockImplementationOnce(async () => {
      status.connectedAt++;
      return {};
    });
    expect(await approvePendingLocalDeviceRequests({ isConnected: () => true, getStatus: () => status, rpc })).toEqual([]);
    expect(getUvMirrorEnv).toHaveBeenCalledOnce();
    expect(forkOpenClawUtilityProcess).not.toHaveBeenCalled();
  });

  it('keeps local CLI approval for an offline poll with no gateway status', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      offline: { requestId: 'offline', clientId: OPENCLAW_CLI_CLIENT_ID },
    }));
    const rpc = vi.fn();
    expect(await approvePendingLocalDeviceRequests({ isConnected: () => false, rpc })).toEqual(['offline']);
    expect(rpc).not.toHaveBeenCalled();
    expect(forkOpenClawUtilityProcess).toHaveBeenCalledOnce();
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
