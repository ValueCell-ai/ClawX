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
