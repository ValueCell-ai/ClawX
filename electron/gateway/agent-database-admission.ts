const AGENT_DATABASE_INSPECTION_PENDING = 'agent-database-inspection-pending';
const READINESS_PROBE_TIMEOUT_MS = 2_000;

type ReadinessAgentDatabase = {
  agentId?: unknown;
  code?: unknown;
};

/**
 * Returns the agent ids whose database admission OpenClaw is still running in
 * the background, as reported by the loopback `/readyz` probe. While an agent
 * is pending, `sessions.list` succeeds with zero rows for it and no
 * `sessions.changed` event follows admission.
 *
 * Returns `null` when readiness cannot be determined (probe unreachable,
 * non-JSON, or an older Gateway without `agentDatabases`); callers must treat
 * that as "not blocked".
 */
export async function probePendingAgentDatabaseAdmissions(
  port: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/readyz`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await response.json() as { agentDatabases?: unknown };
    if (!Array.isArray(body?.agentDatabases)) {
      return [];
    }
    return (body.agentDatabases as ReadinessAgentDatabase[])
      .filter((entry) => entry?.code === AGENT_DATABASE_INSPECTION_PENDING)
      .map((entry) => (typeof entry.agentId === 'string' ? entry.agentId : 'unknown'));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
