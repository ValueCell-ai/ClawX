import type { TokenUsageHistoryEntry } from '../utils/token-usage-core';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RuntimeManager } from '../runtime/manager';
import type { RuntimeKind } from '@shared/types/gateway';
import { isRecord } from './payload-utils';
import { toTokenUsageHistoryEntry } from '../runtime/usage';

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

async function getRuntimeTokenHistory(
  limit: number | undefined,
  runtimeKind: RuntimeKind,
  runtimeManager: RuntimeManager | undefined,
): Promise<TokenUsageHistoryEntry[]> {
  const provider = runtimeManager?.getProvider(runtimeKind);
  if (!provider) return [];
  if (runtimeKind === 'cc-connect' && provider !== runtimeManager?.getActiveProvider()) return [];
  const result = await provider.listUsage({ ...(limit !== undefined ? { limit } : {}) });
  if (!result.success) return [];
  const entries = result.records.map(toTokenUsageHistoryEntry);
  entries.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return entries.slice(0, limit ?? entries.length);
}

export async function getRecentTokenHistoryForRuntime(
  payload?: unknown,
  runtimeManager?: RuntimeManager,
) {
  const limit = getSafeLimit(payload);
  const runtimeKind = getExplicitRuntimeKind(payload) ?? getActiveRuntimeKind(runtimeManager);
  if (!runtimeKind) return [];
  return getRuntimeTokenHistory(limit, runtimeKind, runtimeManager);
}

export function createUsageApi(runtimeManager?: RuntimeManager): CompleteHostServiceRegistry['usage'] {
  return {
    recentTokenHistory: async (payload) => {
      return getRecentTokenHistoryForRuntime(payload, runtimeManager);
    },
  };
}
