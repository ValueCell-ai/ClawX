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
  cachedInputTokens?: number;
  cached_input_tokens?: number;
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
    'cachedInputTokens',
    'cached_input_tokens',
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
  payload?: {
    type?: string;
    info?: {
      last_token_usage?: TranscriptUsageShape;
      total_token_usage?: TranscriptUsageShape;
    };
  };
}

type UsageMessageShape = NonNullable<TranscriptLineShape['message']> & {
  timestamp?: string | number;
  created_at?: string | number;
  createdAt?: string | number;
  content?: unknown;
};

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

function normalizeUsageTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return undefined;
}

function usageEntryFromMessage(
  message: UsageMessageShape | undefined,
  timestamp: string | undefined,
  context: { sessionId: string; agentId: string },
): TokenUsageHistoryEntry | null {
  if (!message || !timestamp) return null;

  if (message.role === 'assistant' && 'usage' in message) {
    const usage = parseUsageFromShape(message.usage);
    if (!usage) return null;

    const contentText = normalizeUsageContent((message as Record<string, unknown>).content);
    return {
      timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model: message.model ?? message.modelRef,
      provider: message.provider,
      ...(contentText ? { content: contentText } : {}),
      ...usage,
    };
  }

  if (message.role !== 'toolResult' && message.role !== 'toolresult') {
    return null;
  }

  const details = message.details;
  if (!details || !('usage' in details)) {
    return null;
  }

  const usage = parseUsageFromShape(details.usage);
  if (!usage) return null;

  const provider = details.provider ?? details.externalContent?.provider ?? message.provider;
  const model = details.model ?? message.model ?? message.modelRef;
  const contentText = normalizeUsageContent(details.content)
    ?? normalizeUsageContent((message as Record<string, unknown>).content);

  return {
    timestamp,
    sessionId: context.sessionId,
    agentId: context.agentId,
    model,
    provider,
    ...(contentText ? { content: contentText } : {}),
    ...usage,
  };
}

function usageEntryFromCodexTokenCount(
  record: TranscriptLineShape,
  timestamp: string | undefined,
  context: { sessionId: string; agentId: string },
): TokenUsageHistoryEntry | null {
  if (!timestamp || record.type !== 'event_msg' || record.payload?.type !== 'token_count') {
    return null;
  }

  const usage = parseUsageFromShape(record.payload.info?.last_token_usage ?? record.payload.info?.total_token_usage);
  if (!usage || usage.usageStatus !== 'available') {
    return null;
  }

  return {
    timestamp,
    sessionId: context.sessionId,
    agentId: context.agentId,
    provider: 'codex',
    ...usage,
  };
}

export function parseUsageEntriesFromMessages(
  messages: unknown[],
  context: { sessionId: string; agentId: string },
  limit?: number,
): TokenUsageHistoryEntry[] {
  const entries: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (let i = messages.length - 1; i >= 0 && entries.length < maxEntries; i -= 1) {
    const item = messages[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const message = item as UsageMessageShape;
    const timestamp = normalizeUsageTimestamp(message.timestamp ?? message.created_at ?? message.createdAt);
    const entry = usageEntryFromMessage(message, timestamp, context);
    if (entry) entries.push(entry);
  }

  return entries;
}

function fromCcConnectBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) {
    const [, scope = 'main', user = 'main'] = sessionKey.split(':');
    return `agent:${scope || 'main'}:${user || 'main'}`;
  }
  return sessionKey;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    typeof item === 'string' ? [[key, item]] : []
  )));
}

export function parseUsageEntriesFromCcConnectSessionStore(
  content: string,
  fallback: { sessionId: string; agentId: string },
  limit?: number,
): TokenUsageHistoryEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  const sessions = record.sessions;
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return [];

  const activeSessionById = new Map<string, string>();
  for (const [key, sessionId] of Object.entries(readStringMap(record.active_session))) {
    if (!activeSessionById.has(sessionId)) {
      activeSessionById.set(sessionId, fromCcConnectBridgeSessionKey(key));
    }
  }

  const entries: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const [storeSessionId, session] of Object.entries(sessions)) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) continue;
    const sessionRecord = session as Record<string, unknown>;
    const history = Array.isArray(sessionRecord.history) ? sessionRecord.history : [];
    const sessionId = activeSessionById.get(storeSessionId) ?? String(sessionRecord.id || storeSessionId || fallback.sessionId);
    const agentId = sessionId.startsWith('agent:')
      ? sessionId.split(':')[1] || fallback.agentId
      : fallback.agentId;
    entries.push(...parseUsageEntriesFromMessages(history, {
      sessionId,
      agentId,
    }));
  }

  entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? entries.slice(0, maxEntries) : entries;
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

    const timestamp = normalizeUsageTimestamp(parsed.timestamp);
    const entry = usageEntryFromMessage(parsed.message, timestamp, context)
      ?? usageEntryFromCodexTokenCount(parsed, timestamp, context);
    if (entry) entries.push(entry);
  }

  return entries;
}
