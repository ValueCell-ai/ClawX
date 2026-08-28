import { describe, expect, it } from 'vitest';
import {
  applyModelAwareCompactionReserveTokensFloor,
  resolveModelContextWindow,
} from '@electron/utils/openclaw-compaction';

describe('applyModelAwareCompactionReserveTokensFloor', () => {
  it('overwrites an existing floor with 25% of the selected model context window', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          openai: {
            models: [{ id: 'gpt-5.6-luna', contextWindow: 272_000 }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'openai/gpt-5.6-luna')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 68_000 },
      },
    });
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
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'openai/gpt-5.6-sol')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 68_000 },
      },
    });
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
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 100_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'openai/gpt-5.6-sol')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 68_000 },
      },
    });
  });

  it('uses 50000 without inferring a context window from a known model name', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          deepseek: {
            models: [{ id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 250_000 },
        },
      },
    };

    expect(resolveModelContextWindow(config, 'deepseek/deepseek-v4-pro')).toBeUndefined();
    expect(applyModelAwareCompactionReserveTokensFloor(config, 'deepseek/deepseek-v4-pro')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
      },
    });
  });

  it('keeps the 50000 fallback unchanged when the model context window is unknown', () => {
    const config: Record<string, unknown> = {
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'custom-provider/unknown-model')).toBe(false);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
      },
    });
  });
});
