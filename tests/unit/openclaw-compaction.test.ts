import { describe, expect, it } from 'vitest';
import { resolveModelContextWindow } from '@electron/utils/openclaw-compaction';

describe('resolveModelContextWindow', () => {
  it('reads the configured context window of the selected model', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          openai: {
            models: [{ id: 'gpt-5.6-luna', contextWindow: 272_000 }],
          },
        },
      },
    };

    expect(resolveModelContextWindow(config, 'openai/gpt-5.6-luna')).toBe(272_000);
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

  it('does not infer a context window from a known model name', () => {
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

  it('returns undefined for unknown or malformed model refs', () => {
    expect(resolveModelContextWindow({}, 'custom-provider/unknown-model')).toBeUndefined();
    expect(resolveModelContextWindow({}, 'no-slash')).toBeUndefined();
    expect(resolveModelContextWindow({}, null)).toBeUndefined();
  });
});
