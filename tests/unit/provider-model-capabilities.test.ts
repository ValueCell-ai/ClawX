import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  inferCustomModelContextWindow,
  inferCustomModelInputModalities,
} from '@electron/shared/providers/model-capabilities';

describe('inferCustomModelInputModalities', () => {
  it.each([
    'gpt-4o',
    'claude-opus-4-6',
    'gemini-3-flash',
    'qwen2.5-vl',
    'glm-4v',
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
    ['gpt-5.5', 272_000],
    ['GPT-5.4-Mini', 272_000],
    ['gpt-4o', 128_000],
    ['claude-opus-4-6', 200_000],
    ['gemini-3-flash', 1_048_576],
    ['kimi-k2.6', 256_000],
    ['MiniMax-M3', 204_800],
  ])('maps known family %s to %d tokens', (modelId, expected) => {
    expect(inferCustomModelContextWindow(modelId)).toBe(expected);
  });

  it('falls back to the conservative default for unknown models', () => {
    expect(inferCustomModelContextWindow('unknown-private-model')).toBe(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW);
  });
});
