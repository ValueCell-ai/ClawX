// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { probePendingAgentDatabaseAdmissions } from '@electron/gateway/agent-database-admission';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('probePendingAgentDatabaseAdmissions', () => {
  it('returns agents whose database inspection is still pending from the loopback readyz probe', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ready: true,
      failing: [],
      agentDatabases: [
        { agentId: 'main', code: 'agent-database-inspection-pending' },
        { agentId: 'broken', code: 'agent-database-inspection-failed' },
      ],
    }));

    await expect(probePendingAgentDatabaseAdmissions(18789, fetchImpl as unknown as typeof fetch))
      .resolves.toEqual(['main']);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:18789/readyz', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('returns no pending agents once admission completes or the Gateway predates agentDatabases', async () => {
    const admitted = vi.fn(async () => jsonResponse({ ready: true, failing: [] }));
    await expect(probePendingAgentDatabaseAdmissions(18789, admitted as unknown as typeof fetch))
      .resolves.toEqual([]);

    const notReady = vi.fn(async () => jsonResponse({ ready: false, failing: ['discord'] }, 503));
    await expect(probePendingAgentDatabaseAdmissions(18789, notReady as unknown as typeof fetch))
      .resolves.toEqual([]);
  });

  it('returns null when readiness cannot be determined', async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(probePendingAgentDatabaseAdmissions(18789, unreachable as unknown as typeof fetch))
      .resolves.toBeNull();

    const nonJson = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(probePendingAgentDatabaseAdmissions(18789, nonJson as unknown as typeof fetch))
      .resolves.toBeNull();
  });
});
