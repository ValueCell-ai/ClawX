// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldPreemptivelyCompactBeforePrompt } from 'openclaw/plugin-sdk/agent-harness-runtime';

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
  it('derives an aggregate tool-result target from the measured prompt overflow', () => {
    const resultSizes = [3569, 19623, 22020, 21930, 5341, 13078, 13066, 8297, 11613, 7459, 5194];
    const messages = resultSizes.map((length, index) => ({
      role: 'toolResult',
      toolCallId: `call-${index}`,
      toolName: 'web_fetch',
      content: [{ type: 'text', text: 'x'.repeat(length) }],
      isError: false,
      timestamp: index,
    }));

    const result = shouldPreemptivelyCompactBeforePrompt({
      messages: messages as never,
      prompt: '',
      contextTokenBudget: 128_000,
      reserveTokens: 50_000,
      toolResultMaxChars: 32_000,
      llmBoundaryTokenPressure: {
        estimatedPromptTokens: 92_662,
        source: 'field-reproduction',
      },
    });

    expect(result).toMatchObject({
      route: 'truncate_tool_results_only',
      overflowTokens: 14_662,
      pressureSource: 'field-reproduction',
    });
    expect(result.toolResultReducibleChars).toBeGreaterThan(0);
    expect(result.toolResultAggregateTargetChars).toBe(43_218);
    expect(result.toolResultAggregateTargetChars).toBeLessThan(
      resultSizes.reduce((sum, length) => sum + length, 0),
    );
  });

  it('bounds a protected trailing tool-result batch without removing its entries', async () => {
    const resultSizes = [3569, 19623, 22020, 21930, 5341, 13078, 13066, 8297, 11613, 7459, 5194];
    const branch = [{
      type: 'message',
      id: 'assistant-entry',
      parentId: null,
      message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
    }, ...resultSizes.map((length, index) => ({
      type: 'message',
      id: `result-${index}`,
      parentId: index === 0 ? 'assistant-entry' : `result-${index - 1}`,
      message: {
        role: 'toolResult',
        toolCallId: `call-${index}`,
        toolName: 'web_fetch',
        content: [{ type: 'text', text: 'x'.repeat(length) }],
        isError: false,
      },
    }))];
    const rewrittenMessages: Array<{ role: string; toolCallId?: string; content: Array<{ text: string }> }> = [];
    const truncationPath = path.join(dist, 'tool-result-truncation-rzMcqvvu.js');
    const { u: truncateOversizedToolResultsInSessionManager } = await import(
      pathToFileURL(truncationPath).href
    ) as {
      u: (params: Record<string, unknown>) => { truncated: boolean; truncatedCount: number };
    };

    const result = truncateOversizedToolResultsInSessionManager({
      sessionManager: {
        getBranch: () => branch,
        branch: () => undefined,
        resetLeaf: () => undefined,
        appendMessage: (message: typeof rewrittenMessages[number]) => {
          rewrittenMessages.push(message);
          return `rewritten-${rewrittenMessages.length}`;
        },
      },
      contextWindowTokens: 128_000,
      maxCharsOverride: 32_000,
      aggregateMaxCharsOverride: 43_218,
      protectTrailingToolResults: true,
    });

    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(rewrittenMessages.map((message) => message.toolCallId)).toEqual(
      resultSizes.map((_length, index) => `call-${index}`),
    );
    expect(rewrittenMessages.every((message) => message.content[0]?.text.length > 0)).toBe(true);
    expect(rewrittenMessages.reduce(
      (total, message) => total + (message.content[0]?.text.length ?? 0),
      0,
    )).toBeLessThanOrEqual(43_218);
  });

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

  it('carries pressure targets into truncation before resetting no-real-conversation state', async () => {
    const selectionSource = await readFile(path.join(dist, 'selection-JInn13lc.js'), 'utf8');
    const embeddedAgentSource = await readFile(
      path.join(dist, 'embedded-agent-DGUuxGR2.js'),
      'utf8',
    );
    const noRealStart = embeddedAgentSource.indexOf(
      'if (preflightRecovery && isNoRealConversationCompactionNoop(compactResult))',
    );
    const noRealEnd = embeddedAgentSource.indexOf(
      '\n\t\t\t\t\t\t\tif (compactResult.compacted)',
      noRealStart,
    );
    const noRealSource = embeddedAgentSource.slice(noRealStart, noRealEnd);

    expect(selectionSource).toContain(
      'toolResultAggregateTargetChars: result.toolResultAggregateTargetChars',
    );
    expect(selectionSource).toContain(
      'aggregateMaxCharsOverride: request.toolResultAggregateTargetChars',
    );
    expect(selectionSource).toContain(
      'aggregateMaxCharsOverride: preemptiveCompaction.toolResultAggregateTargetChars',
    );
    expect(noRealSource).toContain('truncateOversizedToolResultsInSession({');
    expect(noRealSource).toContain(
      'aggregateMaxCharsOverride: preflightRecovery.toolResultAggregateTargetChars',
    );
    expect(noRealSource).toContain('protectTrailingToolResults: true');
    expect(noRealSource.indexOf('truncationResult.truncated')).toBeLessThan(
      noRealSource.indexOf('resetNoRealConversationTokenSnapshot({'),
    );
  });
});
