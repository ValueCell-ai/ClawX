/**
 * Provider Registry — single source of truth for backend provider metadata.
 * Centralizes env var mappings, default models, and OpenClaw provider configs.
 *
 * NOTE: When adding a new provider type, also update src/lib/providers.ts
 */

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'moonshot',
  'siliconflow',
  'minimax-portal',
  'qwen-portal',
  'ollama',
] as const;
export type BuiltinProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number];
export type ProviderType = BuiltinProviderType | 'custom';

interface ProviderModelEntry extends Record<string, unknown> {
  id: string;
  name: string;
}


interface ProviderBackendMeta {
  envVar?: string;
  defaultModel?: string;
  /** OpenClaw models.providers config (omit for built-in providers like anthropic) */
  providerConfig?: {
    baseUrl: string;
    api: string;
    apiKeyEnv: string;
    models?: ProviderModelEntry[];
  };
}

const REGISTRY: Record<string, ProviderBackendMeta> = {
  anthropic: {
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'anthropic/claude-opus-4-6',
    // anthropic is built-in to OpenClaw's model registry, no provider config needed
  },
  openai: {
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'openai/gpt-5.2',
    providerConfig: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  },
  google: {
    envVar: 'GEMINI_API_KEY',
    defaultModel: 'google/gemini-3.1-pro-preview',
    // google is built-in to OpenClaw's pi-ai catalog, no providerConfig needed.
    // Adding models.providers.google overrides the built-in and can break Gemini.
  },
  openrouter: {
    envVar: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/anthropic/claude-opus-4.6',
    providerConfig: {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    },
  },
  moonshot: {
    envVar: 'MOONSHOT_API_KEY',
    defaultModel: 'moonshot/kimi-k2.5',
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
  siliconflow: {
    envVar: 'SILICONFLOW_API_KEY',
    defaultModel: 'siliconflow/deepseek-ai/DeepSeek-V3',
    providerConfig: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
    },
  },
  'minimax-portal': {
    defaultModel: 'minimax-portal/MiniMax-M2.1',
  },
  'qwen-portal': {
    defaultModel: 'qwen-portal/coder-model',
  },
  custom: {
    envVar: 'CUSTOM_API_KEY',
  },
  // Additional providers with env var mappings but no default model
  groq: { envVar: 'GROQ_API_KEY' },
  deepgram: { envVar: 'DEEPGRAM_API_KEY' },
  cerebras: { envVar: 'CEREBRAS_API_KEY' },
  xai: { envVar: 'XAI_API_KEY' },
  mistral: { envVar: 'MISTRAL_API_KEY' },
};

/** Get the environment variable name for a provider type */
export function getProviderEnvVar(type: string): string | undefined {
  return REGISTRY[type]?.envVar;
}

/** Get the default model string for a provider type */
export function getProviderDefaultModel(type: string): string | undefined {
  return REGISTRY[type]?.defaultModel;
}

/** Get the OpenClaw provider config (baseUrl, api, apiKeyEnv, models) */
export function getProviderConfig(
  type: string
): { baseUrl: string; api: string; apiKeyEnv: string; models?: ProviderModelEntry[] } | undefined {
  return REGISTRY[type]?.providerConfig;
}

/**
 * All provider types that have env var mappings.
 * Used by GatewayManager to inject API keys as env vars.
 */
export function getKeyableProviderTypes(): string[] {
  return Object.entries(REGISTRY)
    .filter(([, meta]) => meta.envVar)
    .map(([type]) => type);
}
