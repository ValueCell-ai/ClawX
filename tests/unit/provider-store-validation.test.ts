import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchProviderSnapshot = vi.fn();
const mockHostApiFetch = vi.fn();

vi.mock('@/lib/provider-accounts', () => ({
  fetchProviderSnapshot: (...args: unknown[]) => mockFetchProviderSnapshot(...args),
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
    expect(mockHostApiFetch).toHaveBeenCalledWith('/api/providers/validate', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        apiKey: 'sk-lm-test',
        options: {
          baseUrl: 'http://127.0.0.1:1234/v1',
          apiProtocol: 'openai-completions',
        },
      }),
    });
  });
});
