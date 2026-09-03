import { getRecentTokenUsageHistory } from '../utils/token-usage';
import { parseUsageEntriesFromJsonl, type TokenUsageHistoryEntry } from '../utils/token-usage-core';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { isRecord } from './payload-utils';

type RecentTokenHistoryPayload = {
  limit?: unknown;
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

type UsageApiOptions = {
  gatewayManager?: Pick<GatewayManager, 'rpc'>;
};

async function getGatewayTokenUsageHistory(
  gatewayManager: Pick<GatewayManager, 'rpc'>,
  limit?: number,
): Promise<TokenUsageHistoryEntry[]> {
  const maxEntries = limit ?? 500;
  const listed = await gatewayManager.rpc('sessions.list', {
    limit: Math.min(Math.max(maxEntries, 50), 500),
    archived: 'all',
    sortBy: 'updatedAt',
  }) as { sessions?: unknown; rows?: unknown };
  const rows = Array.isArray(listed?.sessions)
    ? listed.sessions
    : (Array.isArray(listed?.rows) ? listed.rows : []);
  const results: TokenUsageHistoryEntry[] = [];

  for (const row of rows) {
    if (results.length >= maxEntries || !isRecord(row)) break;
    const sessionKey = typeof row.key === 'string'
      ? row.key
      : (typeof row.sessionKey === 'string' ? row.sessionKey : '');
    if (!sessionKey) continue;
    const parts = sessionKey.split(':');
    const agentId = typeof row.agentId === 'string' ? row.agentId : (parts[1] || 'main');
    const sessionId = typeof row.sessionId === 'string' ? row.sessionId : sessionKey;
    try {
      const history = await gatewayManager.rpc('chat.history', {
        sessionKey,
        limit: Math.min(Math.max(maxEntries - results.length, 50), 500),
      }) as { messages?: unknown };
      if (!Array.isArray(history?.messages)) continue;
      const jsonl = history.messages
        .filter(isRecord)
        .map((message) => JSON.stringify({
          timestamp: message.timestamp ?? message.createdAt ?? message.createdAtMs,
          message,
        }))
        .join('\n');
      results.push(...parseUsageEntriesFromJsonl(
        jsonl,
        { sessionId, agentId },
        maxEntries - results.length,
      ));
    } catch {
      // One corrupt or unavailable session must not hide usage from others.
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return results.slice(0, maxEntries);
}

export function createUsageApi(options: UsageApiOptions = {}): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => {
      const limit = getSafeLimit(payload);
      return options.gatewayManager
        ? getGatewayTokenUsageHistory(options.gatewayManager, limit)
        : getRecentTokenUsageHistory(limit);
    },
  };
}
