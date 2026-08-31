import type { SessionInfo } from '@agentclientprotocol/sdk';

import type { AcpSessionFamilyMember, AcpSessionFamilyResult } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function readParentCandidate(value: unknown, sessionId: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value === sessionId) return null;
  return value;
}

export function parseAcpSessionParentId(session: SessionInfo): string | null {
  const metadata = session._meta;
  if (!isRecord(metadata)) return null;

  return readParentCandidate(metadata.parentSessionId, session.sessionId)
    ?? readParentCandidate(metadata.spawnedBy, session.sessionId);
}

export function isNativeAcpSubagentSessionId(sessionId: string): boolean {
  const parts = sessionId.split(':');
  return parts.length === 4
    && parts[0] === 'agent'
    && Boolean(parts[1])
    && parts[2] === 'subagent'
    && Boolean(parts[3]);
}

function projectMember(session: SessionInfo): AcpSessionFamilyMember {
  return {
    sessionKey: session.sessionId,
    title: readNonEmptyString(session.title) ?? session.sessionId,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : null,
    parentSessionKey: parseAcpSessionParentId(session),
  };
}

function compareFamilyMembers(left: AcpSessionFamilyMember, right: AcpSessionFamilyMember): number {
  const leftTimestamp = left.updatedAt === null ? null : Date.parse(left.updatedAt);
  const rightTimestamp = right.updatedAt === null ? null : Date.parse(right.updatedAt);
  const leftTime = leftTimestamp !== null && Number.isFinite(leftTimestamp) ? leftTimestamp : null;
  const rightTime = rightTimestamp !== null && Number.isFinite(rightTimestamp) ? rightTimestamp : null;
  if (leftTime !== rightTime) {
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    return rightTime - leftTime;
  }

  const leftCodePoints = [...left.sessionKey];
  const rightCodePoints = [...right.sessionKey];
  for (let index = 0; index < Math.min(leftCodePoints.length, rightCodePoints.length); index += 1) {
    const difference = leftCodePoints[index].codePointAt(0)! - rightCodePoints[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftCodePoints.length - rightCodePoints.length;
}

export function projectAcpSessionFamily(
  sessionKey: string,
  sessions: readonly SessionInfo[],
): AcpSessionFamilyResult {
  const seenSessionIds = new Set<string>();
  const uniqueSessions = sessions.filter((session) => {
    if (seenSessionIds.has(session.sessionId)) return false;
    seenSessionIds.add(session.sessionId);
    return true;
  });
  const current = uniqueSessions.find((session) => session.sessionId === sessionKey);
  const children = uniqueSessions
    .filter((session) => (
      isNativeAcpSubagentSessionId(session.sessionId)
      && parseAcpSessionParentId(session) === sessionKey
    ))
    .map(projectMember)
    .sort(compareFamilyMembers);

  return {
    success: true,
    current: current ? projectMember(current) : null,
    children,
  };
}
