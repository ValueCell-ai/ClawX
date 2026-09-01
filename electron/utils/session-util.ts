/**
 * Shared session utilities
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import type { GatewayManager } from '../gateway/manager';

type JsonRecord = Record<string, unknown>;

/**
 * Parse sessions.json supporting both formats:
 * - Object-keyed: { "agent:xxx:yyy": { deliveryContext: {...} } }
 * - Array format: { sessions: [...] }
 */
export function extractSessionRecords(store: JsonRecord): JsonRecord[] {
  const directEntries = Object.entries(store)
    .filter(([key, value]) => key !== 'sessions' && value && typeof value === 'object')
    .map(([, value]) => value as JsonRecord);
  const arrayEntries = Array.isArray(store.sessions)
    ? store.sessions.filter((entry): entry is JsonRecord => Boolean(entry && typeof entry === 'object'))
    : [];
  return [...directEntries, ...arrayEntries];
}

/**
 * Find accountId from session history by "to" address and channel type.
 * Searches all agent session directories for a matching deliveryContext.
 */
export async function resolveAccountIdFromSessionHistory(
  toAddress: string,
  channelType: string,
  gatewayManager?: Pick<GatewayManager, 'rpc'>,
): Promise<string | null> {
  if (gatewayManager) {
    try {
      const result = await gatewayManager.rpc('sessions.list', {
        limit: 500,
        archived: 'all',
      }) as { sessions?: unknown; rows?: unknown };
      const rows = Array.isArray(result.sessions)
        ? result.sessions
        : (Array.isArray(result.rows) ? result.rows : []);
      for (const session of rows) {
        if (!session || typeof session !== 'object') continue;
        const deliveryContext = (session as JsonRecord).deliveryContext;
        if (!deliveryContext || typeof deliveryContext !== 'object') continue;
        const context = deliveryContext as JsonRecord;
        if (
          context.to === toAddress
          && context.channel === channelType
          && typeof context.accountId === 'string'
        ) {
          return context.accountId;
        }
      }
      return null;
    } catch {
      // Compatibility fallback for pre-8.1 file-backed runtimes.
    }
  }

  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  let agentDirs: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    agentDirs = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;

    const sessionsPath = join(agentsDir, entry.name, 'sessions', 'sessions.json');
    let raw: string;
    try {
      raw = await readFile(sessionsPath, 'utf8');
    } catch {
      continue;
    }

    if (!raw.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const session of extractSessionRecords(parsed as JsonRecord)) {
      const deliveryContext = session.deliveryContext as Record<string, unknown> | undefined;
      if (
        deliveryContext &&
        typeof deliveryContext.to === 'string' &&
        deliveryContext.to === toAddress &&
        typeof deliveryContext.channel === 'string' &&
        deliveryContext.channel === channelType
      ) {
        if (typeof deliveryContext.accountId === 'string') {
          return deliveryContext.accountId;
        }
      }
    }
  }

  return null;
}
