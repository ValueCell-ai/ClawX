import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  BUILTIN_PROVIDER_TYPES,
  getProviderConfig,
  getProviderEnvVar,
  getProviderEnvVars,
} from '@electron/utils/provider-registry';

describe('provider metadata', () => {
  it('includes ark in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('ark');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ark',
          name: 'ByteDance Ark',
          requiresApiKey: true,
          defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          codePlanPresetModelId: 'ark-code-latest',
          codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
        }),
      ])
    );
  });

  it('includes ark in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('ark');
    expect(getProviderEnvVar('ark')).toBe('ARK_API_KEY');
    expect(getProviderConfig('ark')).toEqual({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    });
  });

  it('uses a single canonical env key for moonshot provider', () => {
    expect(getProviderEnvVar('moonshot')).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVars('moonshot')).toEqual(['MOONSHOT_API_KEY']);
    expect(getProviderConfig('moonshot')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      })
    );
  });

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'ark', 'moonshot', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'qwen-portal', 'ollama'])
    );
  });

  it('uses OpenAI-compatible Ollama default base URL', () => {
    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          defaultBaseUrl: 'http://localhost:11434/v1',
          requiresApiKey: false,
          showBaseUrl: true,
          showModelId: true,
        }),
      ])
    );
  });

  it('exposes provider documentation links', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const custom = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'custom');

    expect(anthropic).toMatchObject({
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    });
    expect(getProviderDocsUrl(anthropic, 'en')).toBe('https://platform.claude.com/docs/en/api/overview');
    expect(getProviderDocsUrl(openrouter, 'en')).toBe('https://openrouter.ai/models');
    expect(getProviderDocsUrl(moonshot, 'en')).toBe('https://platform.moonshot.cn/');
    expect(getProviderDocsUrl(siliconflow, 'en')).toBe('https://docs.siliconflow.cn/cn/userguide/introduction');
    expect(getProviderDocsUrl(ark, 'en')).toBe('https://www.volcengine.com/');
    expect(getProviderDocsUrl(custom, 'en')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth'
    );
    expect(getProviderDocsUrl(custom, 'zh-CN')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh'
    );
  });

  it('exposes OpenRouter and SiliconFlow model overrides by default', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');

    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: 'openai/gpt-5.4',
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      defaultModelId: 'deepseek-ai/DeepSeek-V3',
    });

    expect(shouldShowProviderModelId(openrouter, false)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, false)).toBe(true);
    expect(shouldShowProviderModelId(openrouter, true)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, true)).toBe(true);
  });

  it('saves OpenRouter and SiliconFlow model overrides by default', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');

    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');

    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', true)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', true)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');

    expect(resolveProviderModelForSave(openrouter, '   ', false)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(openrouter, '   ', true)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(siliconflow, '   ', true)).toBe('deepseek-ai/DeepSeek-V3');
    expect(resolveProviderModelForSave(ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
  });

  it('normalizes provider API keys for save flow', () => {
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });
});
