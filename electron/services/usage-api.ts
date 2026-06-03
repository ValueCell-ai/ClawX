import { getRecentTokenUsageHistory } from '../utils/token-usage';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
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

export function createUsageApi(): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => getRecentTokenUsageHistory(getSafeLimit(payload)),
  };
}
