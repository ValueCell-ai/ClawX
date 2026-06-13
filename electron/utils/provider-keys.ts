const MULTI_INSTANCE_PROVIDER_TYPES = new Set(['custom', 'ollama']);

export const OPENCLAW_PROVIDER_KEY_MINIMAX = 'minimax-portal';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT = 'moonshot';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL = 'moonshot-global';
/** OpenClaw Codex OAuth runtime provider id (canonical `openai`, not legacy `openai-codex`). */
export const OPENAI_CODEX_RUNTIME_PROVIDER_KEY = 'openai';
export const CLAWX_OPENAI_IMAGE_PROVIDER_KEY = 'clawx-openai-image';
export const OAUTH_PROVIDER_TYPES = ['minimax-portal', 'minimax-portal-cn'] as const;
export const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS = [
  OPENCLAW_PROVIDER_KEY_MINIMAX,
] as const;

const OAUTH_PROVIDER_TYPE_SET = new Set<string>(OAUTH_PROVIDER_TYPES);
const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET = new Set<string>(OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS);
const HIDDEN_PROVIDER_KEYS_FOR_UI = new Set<string>([
  CLAWX_OPENAI_IMAGE_PROVIDER_KEY,
]);

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  'minimax-portal-cn': OPENCLAW_PROVIDER_KEY_MINIMAX,
};

export function getOpenClawProviderKeyForType(type: string, providerId: string): string {
  if (MULTI_INSTANCE_PROVIDER_TYPES.has(type)) {
    // If the providerId is already a runtime key (e.g. re-seeded from openclaw.json
    // as "custom-XXXXXXXX"), return it directly to avoid double-hashing.
    const prefix = `${type}-`;
    if (providerId.startsWith(prefix)) {
      const tail = providerId.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return providerId;
      }
    }
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }

  return PROVIDER_KEY_ALIASES[type] ?? type;
}

/**
 * Resolve the OpenClaw runtime provider key for a saved account.
 * Browser OAuth for OpenAI is stored under vendorId `openai` and runs as `openai`.
 */
export function resolveOpenClawProviderKey(account: {
  vendorId: string;
  id: string;
  authMode?: string;
}): string {
  if (account.authMode === 'oauth_browser' && account.vendorId === 'openai') {
    return OPENAI_CODEX_RUNTIME_PROVIDER_KEY;
  }
  return getOpenClawProviderKeyForType(account.vendorId, account.id);
}

/**
 * Get all vendorId values that map to the given openclaw.json key via alias.
 * e.g. getAliasSourceTypes('minimax-portal') → ['minimax-portal-cn']
 */
export function getAliasSourceTypes(openClawKey: string): string[] {
  return Object.entries(PROVIDER_KEY_ALIASES)
    .filter(([, target]) => target === openClawKey)
    .map(([source]) => source);
}

/**
 * Legacy OpenClaw builds wrote OAuth under runtime key `openai-codex`. Hide that
 * stale slot when the canonical `openai` OAuth entry is active.
 */
export function filterActiveProviderKeysForUi(
  activeKeys: Iterable<string>,
  options?: { hasConfiguredOpenAiApiKey?: boolean },
): string[] {
  const keys = Array.from(activeKeys).filter((key) => !HIDDEN_PROVIDER_KEYS_FOR_UI.has(key));
  if (keys.includes('openai') && keys.includes('openai-codex') && !options?.hasConfiguredOpenAiApiKey) {
    return keys.filter((key) => key !== 'openai-codex');
  }
  return keys;
}

export function isOAuthProviderType(type: string): boolean {
  return OAUTH_PROVIDER_TYPE_SET.has(type);
}

export function isMiniMaxProviderType(type: string): boolean {
  return type === OPENCLAW_PROVIDER_KEY_MINIMAX || type === 'minimax-portal-cn';
}

export function getOAuthProviderTargetKey(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthProviderApi(type: string): 'anthropic-messages' | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return 'anthropic-messages';
}

export function getOAuthProviderDefaultBaseUrl(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  if (type === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'https://api.minimax.io/anthropic';
  if (type === 'minimax-portal-cn') return 'https://api.minimaxi.com/anthropic';
  return undefined;
}

export function normalizeOAuthBaseUrl(_type: string, baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
}

export function usesOAuthAuthHeader(providerKey: string): boolean {
  return providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthApiKeyEnv(providerKey: string): string | undefined {
  if (providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'minimax-oauth';
  return undefined;
}

export function isOpenClawOAuthPluginProviderKey(provider: string): boolean {
  return OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET.has(provider);
}
