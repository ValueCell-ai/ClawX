import type { ChatSession, GatewaySessionsChangedPayload } from './types';
import { parseCronSessionKey } from './cron-session-utils';
import { shouldIncludeSessionInSidebarList } from './session-key-utils';

export type { GatewaySessionsChangedPayload } from './types';

export type NormalizedSessionPatch = {
  key: string;
  values: Partial<ChatSession>;
  present: ReadonlySet<keyof ChatSession>;
  cleared: ReadonlySet<keyof ChatSession>;
};

type SessionField = Exclude<keyof ChatSession, 'key' | 'createdLocally'>;

const STRING_FIELDS = [
  'sessionId',
  'label',
  'displayName',
  'derivedTitle',
  'lastMessagePreview',
  'thinkingLevel',
  'model',
  'workspacePath',
] as const satisfies readonly SessionField[];

function hasOwn(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function normalizeSessionKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseUpdatedAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseStatus(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeGatewaySessionPatch(raw: Record<string, unknown>): NormalizedSessionPatch {
  const key = normalizeSessionKey(raw.key);
  const values: Partial<ChatSession> = { key };
  const present = new Set<keyof ChatSession>(['key']);
  const cleared = new Set<keyof ChatSession>();

  for (const field of STRING_FIELDS) {
    if (!hasOwn(raw, field)) continue;
    present.add(field);
    const value = raw[field];
    if (value === null) {
      cleared.add(field);
    } else if (typeof value === 'string' && value) {
      values[field] = value;
    }
  }

  if (hasOwn(raw, 'updatedAt')) {
    present.add('updatedAt');
    if (raw.updatedAt === null) {
      cleared.add('updatedAt');
    } else {
      const updatedAt = parseUpdatedAt(raw.updatedAt);
      if (updatedAt !== undefined) values.updatedAt = updatedAt;
    }
  }

  if (hasOwn(raw, 'status')) {
    present.add('status');
    if (raw.status === null) {
      cleared.add('status');
    } else {
      const status = parseStatus(raw.status);
      if (status !== undefined) values.status = status;
    }
  }

  if (hasOwn(raw, 'hasActiveRun')) {
    present.add('hasActiveRun');
    if (raw.hasActiveRun === null) {
      cleared.add('hasActiveRun');
    } else if (typeof raw.hasActiveRun === 'boolean') {
      values.hasActiveRun = raw.hasActiveRun;
    }
  }

  const channelField = hasOwn(raw, 'lastChannel')
    ? 'lastChannel'
    : hasOwn(raw, 'channel') ? 'channel' : null;
  if (channelField) {
    present.add('channel');
    const channel = raw[channelField];
    if (channel === null) {
      cleared.add('channel');
    } else if (typeof channel === 'string' && channel) {
      values.channel = channel;
    }
  }

  return { key, values, present, cleared };
}

export function normalizeGatewaySessionRow(raw: Record<string, unknown>): ChatSession {
  const patch = normalizeGatewaySessionPatch(raw);
  const row = { ...patch.values } as ChatSession;
  for (const field of patch.cleared) {
    delete row[field];
  }
  return row;
}

export function applyGatewaySessionsChanged(
  sessions: ChatSession[],
  payload: GatewaySessionsChangedPayload,
  latestEventTsByKey: Map<string, number>,
): {
  sessions: ChatSession[];
  applied: boolean;
  deletedKey?: string;
  requiresReload: boolean;
} {
  const envelopeKey = normalizeSessionKey(payload.sessionKey) || normalizeSessionKey(payload.key);
  const nested = isRecord(payload.session) ? payload.session : null;
  const nestedKey = nested ? normalizeSessionKey(nested.key) : '';

  if (envelopeKey && nestedKey && envelopeKey !== nestedKey) {
    return { sessions, applied: false, requiresReload: true };
  }

  const key = nestedKey || envelopeKey;
  if (!key) {
    return { sessions, applied: false, requiresReload: true };
  }

  const cron = parseCronSessionKey(key);
  if (cron?.runSessionId) {
    return { sessions, applied: false, requiresReload: false };
  }

  const eventTs = typeof payload.ts === 'number' && Number.isFinite(payload.ts)
    ? payload.ts
    : undefined;
  const latestTs = latestEventTsByKey.get(key);
  if (eventTs !== undefined && latestTs !== undefined && eventTs < latestTs) {
    return { sessions, applied: false, requiresReload: false };
  }

  if (payload.reason === 'delete') {
    if (!envelopeKey) return { sessions, applied: false, requiresReload: true };
    if (eventTs !== undefined) latestEventTsByKey.set(key, eventTs);
    return {
      sessions: sessions.filter((session) => session.key !== envelopeKey),
      applied: true,
      deletedKey: envelopeKey,
      requiresReload: false,
    };
  }

  const source = nested ?? payload;
  const patch = normalizeGatewaySessionPatch({ ...source, key });
  const index = sessions.findIndex((session) => session.key === key);
  if (index < 0) {
    if (!nested || !nestedKey) {
      return { sessions, applied: false, requiresReload: true };
    }
    const inserted = normalizeGatewaySessionRow({ ...nested, key });
    if (!shouldIncludeSessionInSidebarList(inserted)) {
      return { sessions, applied: false, requiresReload: false };
    }
    if (eventTs !== undefined) latestEventTsByKey.set(key, eventTs);
    return { sessions: [...sessions, inserted], applied: true, requiresReload: false };
  }

  const merged: ChatSession = { ...sessions[index] };
  for (const field of patch.present) {
    if (field === 'key') continue;
    if (patch.cleared.has(field)) {
      delete merged[field];
    } else if (field in patch.values) {
      Object.assign(merged, { [field]: patch.values[field] });
    }
  }

  if (eventTs !== undefined) latestEventTsByKey.set(key, eventTs);
  const nextSessions = [...sessions];
  if (merged.createdLocally || shouldIncludeSessionInSidebarList(merged)) {
    nextSessions[index] = merged;
  } else {
    nextSessions.splice(index, 1);
  }
  return {
    sessions: nextSessions,
    applied: true,
    requiresReload: nested === null,
  };
}
