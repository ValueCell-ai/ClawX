// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { probeAgentDatabaseAdmissions } from '@electron/gateway/agent-database-admission';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const pending = { agentId: 'main', code: 'agent-database-inspection-pending' };
const failed = {
  agentId: 'broken',
  code: 'agent-database-inspection-failed',
  reason: 'prepared model runtime publication was superseded for agent',
  repairHint: 'Stop the Gateway and inspect the agent.',
};

describe('probeAgentDatabaseAdmissions', () => {
  it('returns pending agents from the loopback readyz probe', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ready: true, agentDatabases: [pending] }));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'pending', agentIds: ['main'] });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:18789/readyz', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('preserves failed admission and pending peers even when top-level ready is true', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ready: true, agentDatabases: [pending, failed] }));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'failed', failures: [failed], pendingAgentIds: ['main'] });
  });

  it('does not treat a failed-only admission as an empty pending list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ready: false, agentDatabases: [failed] }, 503));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'failed', failures: [failed], pendingAgentIds: [] });
  });

  it.each([
    { ready: true, failing: [] }, // Older Gateway; modern Gateway also omits empty refusals.
    { ready: true, agentDatabases: [] },
    { ready: false, failing: ['discord'] },
    { ready: false, failing: ['discord'], agentDatabases: [] },
  ])('preserves absent/empty admission and unrelated channel health compatibility: %j', async (body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body, body.ready ? 200 : 503));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'ready' });
  });

  it.each([null, {}, [], { ready: 'yes' }, { ready: true, agentDatabases: null },
    { ready: true, agentDatabases: [null] }, { ready: true, agentDatabases: [{}] },
  ])('does not treat malformed readiness JSON as admitted: %j', async (body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'unknown' });
  });

  it('preserves unfamiliar refusal codes without guessing they are recoverable', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ready: false, agentDatabases: [{ code: 'future-refusal' }] }));
    await expect(probeAgentDatabaseAdmissions(18789, fetchImpl as typeof fetch))
      .resolves.toEqual({ state: 'failed', failures: [{ agentId: 'unknown', code: 'future-refusal', reason: 'future-refusal' }], pendingAgentIds: [] });
  });

  it('returns unknown on unreachable or non-JSON probes', async () => {
    const unreachable = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(probeAgentDatabaseAdmissions(18789, unreachable as typeof fetch))
      .resolves.toEqual({ state: 'unknown' });
    const nonJson = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(probeAgentDatabaseAdmissions(18789, nonJson as typeof fetch))
      .resolves.toEqual({ state: 'unknown' });
  });
});
