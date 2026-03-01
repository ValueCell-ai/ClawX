import { describe, expect, it } from 'vitest';
import {
  OLLAMA_OPENAI_BASE_URL_DEFAULT,
  OLLAMA_PLACEHOLDER_KEY,
  normalizeOllamaBaseUrlForOpenAI,
  resolveEffectiveProviderApiKey,
} from '@electron/utils/ollama-provider';

describe('ollama provider helpers', () => {
  it('resolves placeholder key for empty ollama API key', () => {
    expect(resolveEffectiveProviderApiKey('ollama', '')).toBe(OLLAMA_PLACEHOLDER_KEY);
    expect(resolveEffectiveProviderApiKey('ollama', '   ')).toBe(OLLAMA_PLACEHOLDER_KEY);
    expect(resolveEffectiveProviderApiKey('ollama', undefined)).toBe(OLLAMA_PLACEHOLDER_KEY);
  });

  it('keeps explicit keys and fallback keys', () => {
    expect(resolveEffectiveProviderApiKey('ollama', 'real-key')).toBe('real-key');
    expect(resolveEffectiveProviderApiKey('ollama', undefined, 'from-store')).toBe('from-store');
    expect(resolveEffectiveProviderApiKey('openai', '')).toBeNull();
    expect(resolveEffectiveProviderApiKey('openai', undefined, 'from-store')).toBe('from-store');
  });

  it('normalizes ollama base URL to include /v1', () => {
    expect(normalizeOllamaBaseUrlForOpenAI('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrlForOpenAI('http://localhost:11434/')).toBe('http://localhost:11434/v1');
    expect(normalizeOllamaBaseUrlForOpenAI('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
  });

  it('returns default base URL when fallback enabled and input empty', () => {
    expect(normalizeOllamaBaseUrlForOpenAI(undefined, { fallbackToDefault: true })).toBe(
      OLLAMA_OPENAI_BASE_URL_DEFAULT
    );
    expect(normalizeOllamaBaseUrlForOpenAI('', { fallbackToDefault: true })).toBe(
      OLLAMA_OPENAI_BASE_URL_DEFAULT
    );
    expect(normalizeOllamaBaseUrlForOpenAI('  ', { fallbackToDefault: true })).toBe(
      OLLAMA_OPENAI_BASE_URL_DEFAULT
    );
  });
});
