import { describe, expect, it } from 'vitest';

import { inferCustomModelInputModalities } from '@electron/shared/providers/model-capabilities';

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
