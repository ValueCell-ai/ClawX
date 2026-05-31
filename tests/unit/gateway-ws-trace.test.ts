import { describe, expect, it } from 'vitest';
import {
  redactGatewayFrameForTrace,
  summarizeGatewayFrameForTrace,
} from '../../electron/gateway/ws-trace';

describe('gateway ws trace', () => {
  it('redacts auth and device secrets', () => {
    const redacted = redactGatewayFrameForTrace({
      type: 'req',
      method: 'connect',
      params: {
        auth: { token: 'secret-token' },
        device: { signature: 'device-signature' },
        headers: { Authorization: 'Bearer abc' },
      },
    });

    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('device-signature');
    expect(JSON.stringify(redacted)).not.toContain('Bearer abc');
    expect(JSON.stringify(redacted)).toContain('[redacted]');
  });

  it('summarizes request and event frames', () => {
    expect(summarizeGatewayFrameForTrace({ type: 'req', id: '1', method: 'chat.history' }))
      .toEqual('req id=1 method=chat.history');
    expect(summarizeGatewayFrameForTrace({ type: 'event', event: 'chat' }))
      .toEqual('event chat');
  });
});
