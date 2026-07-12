import { createHash } from 'node:crypto';
import type { TokenUsageHistoryEntry } from '../utils/token-usage-core';
import type { RuntimeKind, RuntimeUsageRecord } from './types';

type RuntimeUsageIdentity = {
  runtimeKind: RuntimeKind;
  logicalSessionId?: string;
  runtimeSessionId?: string;
  providerAccountId?: string;
  provider?: string;
  model?: string;
};

export function runtimeUsageLimit(payload: unknown): number | undefined {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { limit?: unknown }).limit
    : payload;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(Math.floor(value), 1);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(Math.floor(parsed), 1);
  }
  return undefined;
}

export function toRuntimeUsageRecords(
  entries: TokenUsageHistoryEntry[],
  identity: RuntimeUsageIdentity,
): RuntimeUsageRecord[] {
  return entries.map((entry) => {
    const logicalSessionId = identity.logicalSessionId ?? entry.sessionId;
    const runtimeSessionId = identity.runtimeSessionId ?? entry.sessionId;
    const fallbackTurnId = createHash('sha256')
      .update(JSON.stringify([
        runtimeSessionId,
        entry.timestamp,
        entry.provider,
        entry.model,
        entry.content,
        entry.inputTokens,
        entry.outputTokens,
        entry.totalTokens,
      ]))
      .digest('hex')
      .slice(0, 20);
    const turnId = entry.turnId ?? `${runtimeSessionId}:${fallbackTurnId}`;
    return {
      id: `${identity.runtimeKind}:${runtimeSessionId}:${turnId}`,
      runtimeKind: identity.runtimeKind,
      logicalSessionId,
      runtimeSessionId,
      turnId,
      agentId: entry.agentId,
      ...(identity.providerAccountId ? { providerAccountId: identity.providerAccountId } : {}),
      provider: entry.provider ?? identity.provider ?? 'unknown',
      model: entry.model ?? identity.model ?? 'unknown',
      timestamp: entry.timestamp,
      status: entry.usageStatus,
      inputTokens: entry.inputTokens,
      cachedInputTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      outputTokens: entry.outputTokens,
      reasoningTokens: entry.reasoningTokens ?? 0,
      totalTokens: entry.totalTokens,
      ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
      ...(entry.content ? { content: entry.content } : {}),
    };
  });
}

export function toTokenUsageHistoryEntry(record: RuntimeUsageRecord): TokenUsageHistoryEntry {
  return {
    runtimeKind: record.runtimeKind,
    timestamp: record.timestamp,
    sessionId: record.logicalSessionId,
    runtimeSessionId: record.runtimeSessionId,
    turnId: record.turnId,
    agentId: record.agentId,
    ...(record.providerAccountId ? { providerAccountId: record.providerAccountId } : {}),
    model: record.model,
    provider: record.provider,
    ...(record.content ? { content: record.content } : {}),
    usageStatus: record.status,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cachedInputTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    ...(record.reasoningTokens > 0 ? { reasoningTokens: record.reasoningTokens } : {}),
    totalTokens: record.totalTokens,
    ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
  };
}
