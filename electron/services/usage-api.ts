import { getRecentTokenUsageHistory } from '../utils/token-usage';
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

export async function getRecentTokenHistoryForRuntime(
  payload?: unknown,
  runtimeManager?: RuntimeManager,
) {
  const limit = getSafeLimit(payload);
  const runtimeKind = getExplicitRuntimeKind(payload) ?? getActiveRuntimeKind(runtimeManager);
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
