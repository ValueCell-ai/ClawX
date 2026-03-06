export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
}

interface TranscriptUsageShape {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: {
    total?: number;
  };
}

interface TranscriptLineShape {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    modelRef?: string;
    provider?: string;
    usage?: TranscriptUsageShape;
  };
}

export function parseUsageEntriesFromJsonl(
  content: string,
  context: { sessionId: string; agentId: string },
  limit?: number,
): TokenUsageHistoryEntry[] {
  const entries: TokenUsageHistoryEntry[] = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (let i = lines.length - 1; i >= 0 && entries.length < maxEntries; i -= 1) {
    let parsed: TranscriptLineShape;
    try {
      parsed = JSON.parse(lines[i]) as TranscriptLineShape;
    } catch {
      continue;
    }

    const message = parsed.message;
    if (!message || message.role !== 'assistant' || !message.usage || !parsed.timestamp) {
      continue;
    }

    const usage = message.usage;
    const inputTokens = usage.input ?? usage.promptTokens ?? 0;
    const outputTokens = usage.output ?? usage.completionTokens ?? 0;
    const cacheReadTokens = usage.cacheRead ?? 0;
    const cacheWriteTokens = usage.cacheWrite ?? 0;
    const totalTokens = usage.total ?? usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    if (totalTokens <= 0 && !usage.cost?.total) {
      continue;
    }

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model: message.model ?? message.modelRef,
      provider: message.provider,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costUsd: usage.cost?.total,
    });
  }

  return entries;
}
