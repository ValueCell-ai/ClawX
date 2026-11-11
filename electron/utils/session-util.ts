/**
 * Shared session utilities
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { readSqliteSessionEntriesForAgent } from './openclaw-transcript-sqlite';
import { toOpenClawChannelType } from './channel-alias';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

/** Read 2026.10.10's canonical delivery state, or a pre-migration session. */
export function getSessionDeliveryMetadata(session: JsonRecord): {
  channel?: string;
  accountId?: string;
  to?: string;
  label?: string;
  chatType?: string;
} {
  const hasCanonicalDelivery = Object.hasOwn(session, 'delivery');
  const delivery = asRecord(session.delivery);
  // Explicit none/internal (or malformed) state must not revive stale routes.
  if (hasCanonicalDelivery && delivery?.kind !== 'external') return {};
  const context = asRecord(hasCanonicalDelivery ? delivery?.context : session.deliveryContext);
  const origin = asRecord(hasCanonicalDelivery ? delivery?.origin : session.origin);
  const legacy = hasCanonicalDelivery ? {} : session;
  return {
    channel: nonEmptyString(context?.channel) || nonEmptyString(legacy.lastChannel)
      || nonEmptyString(legacy.channel) || nonEmptyString(origin?.provider) || nonEmptyString(origin?.surface),
    accountId: nonEmptyString(context?.accountId) || nonEmptyString(legacy.lastAccountId) || nonEmptyString(origin?.accountId),
    to: nonEmptyString(context?.to) || nonEmptyString(legacy.lastTo) || nonEmptyString(origin?.to),
    label: nonEmptyString(origin?.label),
    chatType: nonEmptyString(session.chatType) || nonEmptyString(origin?.chatType),
  };
}

/** A readable SQLite index, including an empty one, supersedes legacy JSON. */
export async function readAgentSessionRecords(agentId: string): Promise<JsonRecord[]> {
  const sqliteEntries = await readSqliteSessionEntriesForAgent(agentId);
  if (sqliteEntries !== null) return sqliteEntries.map(({ entry }) => entry);
  try {
    const raw = await readFile(join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json'), 'utf8');
    const parsed = asRecord(JSON.parse(raw));
    return parsed ? extractSessionRecords(parsed) : [];
  } catch {
    return [];
  }
}

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
 * Searches all agent session directories for matching persisted delivery metadata.
 */
export async function resolveAccountIdFromSessionHistory(
  toAddress: string,
  channelType: string,
): Promise<string | null> {
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  let agentDirs: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    agentDirs = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;

    for (const session of await readAgentSessionRecords(entry.name)) {
      const delivery = getSessionDeliveryMetadata(session);
      if (delivery.to === toAddress && delivery.channel
        && toOpenClawChannelType(delivery.channel) === toOpenClawChannelType(channelType)
        && delivery.accountId) return delivery.accountId;
    }
  }

  return null;
}
