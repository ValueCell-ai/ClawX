import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  loginTokenDanceOAuth,
  TOKENDANCE_APP_URL,
  TOKENDANCE_KEY_EXCHANGE_URL,
} from '@electron/utils/tokendance-oauth';

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('TokenDance OAuth', () => {
  it('uses a loopback callback and S256 PKCE before exchanging the code for an API key', async () => {
    let authorizationUrl: URL | undefined;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(TOKENDANCE_KEY_EXCHANGE_URL);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as {
        code: string;
        code_verifier: string;
        code_challenge_method: string;
      };
      expect(body.code).toBe('one-time-code');
      expect(body.code_challenge_method).toBe('S256');
      expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
      expect(base64Url(createHash('sha256').update(body.code_verifier, 'ascii').digest()))
        .toBe(authorizationUrl?.searchParams.get('code_challenge'));
      return new Response(JSON.stringify({ key: 'td-secret-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await loginTokenDanceOAuth({
      fetchImpl,
      openUrl: async (rawUrl) => {
        authorizationUrl = new URL(rawUrl);
        expect(authorizationUrl.origin).toBe('https://tokendance.space');
        expect(authorizationUrl.pathname).toBe('/auth');
        expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorizationUrl.searchParams.get('app_url')).toBe(TOKENDANCE_APP_URL);
        expect(authorizationUrl.searchParams.get('key_name')).toBe('ClawX');
        expect(rawUrl).not.toContain('td-secret-key');

        const callback = new URL(authorizationUrl.searchParams.get('callback_url') || '');
        expect(callback.hostname).toBe('127.0.0.1');
        expect(Number(callback.port)).toBeGreaterThan(0);
        callback.searchParams.set('code', 'one-time-code');
        const response = await fetch(callback, {
          headers: { 'Accept-Language': 'zh-CN' },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const html = await response.text();
        expect(html).toContain('授权成功');
        expect(html).toContain('TokenDance 已成功连接到 ClawX。');
      },
    });

    expect(result).toEqual({ apiKey: 'td-secret-key' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('supports cancellation while waiting for the loopback callback', async () => {
    const controller = new AbortController();
    const promise = loginTokenDanceOAuth({
      signal: controller.signal,
      openUrl: async () => controller.abort(),
      fetchImpl: vi.fn(),
    });

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a callback that does not carry the opaque flow identifier', async () => {
    const controller = new AbortController();
    const promise = loginTokenDanceOAuth({
      signal: controller.signal,
      openUrl: async (rawUrl) => {
        const authorizationUrl = new URL(rawUrl);
        const callback = new URL(authorizationUrl.searchParams.get('callback_url') || '');
        callback.searchParams.set('flow_id', 'wrong-flow');
        callback.searchParams.set('code', 'stolen-code');
        const response = await fetch(callback);
        expect(response.status).toBe(400);
        controller.abort();
      },
      fetchImpl: vi.fn(),
    });

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
