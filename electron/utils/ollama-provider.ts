/**
 * Ollama provider helpers
 * Keeps ClawX/OpenClaw compatibility logic centralized.
 */

export const OLLAMA_PLACEHOLDER_KEY = 'ollama-local';
export const OLLAMA_OPENAI_BASE_URL_DEFAULT = 'http://localhost:11434/v1';

/** Whether the provider type is Ollama */
export function isOllamaProvider(type: string): boolean {
  return type === 'ollama';
}

/**
 * Normalize Ollama base URL for OpenAI-compatible mode.
 * Ensures `/v1` suffix and trims trailing slashes.
 */
export function normalizeOllamaBaseUrlForOpenAI(
  baseUrl?: string,
  options?: { fallbackToDefault?: boolean }
): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return options?.fallbackToDefault ? OLLAMA_OPENAI_BASE_URL_DEFAULT : undefined;
  }

  const noTrailingSlash = trimmed.replace(/\/+$/, '');
  if (/\/v1$/i.test(noTrailingSlash)) {
    return noTrailingSlash;
  }

  return `${noTrailingSlash}/v1`;
}

/**
 * Resolve the effective API key used by ClawX for provider sync.
 * Ollama gets a deterministic placeholder key even when user input is empty,
 * because OpenClaw still requires a resolvable credential source.
 */
export function resolveEffectiveProviderApiKey(
  providerType: string,
  rawApiKey?: string | null,
  fallbackApiKey?: string | null
): string | null {
  const normalizedRaw = rawApiKey?.trim();
  if (normalizedRaw) return normalizedRaw;

  const normalizedFallback = fallbackApiKey?.trim();
  if (normalizedFallback) return normalizedFallback;

  if (isOllamaProvider(providerType)) {
    return OLLAMA_PLACEHOLDER_KEY;
  }

  return null;
}
