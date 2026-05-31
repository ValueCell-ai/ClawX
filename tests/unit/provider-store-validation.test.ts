import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchProviderSnapshot = vi.fn();
const mockValidateKey = vi.fn();
const mockGetAccountApiKey = vi.fn();

vi.mock('@/lib/provider-accounts', () => ({
  fetchProviderSnapshot: (...args: unknown[]) => mockFetchProviderSnapshot(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    providers: {
      validateKey: (...args: unknown[]) => mockValidateKey(...args),
      getAccountApiKey: (...args: unknown[]) => mockGetAccountApiKey(...args),
    },
  },
}));

import { useProviderStore } from '@/stores/providers';

describe('useProviderStore - validateAccountApiKey()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims API keys before sending provider validation requests', async () => {
    mockValidateKey.mockResolvedValueOnce({ valid: true });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', '  sk-lm-test \n', {
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toEqual({ valid: true });
    expect(mockValidateKey).toHaveBeenCalledWith({
      accountId: 'custom',
      vendorId: 'custom',
      providerId: 'custom',
      apiKey: 'sk-lm-test',
      options: {
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiProtocol: 'openai-completions',
      },
    });
  });

  it('returns validation failures without throwing', async () => {
    mockValidateKey.mockResolvedValueOnce({ valid: false, error: 'API key is rejected' });

    const result = await useProviderStore.getState().validateAccountApiKey('custom', 'sk-lm-test');

    expect(result).toEqual({ valid: false, error: 'API key is rejected' });
    expect(mockValidateKey).toHaveBeenCalledTimes(1);
  });

  it('normalizes invocation failures into validation failures', async () => {
    mockValidateKey.mockRejectedValueOnce(new Error('offline'));

    const result = await useProviderStore.getState().validateAccountApiKey('custom', 'sk-lm-test');

    expect(result).toEqual({ valid: false, error: 'Error: offline' });
  });
});

describe('useProviderStore - getAccountApiKey()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the key through the typed provider API', async () => {
    mockGetAccountApiKey.mockResolvedValueOnce('sk-stored-key');

    const apiKey = await useProviderStore.getState().getAccountApiKey('openai-account-1');

    expect(apiKey).toBe('sk-stored-key');
    expect(mockGetAccountApiKey).toHaveBeenCalledWith('openai-account-1');
  });

  it('returns null when no key is stored', async () => {
    mockGetAccountApiKey.mockResolvedValueOnce(null);

    const apiKey = await useProviderStore.getState().getAccountApiKey('missing-account');

    expect(apiKey).toBeNull();
  });

  it('swallows key read failures', async () => {
    mockGetAccountApiKey.mockRejectedValueOnce(new Error('keychain unavailable'));

    const apiKey = await useProviderStore.getState().getAccountApiKey('openai-account-1');

    expect(apiKey).toBeNull();
  });
});
