import { describe, expect, it } from 'vitest';
import {
  normalizeProviderApiKeyInput,
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  getProviderIconUrl,
  isProviderAvailableForLanguage,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldInvertInDark,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  BUILTIN_PROVIDER_TYPES,
  getProviderConfig,
  getProviderDefaultModel,
  getProviderEnvVar,
  getProviderEnvVars,
} from '@electron/utils/provider-registry';
import { OPENCLAW_API_PROTOCOLS } from '@electron/shared/providers/types';

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

  it('includes TokenDance OAuth with ClawX request attribution', () => {
    expect(PROVIDER_TYPES).toContain('tokendance');
    expect(BUILTIN_PROVIDER_TYPES).toContain('tokendance');
    expect(PROVIDER_TYPE_INFO).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tokendance',
        name: 'TokenDance',
        isOAuth: true,
        supportsApiKey: true,
        defaultBaseUrl: 'https://tokendance.space/gateway/v1',
        defaultModelId: 'qwen3.8-max',
        availableInLanguages: ['zh'],
      }),
    ]));
    expect(getProviderIconUrl('tokendance')).toMatch(/^data:image\/svg\+xml,/);
    expect(shouldInvertInDark('tokendance')).toBe(false);
    expect(getProviderEnvVar('tokendance')).toBe('TOKENDANCE_API_KEY');
    expect(getProviderConfig('tokendance')).toEqual({
      baseUrl: 'https://tokendance.space/gateway/v1',
      api: 'openai-completions',
      apiKeyEnv: 'TOKENDANCE_API_KEY',
      headers: { 'X-App-URL': 'https://clawx.com.cn' },
    });
  });

  it('limits TokenDance discovery to Chinese interface locales', () => {
    const tokenDance = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'tokendance');
    const openAi = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');

    expect(tokenDance).toBeDefined();
    expect(isProviderAvailableForLanguage(tokenDance!, 'zh')).toBe(true);
    expect(isProviderAvailableForLanguage(tokenDance!, 'zh-CN')).toBe(true);
    expect(isProviderAvailableForLanguage(tokenDance!, 'en')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'ja')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'ru')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'unsupported')).toBe(false);
    expect(isProviderAvailableForLanguage(openAi!, 'en')).toBe(true);
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

  it('includes Z.AI CN and Global with OpenClaw-aligned endpoints and glm-5.3-flash default', () => {
    expect(PROVIDER_TYPES).toEqual(expect.arrayContaining(['zai', 'zai-global']));
    expect(BUILTIN_PROVIDER_TYPES).toEqual(expect.arrayContaining(['zai', 'zai-global']));

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'zai',
          name: 'Z.AI (CN)',
          defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          defaultModelId: 'glm-5.3-flash',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
          codePlanPresetModelId: 'glm-5.3-flash',
          codePlanDocsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
        }),
        expect.objectContaining({
          id: 'zai-global',
          name: 'Z.AI (Global)',
          defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
          defaultModelId: 'glm-5.3-flash',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
          codePlanPresetModelId: 'glm-5.3-flash',
          codePlanDocsUrl: 'https://docs.z.ai/devpack/quick-start',
        }),
      ]),
    );

    expect(getProviderEnvVar('zai')).toBe('ZAI_API_KEY');
    expect(getProviderEnvVar('zai-global')).toBe('ZAI_API_KEY');
    expect(getProviderConfig('zai')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        api: 'openai-completions',
        apiKeyEnv: 'ZAI_API_KEY',
      }),
    );
    expect(getProviderConfig('zai-global')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.z.ai/api/paas/v4',
        api: 'openai-completions',
        apiKeyEnv: 'ZAI_API_KEY',
      }),
    );
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

  it('ships matching default models in the renderer and Main registries', () => {
    for (const provider of PROVIDER_TYPE_INFO) {
      if (provider.id === 'custom') continue;
      expect(
        { id: provider.id, defaultModelId: getProviderDefaultModel(provider.id) },
        `renderer/Main default model drift for ${provider.id}`,
      ).toEqual({ id: provider.id, defaultModelId: provider.defaultModelId });
    }
  });

  it('declares image input on the million-token catalog rows and keeps GLM-5.3 text-only', () => {
    for (const type of ['moonshot', 'moonshot-global']) {
      expect(getProviderConfig(type)?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'kimi-k3',
            input: ['text', 'image'],
            contextWindow: 1_000_000,
          }),
        ]),
      );
    }

    for (const type of ['zai', 'zai-global']) {
      expect(getProviderConfig(type)?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'glm-5.3-flash',
            input: ['text', 'image'],
            contextWindow: 1_000_000,
          }),
          // Same 1M window, but the vendor serves GLM-5.3 as text-only.
          expect.objectContaining({
            id: 'glm-5.3',
            input: ['text'],
            contextWindow: 1_000_000,
          }),
        ]),
      );
    }
  });

  it('gives every hosted built-in provider the backend preset runtime sync needs', () => {
    // `resolveRuntimeSyncContext` derives the api protocol from this preset and
    // returns null without one, which silently skips the auth-profile write,
    // the models.providers entry, and the agent model sync for that provider.
    // `custom` and `ollama` are exempt: they carry a user-supplied base URL and
    // default to openai-completions.
    const exempt = new Set(['custom', 'ollama']);

    for (const type of BUILTIN_PROVIDER_TYPES) {
      if (exempt.has(type)) continue;
      const config = getProviderConfig(type);
      expect(config?.baseUrl, `${type} has no providerConfig.baseUrl`).toBeTruthy();
      expect(OPENCLAW_API_PROTOCOLS, `${type} declares an api OpenClaw rejects`).toContain(
        config?.api,
      );
    }
  });

  it('registers Anthropic and Google against their official endpoints', () => {
    expect(getProviderConfig('anthropic')).toEqual({
      baseUrl: 'https://api.anthropic.com/v1',
      api: 'anthropic-messages',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    });
    expect(getProviderConfig('google')).toEqual({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-generative-ai',
      apiKeyEnv: 'GEMINI_API_KEY',
    });
  });

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'tokendance', 'ark', 'moonshot', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'zai', 'zai-global', 'modelstudio', 'ollama'])
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
    const ollama = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ollama');

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
    expect(getProviderDocsUrl(ollama, 'en')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/FuPewJKmii7Gpmkx2W7cI3uxnRf'
    );
    expect(getProviderDocsUrl(ollama, 'zh-CN')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/FuPewJKmii7Gpmkx2W7cI3uxnRf'
    );
  });

  it('exposes editable model id with default for built-in providers, mirroring OpenRouter', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const deepseek = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'deepseek');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const moonshotGlobal = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot-global');

    expect(anthropic).toMatchObject({
      showModelId: true,
      defaultModelId: 'claude-opus-5',
      modelIdPlaceholder: 'claude-opus-5',
    });
    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: '~deepseek/deepseek-flash-latest',
      modelIdPlaceholder: '~deepseek/deepseek-flash-latest',
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      defaultModelId: 'zai-org/GLM-5.3',
      modelIdPlaceholder: 'zai-org/GLM-5.3',
    });
    expect(deepseek).toMatchObject({
      showModelId: true,
      defaultModelId: 'deepseek-flash',
      modelIdPlaceholder: 'deepseek-flash',
    });
    expect(moonshot).toMatchObject({
      showModelId: true,
      defaultModelId: 'kimi-k3',
      modelIdPlaceholder: 'kimi-k3',
    });
    expect(moonshotGlobal).toMatchObject({
      showModelId: true,
      defaultModelId: 'kimi-k3',
      modelIdPlaceholder: 'kimi-k3',
    });

    for (const provider of [anthropic, openrouter, siliconflow, deepseek, moonshot, moonshotGlobal]) {
      expect(provider?.showModelIdInDevModeOnly).toBeUndefined();
      expect(shouldShowProviderModelId(provider, false)).toBe(true);
      expect(shouldShowProviderModelId(provider, true)).toBe(true);
    }
  });

  it('shows OAuth-capable provider model overrides regardless of dev mode and preserves defaults', () => {
    const openai = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const minimax = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal');
    const minimaxCn = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal-cn');

    expect(openai).toMatchObject({
      showModelId: true,
      defaultModelId: 'gpt-5.6-sol',
      isOAuth: true,
      supportsApiKey: true,
    });
    expect(openai?.hideOAuthUi).toBeUndefined();
    expect(google).toMatchObject({ showModelId: true, defaultModelId: 'gemini-3.8-flash' });
    expect(minimax).toMatchObject({ showModelId: true, defaultModelId: 'MiniMax-M3' });
    expect(minimaxCn).toMatchObject({ showModelId: true, defaultModelId: 'MiniMax-M3' });

    for (const provider of [openai, google, minimax, minimaxCn]) {
      expect(provider?.showModelIdInDevModeOnly).toBeUndefined();
      expect(shouldShowProviderModelId(provider, false)).toBe(true);
      expect(shouldShowProviderModelId(provider, true)).toBe(true);
    }

    expect(resolveProviderModelForSave(openai, '   ', false)).toBe('gpt-5.6-sol');
    expect(resolveProviderModelForSave(google, '   ', false)).toBe('gemini-3.8-flash');
    expect(resolveProviderModelForSave(minimax, '   ', false)).toBe('MiniMax-M3');
    expect(resolveProviderModelForSave(minimaxCn, '   ', false)).toBe('MiniMax-M3');
  });

  it('keeps hidden Model Studio gated behind dev mode (legacy hidden provider)', () => {
    const qwen = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(qwen).toMatchObject({
      hidden: true,
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: 'qwen3.6-plus',
    });
    expect(shouldShowProviderModelId(qwen, false)).toBe(false);
    expect(shouldShowProviderModelId(qwen, true)).toBe(true);
  });

  it('saves user-entered or default model overrides for built-in providers without dev mode', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');

    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false))
      .toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');
    expect(resolveProviderModelForSave(anthropic, 'claude-sonnet-4-5', false)).toBe('claude-sonnet-4-5');

    expect(resolveProviderModelForSave(openrouter, '   ', false)).toBe('~deepseek/deepseek-flash-latest');
    expect(resolveProviderModelForSave(siliconflow, '   ', false)).toBe('zai-org/GLM-5.3');
    expect(resolveProviderModelForSave(anthropic, '   ', false)).toBe('claude-opus-5');
    expect(resolveProviderModelForSave(ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
  });

  it('normalizes provider API keys for save flow', () => {
    expect(normalizeProviderApiKeyInput('  sk-test \n')).toBe('sk-test');
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });
});
