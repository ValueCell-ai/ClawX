import type { ChatSession } from './types';

export const LABEL_FETCH_CONCURRENCY = 5;
export const LABEL_FETCH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

type GatewayRuntimeStatus = {
  pid?: number;
  connectedAt?: number;
  port?: number;
};

type SessionLabelHydrationOutcome = 'labeled' | 'empty' | 'error' | 'backend-label';

type SessionLabelHydrationRecord = {
  version: string;
  outcome: SessionLabelHydrationOutcome;
};

const sessionLabelHydrationInFlight = new Map<string, string>();
const sessionLabelHydrationHandled = new Map<string, SessionLabelHydrationRecord>();
const sessionLabelHydrationReadyByRuntime = new Set<string>();

function normalizeLabelValue(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSessionLabelHydrationRuntimeKey(status: GatewayRuntimeStatus | undefined): string {
  return `${status?.pid ?? 'none'}:${status?.connectedAt ?? 'none'}:${status?.port ?? 'none'}`;
}

export function markSessionLabelHydrationReady(runtimeKey: string): void {
  sessionLabelHydrationReadyByRuntime.add(runtimeKey);
}

export function isSessionLabelHydrationReady(runtimeKey: string, fallbackReady = false): boolean {
  return sessionLabelHydrationReadyByRuntime.has(runtimeKey) || fallbackReady;
}

export function getSessionLabelHydrationVersion(
  session: Pick<ChatSession, 'key' | 'updatedAt' | 'label' | 'displayName' | 'derivedTitle'>,
  sessionLastActivity: Record<string, number>,
): string {
  const activityVersion = session.updatedAt ?? sessionLastActivity[session.key] ?? 'none';
  const backendLabel = normalizeLabelValue(session.label) ?? normalizeLabelValue(session.derivedTitle) ?? '';
  return `${activityVersion}|${backendLabel}`;
}

export function getSessionLabelHydrationCandidate(
  session: Pick<ChatSession, 'key' | 'updatedAt' | 'label' | 'displayName' | 'derivedTitle'>,
  sessionLabels: Record<string, string>,
  sessionLastActivity: Record<string, number>,
): { sessionKey: string; version: string } | null {
  if (session.key.endsWith(':main')) return null;
  if (normalizeLabelValue(sessionLabels[session.key])) return null;

  const version = getSessionLabelHydrationVersion(session, sessionLastActivity);
  const backendLabel = normalizeLabelValue(session.label) ?? normalizeLabelValue(session.derivedTitle);
  if (backendLabel) {
    sessionLabelHydrationHandled.set(session.key, { version, outcome: 'backend-label' });
    return null;
  }

  if (sessionLabelHydrationInFlight.get(session.key) === version) return null;
  if (sessionLabelHydrationHandled.get(session.key)?.version === version) return null;

  return { sessionKey: session.key, version };
}

export function beginSessionLabelHydration(sessionKey: string, version: string): boolean {
  if (sessionLabelHydrationInFlight.get(sessionKey) === version) return false;
  if (sessionLabelHydrationHandled.get(sessionKey)?.version === version) return false;
  sessionLabelHydrationInFlight.set(sessionKey, version);
  return true;
}

export function finishSessionLabelHydration(
  sessionKey: string,
  version: string,
  outcome: SessionLabelHydrationOutcome,
): void {
  if (sessionLabelHydrationInFlight.get(sessionKey) === version) {
    sessionLabelHydrationInFlight.delete(sessionKey);
  }
  sessionLabelHydrationHandled.set(sessionKey, { version, outcome });
}

export function abandonSessionLabelHydration(sessionKey: string, version: string): void {
  if (sessionLabelHydrationInFlight.get(sessionKey) === version) {
    sessionLabelHydrationInFlight.delete(sessionKey);
  }
}

export function clearSessionLabelHydrationTracking(sessionKey: string): void {
  sessionLabelHydrationInFlight.delete(sessionKey);
  sessionLabelHydrationHandled.delete(sessionKey);
}
