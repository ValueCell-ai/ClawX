// @vitest-environment node
import { readFile } from 'node:fs/promises';
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

describe('OpenClaw no-retained-tail compaction patch', () => {
  it('accepts keepRecentTokens=0 in OpenClaw configuration', async () => {
    const schemaPath = path.join(dist, 'zod-schema-O9ml_nmo.js');
    const { t: OpenClawSchema } = await import(pathToFileURL(schemaPath).href) as {
      t: { safeParse: (value: unknown) => { success: boolean } };
    };

    expect(OpenClawSchema.safeParse({
      agents: { defaults: { compaction: { keepRecentTokens: 0 } } },
    }).success).toBe(true);
  });

  it('applies keepRecentTokens=0 to the runtime settings manager', async () => {
    const settingsPath = path.join(dist, 'agent-settings-axYuScuh.js');
    const { r: applyAgentCompactionSettingsFromConfig } = await import(
      pathToFileURL(settingsPath).href
    ) as {
      r: (params: Record<string, unknown>) => {
        compaction: { keepRecentTokens: number };
      };
    };
    let appliedOverrides: unknown;

    const result = applyAgentCompactionSettingsFromConfig({
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

    expect(result.compaction.keepRecentTokens).toBe(0);
    expect(appliedOverrides).toEqual({ compaction: { keepRecentTokens: 0 } });
  });

  it('summarizes the entire completed turn when keepRecentTokens is zero', async () => {
    const corePath = path.join(dist, 'proxy-BzhBz8iM.js');
    const { j: prepareCompaction } = await import(pathToFileURL(corePath).href) as {
      j: (
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

  it('hardens automatic compaction boundaries when retained history is disabled', async () => {
    const source = await readFile(path.join(dist, 'compact-DLB4d8IL.js'), 'utf8');

    expect(source).toContain(
      'const configuredKeepRecentTokens = params.config?.agents?.defaults?.compaction?.keepRecentTokens',
    );
    expect(source).toContain(
      'params.trigger === "manual" || configuredKeepRecentTokens === 0',
    );
    expect(source).toContain('configuredKeepRecentTokens > 0');
  });

  it('continues already-capped mid-turn tool progress without compaction or retry exhaustion', async () => {
    const selectionSource = await readFile(path.join(dist, 'selection-JInn13lc.js'), 'utf8');
    const embeddedAgentSource = await readFile(
      path.join(dist, 'embedded-agent-DGUuxGR2.js'),
      'utf8',
    );
    const handlerStart = selectionSource.indexOf('const handleMidTurnPrecheckRequest = (request) =>');
    const handlerEnd = selectionSource.indexOf('let skipPromptSubmission = false', handlerStart);
    const handlerSource = selectionSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain(
      'truncationResult.reason === "no oversized or aggregate tool results"',
    );
    expect(handlerSource).toContain('route: "truncate_tool_results_only"');
    expect(handlerSource).toContain('handled: true');
    expect(handlerSource).toContain('truncatedCount: 0');
    expect(handlerSource).toContain('truncateSkippedReason=${truncationResult.reason}');
    expect(embeddedAgentSource).toContain(
      'const isProgressContinuation = retryingFromTranscript && preflightRecovery.route === "truncate_tool_results_only" && preflightRecovery.truncatedCount === 0',
    );
    expect(embeddedAgentSource).toContain(
      'if (isProgressContinuation) runLoopIterations = Math.max(0, runLoopIterations - 1)',
    );
    expect(embeddedAgentSource.indexOf('const retryingFromTranscript =')).toBeLessThan(
      embeddedAgentSource.indexOf('const isProgressContinuation ='),
    );
  });
});
