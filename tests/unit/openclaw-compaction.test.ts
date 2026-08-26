import { describe, expect, it } from 'vitest';
import { applyModelAwareCompactionReserveTokensFloor } from '@electron/utils/openclaw-compaction';

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
              contextTokens: 200_000,
            }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 80_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'openai/gpt-5.6-sol')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 50_000 },
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
        compaction: { mode: 'safeguard', reserveTokensFloor: 90_500 },
      },
    });
  });

  it('lifts a stale 272k custom-provider default to 362k instead of the family window', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          'custom-customb4': {
            api: 'openai-completions',
            models: [{ id: 'gpt-5.6-sol', contextWindow: 272_000 }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 250_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'custom-customb4/gpt-5.6-sol')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 90_500 },
      },
    });
  });

  it('lifts the legacy 272k ChatGPT cap to the current 362k ceiling', () => {
    const config: Record<string, unknown> = {
      models: {
        providers: {
          openai: {
            api: 'openai-chatgpt-responses',
            models: [{ id: 'gpt-5.6-sol', contextWindow: 272_000 }],
          },
        },
      },
      agents: {
        defaults: {
          compaction: { mode: 'safeguard', reserveTokensFloor: 68_000 },
        },
      },
    };

    expect(applyModelAwareCompactionReserveTokensFloor(config, 'openai/gpt-5.6-sol')).toBe(true);
    expect(config.agents).toEqual({
      defaults: {
        compaction: { mode: 'safeguard', reserveTokensFloor: 90_500 },
      },
    });
  });

  it('does not replace an existing floor when the model context window is unknown', () => {
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
