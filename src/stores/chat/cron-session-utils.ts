export interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
}

export function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;

  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;

  if (parts.length === 4) {
    return { agentId, jobId };
  }

  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }

  return null;
}

export function isCronSessionKey(sessionKey: string): boolean {
  return parseCronSessionKey(sessionKey) != null;
}

/**
 * Collapse a run-scoped cron session key
 * (`agent:<id>:cron:<jobId>:run:<sessionId>`) down to the base cron key
 * (`agent:<id>:cron:<jobId>`) the sidebar/UI tracks. Non-cron keys and base
 * cron keys are returned unchanged.
 */
export function getCronSessionBaseKey(sessionKey: string): string {
  const parts = parseCronSessionKey(sessionKey);
  if (!parts) return sessionKey;
  return `agent:${parts.agentId}:cron:${parts.jobId}`;
}

/**
 * Whether two session keys refer to the same logical chat session. Plain keys
 * match by exact equality; cron keys also match across the base key and any of
 * its run-scoped variants so Gateway runtime events streamed under
 * `...:run:<sessionId>` bind to the base cron session the user is viewing.
 */
export function sessionKeysAreEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const parsedA = parseCronSessionKey(a);
  const parsedB = parseCronSessionKey(b);
  if (!parsedA || !parsedB) return false;
  return parsedA.agentId === parsedB.agentId && parsedA.jobId === parsedB.jobId;
}

export function buildCronSessionHistoryPath(sessionKey: string, limit = 200): string {
  const params = new URLSearchParams({ sessionKey });
  if (Number.isFinite(limit) && limit > 0) {
    params.set('limit', String(Math.floor(limit)));
  }
  return `/api/cron/session-history?${params.toString()}`;
}
