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

  it('falls back to legacy /api/providers/validate when the new route is missing', async () => {
    // First call (new route) returns 404 — older Host API builds.
    mockHostApiFetch.mockRejectedValueOnce(new Error('404 Not Found'));
    // Second call (legacy fallback) succeeds.
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
});
