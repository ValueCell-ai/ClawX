/**
 * Remote Gateway Connection Tests
 *
 * Verifies that the connect handshake frame is built correctly for
 * remote gateways (e.g. Tailscale connections):
 * - Device identity must be OMITTED to avoid "pairing required" errors
 * - Remote token must be used instead of local token
 * - Frame structure must be valid for token-only auth
 */
import { describe, it, expect } from 'vitest';
import { buildConnectFrame } from '@electron/gateway/connect-frame';
import {
  loadOrCreateDeviceIdentity,
} from '@electron/utils/device-identity';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

// Create a real device identity for testing (uses crypto key generation)
async function createTestDeviceIdentity() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'clawx-test-'));
  const identityPath = join(tmpDir, 'test-device-identity.json');
  return await loadOrCreateDeviceIdentity(identityPath);
}

describe('Remote Gateway connect frame', () => {
  it('omits device identity when isRemote is true', async () => {
    const deviceIdentity = await createTestDeviceIdentity();

    const frame = buildConnectFrame({
      challengeNonce: 'test-nonce-123',
      token: 'remote-token-abc',
      connectId: 'connect-1',
      deviceIdentity,
      isRemote: true,
    });

    // Device must be undefined for remote connections
    expect(frame.params.device).toBeUndefined();
    // Token must be the remote token
    expect(frame.params.auth.token).toBe('remote-token-abc');
    // Basic frame structure
    expect(frame.type).toBe('req');
    expect(frame.method).toBe('connect');
    expect(frame.params.role).toBe('operator');
    expect(frame.params.scopes).toContain('operator.admin');
  });

  it('includes device identity when isRemote is false', async () => {
    const deviceIdentity = await createTestDeviceIdentity();

    const frame = buildConnectFrame({
      challengeNonce: 'test-nonce-456',
      token: 'local-token-xyz',
      connectId: 'connect-2',
      deviceIdentity,
      isRemote: false,
    });

    // Device must be present for local connections
    expect(frame.params.device).toBeDefined();
    expect(frame.params.device!.id).toBe(deviceIdentity.deviceId);
    expect(frame.params.device!.nonce).toBe('test-nonce-456');
    expect(frame.params.device!.publicKey).toBeTruthy();
    expect(frame.params.device!.signature).toBeTruthy();
    // Token must be the local token
    expect(frame.params.auth.token).toBe('local-token-xyz');
  });

  it('omits device identity when deviceIdentity is null (local)', () => {
    const frame = buildConnectFrame({
      challengeNonce: 'test-nonce-789',
      token: 'some-token',
      connectId: 'connect-3',
      deviceIdentity: null,
      isRemote: false,
    });

    expect(frame.params.device).toBeUndefined();
    expect(frame.params.auth.token).toBe('some-token');
  });

  it('uses correct protocol version and client metadata', () => {
    const frame = buildConnectFrame({
      challengeNonce: 'nonce',
      token: 'token',
      connectId: 'id',
      deviceIdentity: null,
      isRemote: true,
    });

    expect(frame.params.minProtocol).toBe(3);
    expect(frame.params.maxProtocol).toBe(3);
    expect(frame.params.client.displayName).toBe('ClawX');
    expect(frame.params.client.mode).toBe('ui');
    expect(frame.params.caps).toEqual([]);
  });
});
