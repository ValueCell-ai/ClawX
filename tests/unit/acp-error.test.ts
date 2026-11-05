// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeAcpError } from '@electron/services/acp-error';

describe('ACP protocol error descriptions', () => {
  it('keeps ordinary errors unchanged', () => {
    expect(describeAcpError(new Error('load failed'))).toEqual({ error: 'load failed' });
    expect(describeAcpError('permission denied')).toEqual({ error: 'permission denied' });
  });

  it('exposes the SDK error code and original underlying reason', () => {
    expect(describeAcpError(Object.assign(new Error('Internal error'), {
      code: -32603, data: { details: 'gateway not connected' },
    }))).toEqual({ error: 'Internal error (-32603): gateway not connected' });
  });

  it('unwraps JSON-encoded provider errors and deduplicates repeated reasons', () => {
    expect(describeAcpError({ message: 'Internal error', code: -32603,
      data: { details: JSON.stringify({ error: { message: 'Provider quota exceeded' } }), message: 'Provider quota exceeded' },
    }).error).toBe('Internal error (-32603): Provider quota exceeded');
  });

  it('allows only reason fields, excluding arbitrary request and credential payloads', () => {
    const result = describeAcpError({ message: 'Internal error', data: {
      details: { message: 'Unavailable', headers: { Authorization: 'secret' }, prompt: 'PRIVATE_PROMPT' },
      apiKey: 'PRIVATE_KEY', request: { body: 'PRIVATE_BODY' }, config: { password: 'PRIVATE_PASSWORD' },
    } });
    expect(result).toEqual({ error: 'Internal error: Unavailable' });
  });

  it('redacts credentials in both the primary message and underlying detail', () => {
    const result = describeAcpError({ message: 'Failed with api_key=PRIVATE_KEY', code: 'UNAVAILABLE', data: {
      details: 'Bearer PRIVATE_BEARER https://user:PRIVATE_PASS@example.com/path?token=PRIVATE_TOKEN sk-abcdefgh123456',
    } });
    expect(result.error).toContain('UNAVAILABLE');
    expect(result.error).toContain('[redacted]');
    expect(result.error).not.toMatch(/PRIVATE_|abcdefgh123456/);
  });

  it('bounds cyclic, oversized and malformed detail objects without dumping them', () => {
    const cycle: Record<string, unknown> = {}; cycle.cause = cycle;
    expect(describeAcpError({ message: 'failure', data: { details: cycle } })).toEqual({ error: 'failure' });
    expect(describeAcpError({ message: 'failure', data: '{bad json' })).toEqual({ error: 'failure' });
    expect(describeAcpError({ message: 'failure', data: { details: 'x'.repeat(10_000) } }).error.length).toBeLessThanOrEqual(2000);
  });

  it.each([
    'Authorization: Digest username="PRIVATE_USER", response="PRIVATE_RESPONSE"',
    'Cookie: first=PRIVATE_FIRST; second=PRIVATE_SECOND',
    '{"apiKey":"PRIVATE_KEY","password":"PRIVATE_PASSWORD","message":"failure"}',
  ])('redacts complete authorization/header and quoted credential values: %s', (message) => {
    const result = describeAcpError(new Error(message));
    expect(result.error).not.toContain('PRIVATE_');
    expect(result.error).toContain('[redacted]');
  });

  it('retains the known reconnect timeout code for localized explanations', () => {
    expect(describeAcpError({ message: 'ACP did not reconnect to Gateway within 60s', code: -32000,
      data: { code: 'ACP_GATEWAY_RECONNECT_TIMEOUT', details: '1006: connection lost' },
    })).toEqual({ error: 'ACP did not reconnect to Gateway within 60s (-32000): 1006: connection lost',
      errorCode: 'ACP_GATEWAY_RECONNECT_TIMEOUT' });
  });
});
