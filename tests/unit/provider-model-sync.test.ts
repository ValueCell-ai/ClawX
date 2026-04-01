import { describe, expect, it } from 'vitest';
import { buildNonOAuthAgentProviderUpdate, getModelIdFromRef } from '@electron/main/provider-model-sync';
import type { ProviderConfig } from '@electron/utils/secure-storage';

function providerConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'provider-id',
    name: 'Provider',
    type: 'moonshot',
    enabled: true,
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('provider-model-sync', () => {
  it('extracts model ID from provider/model refs', () => {
    expect(getModelIdFromRef('moonshot/kimi-k2.5', 'moonshot')).toBe('kimi-k2.5');
    expect(getModelIdFromRef('kimi-k2.5', 'moonshot')).toBe('kimi-k2.5');
    expect(getModelIdFromRef(undefined, 'moonshot')).toBeUndefined();
  });

  it('builds models.json update payload for moonshot default switch', () => {
    const payload = buildNonOAuthAgentProviderUpdate(
      providerConfig({ type: 'moonshot', id: 'moonshot' }),
      'moonshot',
      'moonshot/kimi-k2.5',
    );

    expect(payload).toEqual({
      providerKey: 'moonshot',
      entry: {
        baseUrl: 'https://api.moonshot.cn/v1',
        api: 'openai-completions',
        apiKey: 'MOONSHOT_API_KEY',
        models: [{ id: 'kimi-k2.5', name: 'kimi-k2.5' }],
      },
    });
  });

  it('prefers provider custom baseUrl and omits models when modelRef is missing', () => {
    const payload = buildNonOAuthAgentProviderUpdate(
      providerConfig({
        type: 'ark',
        id: 'ark',
        baseUrl: 'https://custom-ark.example.com/v3',
      }),
      'ark',
      undefined,
    );

    expect(payload).toEqual({
      providerKey: 'ark',
      entry: {
        baseUrl: 'https://custom-ark.example.com/v3',
        api: 'openai-completions',
        apiKey: 'ARK_API_KEY',
        models: [],
      },
    });
  });

  it('builds modelstudio payload and returns null for multi-instance providers', () => {
    expect(
      buildNonOAuthAgentProviderUpdate(
        providerConfig({ type: 'modelstudio', id: 'modelstudio' }),
        'modelstudio',
        'modelstudio/qwen3.5-plus',
      ),
    ).toEqual({
      providerKey: 'modelstudio',
      entry: {
        baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
        api: 'openai-completions',
        apiKey: 'MODELSTUDIO_API_KEY',
        models: [{ id: 'qwen3.5-plus', name: 'qwen3.5-plus' }],
      },
    });

    expect(
      buildNonOAuthAgentProviderUpdate(
        providerConfig({ type: 'custom', id: 'custom-123' }),
        'custom-123',
        'custom-123/model',
      ),
    ).toBeNull();

    expect(
      buildNonOAuthAgentProviderUpdate(
        providerConfig({ type: 'ollama', id: 'ollama' }),
        'ollama',
        'ollama/qwen3:latest',
      ),
    ).toBeNull();
  });
});
