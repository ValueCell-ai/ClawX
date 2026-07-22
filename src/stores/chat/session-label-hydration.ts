import {
  isAcpWorkingDirectoryTruncatedTitle,
  isOpenClawSessionIdFallbackTitle,
} from '@shared/chat/session-title';
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

type SessionLabelHydrationCandidateOptions = {
  includeWorkspacePath?: boolean;
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
  session: Pick<ChatSession, 'key' | 'sessionId' | 'updatedAt' | 'label' | 'displayName' | 'derivedTitle'>,
  sessionLastActivity: Record<string, number>,
): string {
  const activityVersion = session.updatedAt ?? sessionLastActivity[session.key] ?? 'none';
  const backendLabel = normalizeLabelValue(session.label) ?? normalizeLabelValue(session.derivedTitle) ?? '';
  return `${activityVersion}|${backendLabel}`;
}

export function getSessionLabelHydrationCandidate(
  session: Pick<ChatSession, 'key' | 'sessionId' | 'updatedAt' | 'label' | 'displayName' | 'derivedTitle' | 'workspacePath' | 'createdLocally'>,
  sessionLabels: Record<string, string>,
  sessionLastActivity: Record<string, number>,
  options: SessionLabelHydrationCandidateOptions = {},
): { sessionKey: string; version: string } | null {
  const version = getSessionLabelHydrationVersion(session, sessionLastActivity);
  const hasWorkspacePath = normalizeLabelValue(session.workspacePath) != null;
  const isMainSession = session.key.endsWith(':main');
  const displayName = normalizeLabelValue(session.displayName);
  const isLocalOrGhostMainSession = isMainSession
    && (session.createdLocally || (typeof session.updatedAt !== 'number' && (!displayName || displayName === session.key)));
  if (isLocalOrGhostMainSession) return null;
  if (isMainSession && (hasWorkspacePath || !options.includeWorkspacePath)) return null;

  const sidebarLabel = normalizeLabelValue(sessionLabels[session.key]);
  const hasSidebarLabel = sidebarLabel != null
    && !isOpenClawSessionIdFallbackTitle(sidebarLabel, session.sessionId);
  const explicitLabel = isOpenClawSessionIdFallbackTitle(session.label || '', session.sessionId)
    ? null
    : normalizeLabelValue(session.label);
  const derivedTitle = isAcpWorkingDirectoryTruncatedTitle(session.derivedTitle || '')
    || isOpenClawSessionIdFallbackTitle(session.derivedTitle || '', session.sessionId)
    ? null
    : normalizeLabelValue(session.derivedTitle);
  const backendLabel = explicitLabel ?? derivedTitle;
  const needsWorkspacePath = options.includeWorkspacePath === true && !hasWorkspacePath;
  const needsLabel = !hasSidebarLabel && !backendLabel;
  if (!needsWorkspacePath && !needsLabel) return null;

  if (backendLabel) {
    if (!needsWorkspacePath) {
      sessionLabelHydrationHandled.set(session.key, { version, outcome: 'backend-label' });
      return null;
    }
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
