import { describe, expect, it } from 'vitest';
import { resolveModelContextWindow } from '@electron/utils/openclaw-compaction';

describe('resolveModelContextWindow', () => {
  it('reads an explicit model context window without mutating compaction config', () => {
    const config: Record<string, unknown> = {
      models: { providers: { openai: {
        models: [{ id: 'gpt-5.6-luna', contextWindow: 272_000 }],
      } } },
      agents: { defaults: { compaction: { mode: 'safeguard' } } },
    };

    expect(resolveModelContextWindow(config, 'openai/gpt-5.6-luna')).toBe(272_000);
    expect(config.agents).toEqual({ defaults: { compaction: { mode: 'safeguard' } } });
  });

  it('prefers the effective context token limit over the native context window', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          openai: {
            models: [{
              id: 'gpt-5.6-sol',
              contextWindow: 1_050_000,
              contextTokens: 272_000,
            }],
          },
        },
      },
    };

    expect(resolveModelContextWindow(config, 'openai/gpt-5.6-sol')).toBe(272_000);
  });

  it('applies the transport ceiling to an oversized configured context window', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          openai: {
            api: 'openai-chatgpt-responses',
            models: [{ id: 'gpt-5.6-sol', contextWindow: 1_050_000 }],
          },
        },
      },
    };

    expect(resolveModelContextWindow(config, 'openai/gpt-5.6-sol')).toBe(272_000);
  });

  it('does not infer a context window from a model name', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          deepseek: {
            models: [{ id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }],
          },
        },
      },
    };

    expect(resolveModelContextWindow(config, 'deepseek/deepseek-v4-pro')).toBeUndefined();
  });

  it('returns undefined for malformed and unknown model refs', () => {
    expect(resolveModelContextWindow({}, 'custom-provider/unknown-model')).toBeUndefined();
    expect(resolveModelContextWindow({}, 'invalid')).toBeUndefined();
  });
});
