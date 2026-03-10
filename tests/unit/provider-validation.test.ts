import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetch = vi.fn();

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch,
}));

describe('validateApiKeyWithProvider', () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('validates MiniMax CN keys with Anthropic headers', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');

    const result = await validateApiKeyWithProvider('minimax-portal-cn', 'sk-cn-test');

    expect(result).toEqual({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/anthropic/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-cn-test',
          'anthropic-version': '2023-06-01',
        }),
      })
    );
  });

  it('still validates OpenAI-compatible providers with bearer auth', async () => {
    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');

    const result = await validateApiKeyWithProvider('openai', 'sk-openai-test');

    expect(result).toEqual({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-test',
        }),
      })
    );
  });
});
