export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
  'custom',
] as const;

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'modelstudio',
  'ollama',
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type BuiltinProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number];

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

/**
 * Authoritative set of `models.providers.*.api` values accepted by the
 * OpenClaw Gateway config schema.  Keep in sync with OpenClaw's
 * `assertValidGatewayStartupConfigSnapshot`.
 *
 * Writing any other value into `~/.openclaw/openclaw.json` triggers
 * `Invalid config` rejection on next reload/restart and tears down all
 * channels.  Use `assertValidApiProtocol` at every write site.
 */
export const OPENCLAW_API_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'google-generative-ai',
  'github-copilot',
  'bedrock-converse-stream',
  'ollama',
  'azure-openai-responses',
] as const;

export type OpenClawApiProtocol = (typeof OPENCLAW_API_PROTOCOLS)[number];

export class InvalidApiProtocolError extends Error {
  constructor(public readonly api: unknown, public readonly providerKey?: string) {
    super(
      `Invalid OpenClaw api protocol${providerKey ? ` for provider "${providerKey}"` : ''}: ` +
      `${JSON.stringify(api)}. Expected one of: ${OPENCLAW_API_PROTOCOLS.join(', ')}.`,
    );
    this.name = 'InvalidApiProtocolError';
  }
}

export function assertValidApiProtocol(
  api: unknown,
  providerKey?: string,
): asserts api is OpenClawApiProtocol {
  if (typeof api !== 'string' || !(OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)) {
    throw new InvalidApiProtocolError(api, providerKey);
  }
}

/**
 * UI-selectable subset of api protocols offered to users when configuring
 * custom or Ollama providers in Settings.  Tightly scoped on purpose so the
 * UI dropdown stays simple; built-in providers use the broader
 * {@link OpenClawApiProtocol} via {@link ProviderBackendConfig.api}.
 */
export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages';

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

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
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
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
}

export interface ProviderModelEntry extends Record<string, unknown> {
  id: string;
  name: string;
}

export interface ProviderBackendConfig {
  baseUrl: string;
  api: OpenClawApiProtocol;
  apiKeyEnv: string;
  models?: ProviderModelEntry[];
  headers?: Record<string, string>;
}

export interface ProviderDefinition extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  providerConfig?: ProviderBackendConfig;
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
  apiProtocol?: ProviderProtocol;
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

export type ProviderSecret =
  | {
    type: 'api_key';
    accountId: string;
    apiKey: string;
  }
  | {
    type: 'oauth';
    accountId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    email?: string;
    subject?: string;
  }
  | {
    type: 'local';
    accountId: string;
    apiKey?: string;
  };

export interface ModelSummary {
  id: string;
  name: string;
  vendorId: string;
  accountId?: string;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  contextWindow?: number;
  pricing?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  source: 'builtin' | 'remote' | 'gateway' | 'custom';
}
