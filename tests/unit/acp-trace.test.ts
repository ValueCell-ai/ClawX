import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAcpTraceForTests,
  getAcpTraceSnapshot,
  normalizeRendererAcpTracePayload,
  recordAcpTrace,
} from '../../electron/services/acp-trace';

describe('ACP trace diagnostics store', () => {
  beforeEach(() => clearAcpTraceForTests());

  it('records entries with chronological sequence numbers', () => {
    recordAcpTrace({ source: 'main', event: 'session/load:start', sessionKey: 'agent:pi:s1', generation: 1 });
    recordAcpTrace({ source: 'renderer', event: 'image-generation:start-detected', sessionKey: 'agent:pi:s1', generation: 1 });

    const snapshot = getAcpTraceSnapshot();
    expect(snapshot.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(snapshot.entries.map((entry) => entry.event)).toEqual([
      'session/load:start',
      'image-generation:start-detected',
    ]);
  });

  it('redacts sensitive fields and truncates long strings', () => {
    recordAcpTrace({
      source: 'main',
      event: 'redaction-test',
      details: {
        authorization: 'Bearer secret-token',
        apiKey: 'sk-secret',
        text: 'x'.repeat(420),
      },
    });

    const details = getAcpTraceSnapshot().entries[0]?.details as Record<string, unknown>;
    expect(details.authorization).toBe('[redacted]');
    expect(details.apiKey).toBe('[redacted]');
    expect(String(details.text)).toContain('[truncated');
  });

  it('normalizes valid renderer payloads and rejects malformed ones', () => {
    expect(normalizeRendererAcpTracePayload({
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 2,
      details: { reason: 'no-fresh-context' },
    })).toMatchObject({
      source: 'renderer',
      direction: 'projection',
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 2,
    });

    expect(normalizeRendererAcpTracePayload({ event: '' })).toBeNull();
    expect(normalizeRendererAcpTracePayload(null)).toBeNull();
  });
});
