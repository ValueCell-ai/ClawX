import { describe, expect, it } from 'vitest';

import {
  CHATGPT_OAUTH_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  LOCAL_MODEL_CONTEXT_WINDOW,
  inferCustomModelContextWindow,
  inferCustomModelInputModalities,
} from '@electron/shared/providers/model-capabilities';

describe('inferCustomModelInputModalities', () => {
  it.each([
    'gpt-4o',
    'gpt-5.6-sol',
    'claude-opus-4-6',
    'claude-fable-5',
    'gemini-3-flash',
    'qwen2.5-vl',
    'glm-4v',
    'openai/gpt-5.6-sol',
  ])('marks known vision model %s as image-capable', (modelId) => {
    expect(inferCustomModelInputModalities(modelId)).toEqual(['text', 'image']);
  });

  it.each([
    'deepseek-chat',
    'kimi-k2.6',
    'qwen3.6-plus',
    'unknown-private-model',
  ])('uses conservative text-only input for %s', (modelId) => {
    expect(inferCustomModelInputModalities(modelId)).toEqual(['text']);
  });
});

describe('inferCustomModelContextWindow', () => {
  it.each([
    // OpenAI: generation-specific rules must win over the bare gpt-5 family.
    ['gpt-5.6-sol', 1_050_000],
    ['gpt-5.6-terra', 1_050_000],
    ['gpt-5.6-luna', 272_000],
    ['gpt-5.5', 1_000_000],
    ['GPT-5.4-Mini', 272_000],
    ['gpt-5', 400_000],
    ['gpt-4o', 128_000],

    // Anthropic
    ['claude-fable-5', 1_000_000],
    ['claude-opus-4-8', 1_000_000],
    ['claude-sonnet-4-6', 1_000_000],
    ['claude-opus-4-6', 200_000],
    ['claude-haiku-4-5', 200_000],

    // Google
    ['gemini-3.1-pro-preview', 1_048_576],
    ['gemini-1.0-pro', 32_768],

    // DeepSeek: V4 and its aliases are 1M, V3 is not.
    ['deepseek-v4-flash', 1_000_000],
    ['deepseek-v4-pro', 1_000_000],
    ['deepseek-chat', 1_000_000],
    ['deepseek-v3', 128_000],

    // Moonshot: only K3 reached a million tokens.
    ['kimi-k3', 1_000_000],
    ['kimi-k2.6', 262_144],

    // Qwen
    ['qwen-long', 10_000_000],
    ['qwen3.6-plus', 1_000_000],
    ['qwen3.5-397b', 262_144],
    ['qwen3-next-80b', 262_144],

    // Z.AI GLM — mirrors the explicit rows in the provider registry.
    ['glm-5.2', 1_000_000],
    ['glm-5.1', 200_000],
    ['glm-4.7', 200_000],

    // MiniMax
    ['MiniMax-M3', 524_288],
    ['MiniMax-M2.7', 204_800],
  ])('maps known family %s to %d tokens', (modelId, expected) => {
    expect(inferCustomModelContextWindow(modelId)).toBe(expected);
  });

  it.each([
    ['openai/gpt-5.6-sol', 1_050_000],
    ['deepseek-ai/DeepSeek-V3', 128_000],
    ['moonshotai/kimi-k3', 1_000_000],
  ])('resolves the family behind vendor-prefixed id %s', (modelId, expected) => {
    expect(inferCustomModelContextWindow(modelId)).toBe(expected);
  });

  it('falls back to the frontier-era default for unknown models', () => {
    expect(inferCustomModelContextWindow('unknown-private-model')).toBe(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW);
    expect(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW).toBe(200_000);
  });

  describe('locally hosted providers', () => {
    it('caps family inference so a local tag cannot inherit a frontier window', () => {
      expect(inferCustomModelContextWindow('deepseek-v4-flash', { providerKey: 'ollama-a1b2c3' }))
        .toBe(LOCAL_MODEL_CONTEXT_WINDOW);
    });

    it('strips the Ollama tag before matching the family', () => {
      expect(inferCustomModelContextWindow('qwen3:latest', { providerKey: 'ollama-a1b2c3' }))
        .toBe(131_072);
    });

    it('keeps a window smaller than the local ceiling', () => {
      expect(inferCustomModelContextWindow('gpt-4o', { providerKey: 'ollama-a1b2c3' }))
        .toBe(128_000);
    });

    it('does not cap hosted providers', () => {
      expect(inferCustomModelContextWindow('deepseek-v4-flash', { providerKey: 'deepseek' }))
        .toBe(1_000_000);
    });
  });

  describe('ChatGPT subscription transport', () => {
    it.each([
      'openai-chatgpt-responses',
      'openai-codex-responses',
    ])('caps API-tier windows on %s', (apiProtocol) => {
      expect(inferCustomModelContextWindow('gpt-5.6-sol', { providerKey: 'openai', apiProtocol }))
        .toBe(CHATGPT_OAUTH_CONTEXT_WINDOW);
      expect(inferCustomModelContextWindow('gpt-5.5', { providerKey: 'openai', apiProtocol }))
        .toBe(CHATGPT_OAUTH_CONTEXT_WINDOW);
    });

    it('leaves the API-key transport at the published window', () => {
      expect(inferCustomModelContextWindow('gpt-5.6-sol', {
        providerKey: 'openai',
        apiProtocol: 'openai-responses',
      })).toBe(1_050_000);
    });

    it('keeps a window already below the subscription ceiling', () => {
      expect(inferCustomModelContextWindow('gpt-4o', {
        providerKey: 'openai',
        apiProtocol: 'openai-chatgpt-responses',
      })).toBe(128_000);
    });

    it('caps the unknown-model default too', () => {
      expect(inferCustomModelContextWindow('some-internal-preview', {
        providerKey: 'openai',
        apiProtocol: 'openai-chatgpt-responses',
      })).toBe(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW);
      expect(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW).toBeLessThan(CHATGPT_OAUTH_CONTEXT_WINDOW);
    });
  });

  describe('MiniMax OAuth', () => {
    // Device OAuth hits the same platform API as a key, so no transport cap.
    it('keeps the platform window for oauth-backed MiniMax', () => {
      expect(inferCustomModelContextWindow('MiniMax-M3', {
        providerKey: 'minimax',
        apiProtocol: 'anthropic-messages',
      })).toBe(524_288);
    });
  });
});
