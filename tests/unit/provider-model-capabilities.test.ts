import { describe, expect, it } from 'vitest';

import {
  inferCustomModelInputModalities,
  inferCustomModelMetadata,
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

describe('inferCustomModelMetadata', () => {
  it.each([
    'glm-5',
    'glm-5.2',
    'glm-5-turbo',
    'glm-5v-turbo',
    'glm-4.7',
    'glm-4.5-air',
  ])('marks BigModel GLM reasoning model %s as ZAI-compatible thinking', (modelId) => {
    expect(inferCustomModelMetadata(modelId, {
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    })).toEqual(expect.objectContaining({
      input: expect.any(Array),
      reasoning: true,
      compat: expect.objectContaining({
        thinkingFormat: 'zai',
        supportsReasoningEffort: false,
      }),
    }));
  });

  it('does not infer ZAI thinking metadata for GLM ids on unrelated endpoints', () => {
    expect(inferCustomModelMetadata('glm-5.2', {
      baseUrl: 'https://example.com/v1',
    })).toEqual({ input: ['text'] });
  });
});
