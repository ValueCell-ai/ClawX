const AGENT_DATABASE_INSPECTION_PENDING = 'agent-database-inspection-pending';
const READINESS_PROBE_TIMEOUT_MS = 2_000;

export type AgentDatabaseAdmissionFailure = {
  agentId: string;
  code: string;
  reason: string;
  repairHint?: string;
};

export type AgentDatabaseAdmissionResult =
  | { state: 'ready' }
  | { state: 'pending'; agentIds: string[] }
  | { state: 'failed'; failures: AgentDatabaseAdmissionFailure[]; pendingAgentIds: string[] }
  | { state: 'unknown' };

/**
 * Read Agent refusals, not overall /readyz health: a channel failure must not
 * block local Chat. OpenClaw omits agentDatabases when there are no refusals;
 * older Gateways omit it too. Both remain compatible on valid readiness JSON.
 * A failed/unknown admission must never be confused with an empty pending list.
 */
export async function probeAgentDatabaseAdmissions(
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentDatabaseAdmissionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/readyz`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await response.json() as { ready?: unknown; agentDatabases?: unknown } | null;
    if (!body || typeof body.ready !== 'boolean') {
      return { state: 'unknown' };
    }
    if (body.agentDatabases === undefined) {
      return { state: 'ready' };
    }
    if (!Array.isArray(body.agentDatabases)) {
      return { state: 'unknown' };
    }
    const pendingAgentIds: string[] = [];
    const failures: AgentDatabaseAdmissionFailure[] = [];
    for (const entry of body.agentDatabases) {
      if (!entry || typeof entry.code !== 'string') {
        return { state: 'unknown' };
      }
      const agentId = typeof entry.agentId === 'string' ? entry.agentId : 'unknown';
      if (entry.code === AGENT_DATABASE_INSPECTION_PENDING) {
        pendingAgentIds.push(agentId);
      } else {
        failures.push({
          agentId,
          code: entry.code,
          reason: typeof entry.reason === 'string' ? entry.reason : entry.code,
          ...(typeof entry.repairHint === 'string' ? { repairHint: entry.repairHint } : {}),
        });
      }
    }
    if (failures.length > 0) {
      return { state: 'failed', failures, pendingAgentIds };
    }
    return pendingAgentIds.length > 0
      ? { state: 'pending', agentIds: pendingAgentIds }
      : { state: 'ready' };
  } catch {
    return { state: 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}
