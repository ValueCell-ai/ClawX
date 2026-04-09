/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: Backend provider metadata is being refactored toward the new
 * account-based registry, but the renderer still keeps a local compatibility
 * layer so TypeScript project boundaries remain stable during the migration.
 */

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
] as const;

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  /** If true, this provider is not shown in the "Add Provider" dialog. */
  hidden?: boolean;
}

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

import { providerIcons } from '@/assets/providers';

/** All supported provider types with UI metadata */
export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gpt-5.4',
    showModelId: true,
    showModelIdInDevModeOnly: true,
    modelIdPlaceholder: 'gpt-5.4',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    isOAuth: true,
    supportsApiKey: true,
    defaultModelId: 'gemini-3-pro-preview',
    showModelId: true,
    showModelIdInDevModeOnly: true,
    modelIdPlaceholder: 'gemini-3-pro-preview',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
  },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', model: 'Multi-Model', requiresApiKey: true, showModelId: true, modelIdPlaceholder: 'openai/gpt-5.4', defaultModelId: 'openai/gpt-5.4', docsUrl: 'https://openrouter.ai/models' },
  { id: 'minimax-portal-cn', name: 'MiniMax (CN)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimaxi.com/' },
  { id: 'moonshot', name: 'Moonshot (CN)', icon: '🌙', placeholder: 'sk-...', model: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', defaultModelId: 'kimi-k2.5', docsUrl: 'https://platform.moonshot.cn/' },
  { id: 'siliconflow', name: 'SiliconFlow (CN)', icon: '🌊', placeholder: 'sk-...', model: 'Multi-Model', requiresApiKey: true, defaultBaseUrl: 'https://api.siliconflow.cn/v1', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3', defaultModelId: 'deepseek-ai/DeepSeek-V3', docsUrl: 'https://docs.siliconflow.cn/cn/userguide/introduction' },
  { id: 'minimax-portal', name: 'MiniMax (Global)', icon: '☁️', placeholder: 'sk-...', model: 'MiniMax', requiresApiKey: false, isOAuth: true, supportsApiKey: true, defaultModelId: 'MiniMax-M2.7', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'MiniMax-M2.7', apiKeyUrl: 'https://platform.minimax.io' },
  { id: 'modelstudio', name: 'Model Studio', icon: '☁️', placeholder: 'sk-...', model: 'Qwen', requiresApiKey: true, defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1', showBaseUrl: true, defaultModelId: 'qwen3.5-plus', showModelId: true, showModelIdInDevModeOnly: true, modelIdPlaceholder: 'qwen3.5-plus', apiKeyUrl: 'https://bailian.console.aliyun.com/', hidden: true },
  { id: 'ark', name: 'ByteDance Ark', icon: 'A', placeholder: 'your-ark-api-key', model: 'Doubao', requiresApiKey: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'ep-20260228000000-xxxxx', docsUrl: 'https://www.volcengine.com/', codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', codePlanPresetModelId: 'ark-code-latest', codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh' },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434/v1', showBaseUrl: true, showModelId: true, modelIdPlaceholder: 'qwen3:latest' },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    docsUrl: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth',
    docsUrlZh: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh',
  },
];

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  return providerIcons[type];
}

/** Whether a provider's logo needs CSS invert in dark mode (all logos are monochrome) */
export function shouldInvertInDark(_type: ProviderType | string): boolean {
  return true;
}

/** Provider list shown in the Setup wizard */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO;

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  devModeUnlocked: boolean
): boolean {
  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function resolveProviderModelForSave(
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly'> | undefined,
  modelId: string,
  devModeUnlocked: boolean
): string | undefined {
  if (!shouldShowProviderModelId(provider, devModeUnlocked)) {
    return undefined;
  }

  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

export function normalizeProviderApiKeyInput(apiKey: string): string {
  return apiKey.trim();
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = normalizeProviderApiKeyInput(apiKey);
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}
