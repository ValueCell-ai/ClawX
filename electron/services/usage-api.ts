import { getRecentTokenUsageHistory } from '../utils/token-usage';
import { parseUsageEntriesFromMessages, type TokenUsageHistoryEntry } from '../utils/token-usage-core';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RuntimeManager } from '../runtime/manager';
import type { RuntimeKind } from '@shared/types/gateway';
import { isRecord } from './payload-utils';

type RecentTokenHistoryPayload = {
  limit?: unknown;
  runtimeKind?: unknown;
};

function getSafeLimit(payload: unknown): number | undefined {
  const value = isRecord(payload) ? (payload as RecentTokenHistoryPayload).limit : payload;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(Math.floor(value), 1);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(Math.floor(parsed), 1);
    }
  }
  return undefined;
}

function getExplicitRuntimeKind(payload: unknown): RuntimeKind | undefined {
  return isRecord(payload) && (payload.runtimeKind === 'openclaw' || payload.runtimeKind === 'cc-connect')
    ? payload.runtimeKind
    : undefined;
}

function getActiveRuntimeKind(runtimeManager?: RuntimeManager): RuntimeKind | undefined {
  return runtimeManager?.getActiveProvider().kind;
}

async function getCcConnectTokenHistory(
  limit: number | undefined,
  runtimeManager: RuntimeManager | undefined,
): Promise<TokenUsageHistoryEntry[]> {
  const provider = runtimeManager?.getActiveProvider();
  if (!provider || provider.kind !== 'cc-connect') return [];
  const sessionResult = await provider.listSessions();
  const sessions = sessionResult.sessions ?? [];
  const entries = (await Promise.all(sessions.map(async (session) => {
    const history = await provider.loadHistory({ sessionKey: session.key, limit: 1000 });
    const messages = (history.messages ?? []).map((message) => {
      if (message.role !== 'assistant' || 'usage' in message) return message;
      return { ...message, usage: {} };
    });
    return parseUsageEntriesFromMessages(messages, {
      runtimeKind: 'cc-connect',
      sessionId: session.key,
      agentId: session.agentId || session.key.split(':')[1] || 'main',
    });
  }))).flat();
  entries.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return entries.slice(0, limit ?? entries.length);
}

export async function getRecentTokenHistoryForRuntime(
  payload?: unknown,
  runtimeManager?: RuntimeManager,
) {
  const limit = getSafeLimit(payload);
  const runtimeKind = getExplicitRuntimeKind(payload) ?? getActiveRuntimeKind(runtimeManager);
  if (runtimeKind === 'cc-connect') {
    return getCcConnectTokenHistory(limit, runtimeManager);
  }
  return getRecentTokenUsageHistory({
    ...(limit !== undefined ? { limit } : {}),
    ...(runtimeKind ? { runtimeKind } : {}),
  });
}

export function createUsageApi(runtimeManager?: RuntimeManager): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => {
      return getRecentTokenHistoryForRuntime(payload, runtimeManager);
    },
  };
}
