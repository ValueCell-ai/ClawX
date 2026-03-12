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

    expect(result).toMatchObject({ valid: true });
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

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-test',
        }),
      })
    );
  });

  it('falls back to /responses for openai-responses when /models is unavailable', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-response-test', {
      baseUrl: 'https://responses.example.com/v1',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://responses.example.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-response-test',
        }),
      })
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://responses.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('falls back to /chat/completions for openai-completions when /models is unavailable', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-chat-test', {
      baseUrl: 'https://chat.example.com/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://chat.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('does not duplicate endpoint suffix when baseUrl already points to /responses', async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const { validateApiKeyWithProvider } = await import('@electron/services/providers/provider-validation');
    const result = await validateApiKeyWithProvider('custom', 'sk-endpoint-test', {
      baseUrl: 'https://openrouter.ai/api/v1/responses',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://openrouter.ai/api/v1/models?limit=1',
      expect.anything(),
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://openrouter.ai/api/v1/responses',
      expect.anything(),
    );
  });
});
