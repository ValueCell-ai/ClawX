// @vitest-environment node
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayManager } from '@electron/gateway/manager';
import { buildDeviceAuthPayload, type DeviceIdentity } from '@electron/utils/device-identity';
import type { PendingGatewayRequest } from '@electron/gateway/request-store';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' }, utilityProcess: {} }));
vi.mock('@electron/utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@electron/utils/store', () => ({ getSetting: async () => 'fixture-token' }));
vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  scheduleLocalDeviceAutoApproval: vi.fn(), cancelLocalDeviceAutoApproval: vi.fn(),
}));
vi.mock('@electron/gateway/agent-database-admission', () => ({
  probeAgentDatabaseAdmissions: async () => ({ state: 'ready' }),
}));

type ManagerConnection = {
  connect(port: number): Promise<void>;
  deviceIdentity: DeviceIdentity;
  pendingRequests: Map<string, PendingGatewayRequest>;
  shouldReconnect: boolean;
  clearAllTimers(): void;
};

describe('GatewayManager handshake on a loopback WebSocket', () => {
  let manager: GatewayManager;
  let transport: ManagerConnection;
  let server: WebSocketServer;

  beforeEach(async () => {
    server = new WebSocketServer({ host: 'localhost', port: 0 });
    await once(server, 'listening');
    manager = new GatewayManager();
    transport = manager as unknown as ManagerConnection;
    const keys = generateKeyPairSync('ed25519');
    transport.deviceIdentity = {
      deviceId: createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).digest('hex'),
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  });

  afterEach(async () => {
    transport.shouldReconnect = false;
    transport.clearAllTimers();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((done) => server.close(() => done()));
  });

  async function challenge(nonce: string) {
    const accepted = once(server, 'connection');
    const completion = transport.connect((server.address() as AddressInfo).port);
    const [peer] = await accepted as [WebSocket];
    const request = once(peer, 'message');
    peer.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce } }));
    const [data] = await request;
    const { id, method, params } = JSON.parse(data.toString());
    expect(method).toBe('connect');
    expect(params.device.nonce).toBe(nonce);
    const signed = buildDeviceAuthPayload({
      deviceId: params.device.id, clientId: params.client.id, clientMode: params.client.mode,
      role: params.role, scopes: params.scopes, signedAtMs: params.device.signedAt,
      token: params.auth.token, nonce,
    });
    expect(verify(null, Buffer.from(signed), transport.deviceIdentity.publicKeyPem,
      Buffer.from(params.device.signature, 'base64url'))).toBe(true);
    return { peer, id, completion };
  }

  async function flush(peer: WebSocket) {
    const received = once(peer, 'pong');
    peer.ping();
    await received;
  }

  it.each(['native', 'jsonrpc'])('accepts a %s hello and only delivers ready on the current socket', async (wire) => {
    const readyEvents = vi.fn();
    manager.on('gateway:ready', readyEvents);
    const ready = (peer: WebSocket, source: string) => peer.send(JSON.stringify({
      type: 'event', event: 'gateway.ready', id: 'connect-event-metadata', payload: { source },
    }));
    const first = await challenge('first');
    ready(first.peer, 'before-auth');
    first.peer.send(JSON.stringify({ type: 'res', id: 'other-response', ok: true }));
    await flush(first.peer);
    expect(manager.isConnected()).toBe(false);
    expect(readyEvents).not.toHaveBeenCalled();
    const hello = { type: 'hello-ok', protocol: 4 };
    first.peer.send(JSON.stringify(wire === 'native'
      ? { type: 'res', id: first.id, ok: true, payload: hello }
      : { jsonrpc: '2.0', id: first.id, result: hello }));
    ready(first.peer, 'first-authenticated');
    await first.completion;
    await flush(first.peer);
    expect(manager.isConnected()).toBe(true);
    expect(readyEvents.mock.calls).toEqual([[{ source: 'first-authenticated' }]]);
    expect(manager.getStatus().gatewayReady).toBe(true);

    const second = await challenge('replacement');
    second.peer.send(JSON.stringify({ type: 'res', id: second.id, ok: true, payload: hello }));
    await second.completion;
    ready(first.peer, 'old-connection');
    await flush(first.peer);
    ready(second.peer, 'current-connection');
    await flush(second.peer);
    expect(readyEvents.mock.calls).toEqual([[{ source: 'first-authenticated' }], [{ source: 'current-connection' }]]);
    expect(transport.pendingRequests.size).toBe(0);
  });

  it.each(['native', 'jsonrpc'])('preserves the %s rejection and closes the pending connection', async (wire) => {
    const { peer, id, completion } = await challenge('rejected');
    const disconnected = once(peer, 'close');
    const expectedFailure = expect(completion).rejects.toThrow('gateway starting');
    const error = { code: -32001, message: 'gateway starting' };
    peer.send(JSON.stringify(wire === 'native'
      ? { type: 'res', id, ok: false, error }
      : { jsonrpc: '2.0', id, error }));
    await expectedFailure;
    await disconnected;
    expect(manager.isConnected()).toBe(false);
    expect(transport.pendingRequests.size).toBe(0);
  });
});
