import type {
  ProviderBackendConfig,
  ProviderDefinition,
  ProviderType,
  ProviderTypeInfo,
} from './types';

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    category: 'official',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModelId: 'claude-opus-4-6',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    category: 'official',
    envVar: 'OPENAI_API_KEY',
    defaultModelId: 'gpt-5.2',
    isOAuth: true,
    supportsApiKey: true,
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    category: 'official',
    envVar: 'GEMINI_API_KEY',
    defaultModelId: 'gemini-3.1-pro-preview',
    isOAuth: true,
    supportsApiKey: true,
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    placeholder: 'sk-or-v1-...',
    model: 'Multi-Model',
    requiresApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'anthropic/claude-opus-4.6',
    defaultModelId: 'anthropic/claude-opus-4.6',
    category: 'compatible',
    envVar: 'OPENROUTER_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      headers: {
        'HTTP-Referer': 'https://claw-x.com',
        'X-Title': 'ClawX',
      },
    },
  },
  {
    id: 'ark',
    name: 'ByteDance Ark',
    icon: 'A',
    placeholder: 'your-ark-api-key',
    model: 'Doubao',
    requiresApiKey: true,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'ep-20260228000000-xxxxx',
    category: 'official',
    envVar: 'ARK_API_KEY',
    codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    codePlanPresetModelId: 'ark-code-latest',
    codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    },
  },
  {
    id: 'moonshot',
    name: 'Moonshot (CN)',
    icon: '🌙',
    placeholder: 'sk-...',
    model: 'Kimi',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModelId: 'kimi-k2.5',
    category: 'official',
    envVar: 'MOONSHOT_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MOONSHOT_API_KEY',
      models: [
        {
          id: 'kimi-k2.5',
          name: 'Kimi K2.5',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 256000,
          maxTokens: 8192,
        },
      ],
    },
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow (CN)',
    icon: '🌊',
    placeholder: 'sk-...',
    model: 'Multi-Model',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    showModelId: true,
    showModelIdInDevModeOnly: true,
    modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3',
    defaultModelId: 'deepseek-ai/DeepSeek-V3',
    category: 'compatible',
    envVar: 'SILICONFLOW_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
    },
  },
  {
    id: 'minimax-portal',
    name: 'MiniMax (Global)',
    icon: '☁️',
    placeholder: 'sk-...',
    model: 'MiniMax',
    requiresApiKey: false,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'MiniMax-M2.5',
    apiKeyUrl: 'https://intl.minimaxi.com/',
    category: 'official',
    envVar: 'MINIMAX_API_KEY',
    supportedAuthModes: ['oauth_device', 'api_key'],
    defaultAuthMode: 'oauth_device',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'MINIMAX_API_KEY',
    },
  },
  {
    id: 'minimax-portal-cn',
    name: 'MiniMax (CN)',
    icon: '☁️',
    placeholder: 'sk-...',
    model: 'MiniMax',
    requiresApiKey: false,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'MiniMax-M2.5',
    apiKeyUrl: 'https://platform.minimaxi.com/',
    category: 'official',
    envVar: 'MINIMAX_CN_API_KEY',
    supportedAuthModes: ['oauth_device', 'api_key'],
    defaultAuthMode: 'oauth_device',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'MINIMAX_CN_API_KEY',
    },
  },
  {
    id: 'qwen-portal',
    name: 'Qwen',
    icon: '☁️',
    placeholder: 'sk-...',
    model: 'Qwen',
    requiresApiKey: false,
    isOAuth: true,
    defaultModelId: 'coder-model',
    category: 'official',
    envVar: 'QWEN_API_KEY',
    supportedAuthModes: ['oauth_device'],
    defaultAuthMode: 'oauth_device',
    supportsMultipleAccounts: true,
    providerConfig: {
      baseUrl: 'https://portal.qwen.ai/v1',
      api: 'openai-completions',
      apiKeyEnv: 'QWEN_API_KEY',
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    placeholder: 'Not required',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'qwen3:latest',
    category: 'local',
    supportedAuthModes: ['local'],
    defaultAuthMode: 'local',
    supportsMultipleAccounts: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    category: 'custom',
    envVar: 'CUSTOM_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
];

const PROVIDER_DEFINITION_MAP = new Map(
  PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getProviderDefinition(
  type: ProviderType | string,
): ProviderDefinition | undefined {
  return PROVIDER_DEFINITION_MAP.get(type as ProviderType);
}

export function getProviderTypeInfo(
  type: ProviderType,
): ProviderTypeInfo | undefined {
  return getProviderDefinition(type);
}

export function getProviderEnvVar(type: string): string | undefined {
  return getProviderDefinition(type)?.envVar;
}

export function getProviderDefaultModel(type: string): string | undefined {
  return getProviderDefinition(type)?.defaultModelId;
}

export function getProviderBackendConfig(
  type: string,
): ProviderBackendConfig | undefined {
  return getProviderDefinition(type)?.providerConfig;
}

export function getProviderUiInfoList(): ProviderTypeInfo[] {
  return PROVIDER_DEFINITIONS;
}

export function getKeyableProviderTypes(): string[] {
  return PROVIDER_DEFINITIONS.filter((definition) => definition.envVar).map(
    (definition) => definition.id,
  );
}
