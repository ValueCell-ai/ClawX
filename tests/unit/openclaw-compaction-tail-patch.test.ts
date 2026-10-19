// @vitest-environment node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');

type CompactionPreparation = {
  firstKeptEntryId: string;
  messagesToSummarize: Array<{ role: string }>;
  turnPrefixMessages: Array<{ role: string }>;
  isSplitTurn: boolean;
};

function messageEntry(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  text: string,
  timestamp: number,
) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role,
      content: [{ type: 'text', text }],
      timestamp,
      api: 'openai-completions',
      provider: 'test',
      model: 'test',
    },
  };
}

describe('OpenClaw no-retained-tail compaction', () => {
  it('accepts keepRecentTokens=0 in OpenClaw configuration', async () => {
    const schemaPath = path.join(dist, 'zod-schema-BVpLKnmq.mjs');
    const { t: OpenClawSchema } = await import(pathToFileURL(schemaPath).href) as {
      t: { safeParse: (value: unknown) => { success: boolean } };
    };

    expect(OpenClawSchema.safeParse({
      agents: { defaults: { compaction: { keepRecentTokens: 0 } }, entries: { main: {} } },
    }).success).toBe(true);
    // Negative budgets remain invalid.
    expect(OpenClawSchema.safeParse({
      agents: { defaults: { compaction: { keepRecentTokens: -1 } }, entries: { main: {} } },
    }).success).toBe(false);
  });

  it('applies keepRecentTokens=0 to the runtime settings manager', async () => {
    const settingsPath = path.join(dist, 'agent-settings-CZ8x5-4D.mjs');
    const { r: applyAgentCompactionSettingsFromConfig } = await import(
      pathToFileURL(settingsPath).href
    ) as {
      r: (params: Record<string, unknown>) => void;
    };
    let appliedOverrides: unknown;

    applyAgentCompactionSettingsFromConfig({
      settingsManager: {
        getCompactionReserveTokens: () => 16_384,
        getCompactionKeepRecentTokens: () => 20_000,
        applyOverrides: (overrides: unknown) => {
          appliedOverrides = overrides;
        },
      },
      cfg: {
        agents: {
          defaults: {
            compaction: {
              reserveTokensFloor: 0,
              keepRecentTokens: 0,
            },
          },
        },
      },
      contextTokenBudget: 272_000,
    });

    expect(appliedOverrides).toMatchObject({ compaction: { keepRecentTokens: 0 } });
  });

  it('summarizes the entire completed turn when keepRecentTokens is zero', async () => {
    const corePath = path.join(dist, 'agent-core-B94tJ7dr.mjs');
    const { b: prepareCompaction } = await import(pathToFileURL(corePath).href) as {
      b: (
        entries: Array<Record<string, unknown>>,
        settings: { enabled: boolean; reserveTokens: number; keepRecentTokens: number },
      ) => { ok: boolean; value?: CompactionPreparation };
    };
    const entries = [
      messageEntry('user-entry', null, 'user', 'U'.repeat(60_000), 1),
      messageEntry('assistant-entry', 'user-entry', 'assistant', 'ack', 2),
    ];

    const result = prepareCompaction(entries, {
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      firstKeptEntryId: 'assistant-entry',
      isSplitTurn: false,
      turnPrefixMessages: [],
    });
    expect(result.value?.messagesToSummarize.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

});
