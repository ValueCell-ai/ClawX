export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus: 'available' | 'missing' | 'error';
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
    .replace(/\.reset\..+$/, '')
    .replace(/\.deleted\.jsonl$/, '')
    .replace(/\.jsonl$/, '');
}

interface TranscriptUsageShape {
  [key: string]: unknown;
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  inputTokenCount?: number;
  input_token_count?: number;
  outputTokenCount?: number;
  output_token_count?: number;
  promptTokenCount?: number;
  prompt_token_count?: number;
  completionTokenCount?: number;
  completion_token_count?: number;
  totalTokenCount?: number;
  total_token_count?: number;
  cacheReadTokenCount?: number;
  cacheReadTokens?: number;
  cache_write_token_count?: number;
  cost?: {
    total?: number;
  };
}

type UsageRecordStatus = 'available' | 'missing' | 'error';

interface ParsedUsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
  usageStatus: UsageRecordStatus;
}

function normalizeUsageNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstUsageNumber(usage: TranscriptUsageShape | undefined, candidates: string[]): number | undefined {
  if (!usage) return undefined;
  for (const key of candidates) {
    const value = usage[key];
    const parsed = normalizeUsageNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseUsageFromShape(usage: unknown): ParsedUsageTokens | undefined {
  if (usage === undefined) {
    return undefined;
  }

  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    return {
      usageStatus: 'error',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }

  const usageShape = usage as TranscriptUsageShape;

  const inputTokens = firstUsageNumber(usageShape, [
    'input',
    'promptTokens',
    'prompt_tokens',
    'input_tokens',
    'inputTokenCount',
    'input_token_count',
    'promptTokenCount',
    'prompt_token_count',
  ]);
  const outputTokens = firstUsageNumber(usageShape, [
    'output',
    'completionTokens',
    'completion_tokens',
    'output_tokens',
    'outputTokenCount',
    'output_token_count',
    'completionTokenCount',
    'completion_token_count',
  ]);
  const cacheReadTokens = firstUsageNumber(usageShape, [
    'cacheRead',
    'cache_read',
    'cacheReadTokens',
    'cache_read_tokens',
    'cacheReadTokenCount',
    'cache_read_token_count',
  ]);
  const cacheWriteTokens = firstUsageNumber(usageShape, [
    'cacheWrite',
    'cache_write',
    'cacheWriteTokens',
    'cache_write_tokens',
    'cacheWriteTokenCount',
    'cache_write_token_count',
  ]);
  const explicitTotalTokens = firstUsageNumber(usageShape, [
    'total',
    'totalTokens',
    'total_tokens',
    'totalTokenCount',
    'total_token_count',
  ]);

  const hasUsageValue =
    inputTokens !== undefined
    || outputTokens !== undefined
    || cacheReadTokens !== undefined
    || cacheWriteTokens !== undefined
    || explicitTotalTokens !== undefined
    || normalizeUsageNumber(usageShape.cost?.total) !== undefined;

  if (!hasUsageValue) {
    return {
      usageStatus: 'missing',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }

  const totalTokens = explicitTotalTokens ?? (
    (inputTokens ?? 0)
      + (outputTokens ?? 0)
      + (cacheReadTokens ?? 0)
      + (cacheWriteTokens ?? 0)
  );

  return {
    usageStatus: 'available',
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    totalTokens,
    costUsd: normalizeUsageNumber(usageShape.cost?.total),
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

    if (message.role === 'assistant' && 'usage' in message) {
      const usage = parseUsageFromShape(message.usage);
      if (!usage) continue;

      const contentText = normalizeUsageContent((message as Record<string, unknown>).content);
      entries.push({
        timestamp: parsed.timestamp,
        sessionId: context.sessionId,
        agentId: context.agentId,
        model: message.model ?? message.modelRef,
        provider: message.provider,
        ...(contentText ? { content: contentText } : {}),
        ...usage,
      });
      continue;
    }

    if (message.role !== 'toolResult') {
      continue;
    }

    const details = message.details;
    if (!details || !('usage' in details)) {
      continue;
    }

    const usage = parseUsageFromShape(details.usage);
    if (!usage) continue;

    const provider = details.provider ?? details.externalContent?.provider ?? message.provider;
    const model = details.model ?? message.model ?? message.modelRef;
    const contentText = normalizeUsageContent(details.content)
      ?? normalizeUsageContent((message as Record<string, unknown>).content);

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model,
      provider,
      ...(contentText ? { content: contentText } : {}),
      ...usage,
    });
  }

  return entries;
}
