import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchProviderSnapshot = vi.fn();
const mockHostApiFetch = vi.fn();

vi.mock('@/lib/provider-accounts', () => ({
  fetchProviderSnapshot: (...args: unknown[]) => mockFetchProviderSnapshot(...args),
  isHostApiRouteMissing: (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (record.success !== false) return false;
    const error = record.error;
    return typeof error === 'string' && /no\s+route\s+for/i.test(error);
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

import { useProviderStore } from '@/stores/providers';

describe('useProviderStore – validateAccountApiKey()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims API keys before sending provider validation requests', async () => {
    mockHostApiFetch.mockResolvedValueOnce({ valid: true });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', '  sk-lm-test \n', {
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toEqual({ valid: true });
    expect(mockHostApiFetch).toHaveBeenCalledWith('/api/provider-accounts/validate', {
      method: 'POST',
      body: JSON.stringify({
        accountId: 'custom',
        vendorId: 'custom',
        providerId: 'custom',
        apiKey: 'sk-lm-test',
        options: {
          baseUrl: 'http://127.0.0.1:1234/v1',
          apiProtocol: 'openai-completions',
        },
      }),
    });
  });

  it('falls back to legacy /api/providers/validate when the new route throws a 404', async () => {
    // The browser-fallback path of `hostApiFetch` (used in non-Electron
    // environments and surfaced by some IPC error normalisations) throws
    // on non-2xx HTTP. Make sure the renderer treats those as missing-route.
    mockHostApiFetch.mockRejectedValueOnce(new Error('404 Not Found'));
    mockHostApiFetch.mockResolvedValueOnce({ valid: true });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', 'sk-lm-test', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });

    expect(result).toEqual({ valid: true });
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(1, '/api/provider-accounts/validate', expect.any(Object));
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(2, '/api/providers/validate', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        apiKey: 'sk-lm-test',
        options: { baseUrl: 'http://127.0.0.1:1234/v1' },
      }),
    });
  });

  it('falls back to legacy /api/providers/validate when the new route returns a route-not-found body', async () => {
    // The Electron IPC proxy never throws on HTTP 404 — it surfaces the
    // JSON body. Older Host API builds without the new validate route
    // therefore return `{ success: false, error: "No route for ..." }`.
    // The renderer must detect that body shape via `isHostApiRouteMissing`
    // and replay the request against the legacy route. This is the path
    // that actually runs in production today.
    mockHostApiFetch.mockResolvedValueOnce({
      success: false,
      error: 'No route for POST /api/provider-accounts/validate',
    });
    mockHostApiFetch.mockResolvedValueOnce({ valid: true });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', 'sk-lm-test', {
      baseUrl: 'http://127.0.0.1:1234/v1',
    });

    expect(result).toEqual({ valid: true });
    expect(mockHostApiFetch).toHaveBeenCalledTimes(2);
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(1, '/api/provider-accounts/validate', expect.any(Object));
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(2, '/api/providers/validate', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        apiKey: 'sk-lm-test',
        options: { baseUrl: 'http://127.0.0.1:1234/v1' },
      }),
    });
  });

  it('does NOT fall back when the new route returns a real validation failure', async () => {
    // `{ valid: false, error: ... }` is a legitimate validation result —
    // it must NOT be confused with a missing-route body (whose discriminator
    // is `success: false`). Otherwise we would silently retry against the
    // legacy route and double-charge the upstream provider.
    mockHostApiFetch.mockResolvedValueOnce({ valid: false, error: 'API key is rejected' });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', 'sk-lm-test');

    expect(result).toEqual({ valid: false, error: 'API key is rejected' });
    expect(mockHostApiFetch).toHaveBeenCalledTimes(1);
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(1, '/api/provider-accounts/validate', expect.any(Object));
  });
});

describe('useProviderStore – getAccountApiKey()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the key from the new account-namespaced endpoint by default', async () => {
    mockHostApiFetch.mockResolvedValueOnce({ apiKey: 'sk-stored-key' });

    const apiKey = await useProviderStore.getState().getAccountApiKey('openai-account-1');

    expect(apiKey).toBe('sk-stored-key');
    expect(mockHostApiFetch).toHaveBeenCalledTimes(1);
    expect(mockHostApiFetch).toHaveBeenCalledWith('/api/provider-accounts/openai-account-1/api-key');
  });

  it('falls back to legacy /api/providers/:id/api-key when the new route throws a 404', async () => {
    // Browser-fallback path: thrown 404.
    mockHostApiFetch.mockRejectedValueOnce(new Error('404 Not Found'));
    mockHostApiFetch.mockResolvedValueOnce({ apiKey: 'sk-legacy-key' });

    const apiKey = await useProviderStore.getState().getAccountApiKey('openai-account-1');

    expect(apiKey).toBe('sk-legacy-key');
    expect(mockHostApiFetch).toHaveBeenCalledTimes(2);
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(1, '/api/provider-accounts/openai-account-1/api-key');
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(2, '/api/providers/openai-account-1/api-key');
  });

  it('falls back to legacy /api/providers/:id/api-key when the new route returns a route-not-found body', async () => {
    // Electron IPC proxy path: 404 surfaces as a "No route" body.
    mockHostApiFetch.mockResolvedValueOnce({
      success: false,
      error: 'No route for GET /api/provider-accounts/openai-account-1/api-key',
    });
    mockHostApiFetch.mockResolvedValueOnce({ apiKey: 'sk-legacy-key' });

    const apiKey = await useProviderStore.getState().getAccountApiKey('openai-account-1');

    expect(apiKey).toBe('sk-legacy-key');
    expect(mockHostApiFetch).toHaveBeenCalledTimes(2);
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(1, '/api/provider-accounts/openai-account-1/api-key');
    expect(mockHostApiFetch).toHaveBeenNthCalledWith(2, '/api/providers/openai-account-1/api-key');
  });

  it('returns null when the legacy fallback also reports no key', async () => {
    mockHostApiFetch.mockResolvedValueOnce({
      success: false,
      error: 'No route for GET /api/provider-accounts/missing-account/api-key',
    });
    mockHostApiFetch.mockResolvedValueOnce({ apiKey: null });

    const apiKey = await useProviderStore.getState().getAccountApiKey('missing-account');

    expect(apiKey).toBeNull();
    expect(mockHostApiFetch).toHaveBeenCalledTimes(2);
  });

  it('encodes the account id so colons and slashes survive the request', async () => {
    mockHostApiFetch.mockResolvedValueOnce({ apiKey: 'sk-stored-key' });

    await useProviderStore.getState().getAccountApiKey('vendor:weird/id');

    expect(mockHostApiFetch).toHaveBeenCalledWith('/api/provider-accounts/vendor%3Aweird%2Fid/api-key');
  });
});
