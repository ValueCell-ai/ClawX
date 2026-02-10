/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: When adding a new provider type, also update
 * electron/utils/provider-registry.ts (env vars, models, configs).
 */

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'minimax',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  model?: string;
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
  /** Model brand name for display (e.g. "Claude", "GPT") */
  model?: string;
  requiresApiKey: boolean;
}

/** All supported provider types with UI metadata */
export const PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [
  { id: 'anthropic', name: 'Anthropic', icon: '🤖', placeholder: 'sk-ant-api03-...', model: 'Claude', requiresApiKey: true },
  { id: 'openai', name: 'OpenAI', icon: '💚', placeholder: 'sk-proj-...', model: 'GPT', requiresApiKey: true },
  { id: 'google', name: 'Google', icon: '🔷', placeholder: 'AIza...', model: 'Gemini', requiresApiKey: true },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', placeholder: 'sk-or-v1-...', model: 'Multi-Model', requiresApiKey: true },
  { id: 'minimax', name: 'MiniMax', icon: '🔮', placeholder: 'sk-...', model: 'MiniMax M2.1', requiresApiKey: true },
  { id: 'ollama', name: 'Ollama', icon: '🦙', placeholder: 'Not required', requiresApiKey: false },
  { id: 'custom', name: 'Custom', icon: '⚙️', placeholder: 'API key...', requiresApiKey: false },
];

/** Subset shown in the Setup wizard (major cloud providers only) */
export const SETUP_PROVIDERS = PROVIDER_TYPE_INFO.filter((p) =>
  (['anthropic', 'openai', 'google', 'openrouter', 'minimax'] as ProviderType[]).includes(p.id),
);

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}
