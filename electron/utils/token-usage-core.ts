export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export function extractSessionIdFromTranscriptFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.jsonl') && !fileName.includes('.jsonl.reset.')) return undefined;
  return fileName
    .replace(/\.jsonl\.reset\..+$/, '')
    .replace(/\.deleted\.jsonl$/, '')
    .replace(/\.jsonl$/, '');
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
    details?: {
      provider?: string;
      model?: string;
      usage?: TranscriptUsageShape;
      content?: unknown;
      externalContent?: {
        provider?: string;
      };
    };
  };
}

function normalizeUsageContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const chunks = value
      .map((item) => normalizeUsageContent(item))
      .filter((item): item is string => Boolean(item));
    if (chunks.length === 0) return undefined;
    return chunks.join('\n\n');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      const trimmed = record.text.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof record.content === 'string') {
      const trimmed = record.content.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (Array.isArray(record.content)) {
      return normalizeUsageContent(record.content);
    }
    if (typeof record.thinking === 'string') {
      const trimmed = record.thinking.trim();
      if (trimmed.length > 0) return trimmed;
    }
    try {
      return JSON.stringify(record, null, 2);
    } catch {
      return undefined;
    }
  }

  return undefined;
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
    if (!message || !parsed.timestamp) {
      continue;
    }

    if (message.role === 'assistant' && message.usage) {
      const usage = message.usage;
      const inputTokens = usage.input ?? usage.promptTokens ?? 0;
      const outputTokens = usage.output ?? usage.completionTokens ?? 0;
      const cacheReadTokens = usage.cacheRead ?? 0;
      const cacheWriteTokens = usage.cacheWrite ?? 0;
      const totalTokens = usage.total ?? usage.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

      if (totalTokens <= 0) {
        continue;
      }

      const contentText = normalizeUsageContent((message as Record<string, unknown>).content);
      entries.push({
        timestamp: parsed.timestamp,
        sessionId: context.sessionId,
        agentId: context.agentId,
        model: message.model ?? message.modelRef,
        provider: message.provider,
        ...(contentText ? { content: contentText } : {}),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        costUsd: usage.cost?.total,
      });
      continue;
    }

    if (message.role !== 'toolResult') {
      continue;
    }

    const details = message.details;
    if (!details) {
      continue;
    }

    const usage = details.usage;
    const inputTokens = usage?.input ?? usage?.promptTokens ?? 0;
    const outputTokens = usage?.output ?? usage?.completionTokens ?? 0;
    const cacheReadTokens = usage?.cacheRead ?? 0;
    const cacheWriteTokens = usage?.cacheWrite ?? 0;
    const totalTokens = usage?.total ?? usage?.totalTokens ?? inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    const provider = details.provider ?? details.externalContent?.provider ?? message.provider;
    const model = details.model ?? message.model ?? message.modelRef;
    const contentText = normalizeUsageContent(details.content)
      ?? normalizeUsageContent((message as Record<string, unknown>).content);

    if (!provider && !model) {
      continue;
    }

    if (totalTokens <= 0) {
      continue;
    }

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model,
      provider,
      ...(contentText ? { content: contentText } : {}),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costUsd: usage?.cost?.total,
    });
  }

  return entries;
}
