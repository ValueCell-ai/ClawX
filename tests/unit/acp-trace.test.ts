import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAcpTraceForTests,
  getAcpTraceSnapshot,
  normalizeRendererAcpTracePayload,
  recordAcpTrace,
  recordAttachmentOpenTrace,
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

  it('allowlists OpenClaw transcript projection details without transcript bodies or raw references', () => {
    const normalized = normalizeRendererAcpTracePayload({
      event: 'openclaw-media:resolution-available',
      sessionKey: 'agent:pi:s1',
      generation: 2,
      details: {
        source: 'openclaw-media',
        reason: 'available',
        candidateCount: 1,
        evidenceHash: 'evidence-hash',
        identityHash: 'identity-hash',
        transcriptBody: 'MEDIA:/private/secret.txt',
        uri: 'file:///private/secret.txt',
        path: '/private/secret.txt',
      },
    });

    expect(normalized?.details).toEqual({
      source: 'openclaw-media',
      reason: 'available',
      candidateCount: 1,
      evidenceHash: 'evidence-hash',
      identityHash: 'identity-hash',
    });
    expect(JSON.stringify(normalized)).not.toContain('/private/secret.txt');
  });

  it('records attachment opens with an allowlisted redacted detail shape', () => {
    recordAttachmentOpenTrace({
      ok: false,
      reason: 'operationFailed',
      sourceKind: 'local',
      sessionKey: 'agent:pi:s1',
      generation: 2,
      identity: 'a'.repeat(64),
      uri: 'file:///private/secret.txt',
      path: '/private/secret.txt',
    } as never);

    const entry = getAcpTraceSnapshot().entries[0];
    expect(entry).toMatchObject({
      event: 'attachment/open:failure',
      details: {
        reason: 'operationFailed',
        sourceKind: 'local',
        identity: 'a'.repeat(64),
      },
    });
    expect(Object.keys(entry.details as object).sort()).toEqual(['identity', 'reason', 'sourceKind']);
    expect(JSON.stringify(entry)).not.toContain('/private/secret.txt');
  });
});
