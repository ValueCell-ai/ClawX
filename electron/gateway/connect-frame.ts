/**
 * Build the connect handshake frame for the OpenClaw Gateway protocol.
 *
 * Extracted from GatewayManager.connect() so it can be unit-tested
 * independently of WebSocket / Electron plumbing.
 */
import {
  buildDeviceAuthPayload,
  signDevicePayload,
  publicKeyRawBase64UrlFromPem,
  type DeviceIdentity,
} from '../utils/device-identity';

export interface ConnectFrameOptions {
  /** Challenge nonce issued by the server */
  challengeNonce: string;
  /** Auth token to send (local or remote) */
  token: string;
  /** Unique request id */
  connectId: string;
  /** Device identity (may be null if not loaded) */
  deviceIdentity: DeviceIdentity | null;
  /** Whether the target gateway is on a remote host */
  isRemote: boolean;
}

export interface ConnectFrame {
  type: 'req';
  id: string;
  method: 'connect';
  params: {
    minProtocol: number;
    maxProtocol: number;
    client: {
      id: string;
      displayName: string;
      version: string;
      platform: string;
      mode: string;
    };
    auth: { token: string };
    caps: string[];
    role: string;
    scopes: string[];
    device?: {
      id: string;
      publicKey: string;
      signature: string;
      signedAt: number;
      nonce: string;
    };
  };
}

export function buildConnectFrame(opts: ConnectFrameOptions): ConnectFrame {
  const role = 'operator';
  const scopes = ['operator.admin'];
  const signedAtMs = Date.now();
  const clientId = 'gateway-client';
  const clientMode = 'ui';

  // For remote gateways, omit the device identity entirely.
  // The remote gateway hasn't paired with this device and would
  // reject the handshake with "pairing required".
  const device = (() => {
    if (opts.isRemote) return undefined;
    if (!opts.deviceIdentity) return undefined;

    const payload = buildDeviceAuthPayload({
      deviceId: opts.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: opts.token ?? null,
      nonce: opts.challengeNonce,
    });
    const signature = signDevicePayload(opts.deviceIdentity.privateKeyPem, payload);
    return {
      id: opts.deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(opts.deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce: opts.challengeNonce,
    };
  })();

  return {
    type: 'req',
    id: opts.connectId,
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        displayName: 'ClawX',
        version: '0.1.0',
        platform: process.platform,
        mode: clientMode,
      },
      auth: {
        token: opts.token,
      },
      caps: [],
      role,
      scopes,
      device,
    },
  };
}
