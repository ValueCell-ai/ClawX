import { describe, expect, it } from 'vitest';
import { extractSessionIdFromTranscriptFileName } from '@electron/utils/token-usage-core';

describe('extractSessionIdFromTranscriptFileName', () => {
  it('parses normal jsonl transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.jsonl')).toBe('abc-123');
  });

  it('parses deleted transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.deleted.jsonl')).toBe('abc-123');
  });

  it('parses reset transcript names', () => {
    expect(extractSessionIdFromTranscriptFileName('abc-123.jsonl.reset.2026-03-09T03-01-29.968Z')).toBe('abc-123');
  });

  it('returns undefined for non-transcript files', () => {
    expect(extractSessionIdFromTranscriptFileName('sessions.json')).toBeUndefined();
    expect(extractSessionIdFromTranscriptFileName('abc-123.log')).toBeUndefined();
  });
});
