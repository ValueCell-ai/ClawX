import { describe, expect, it } from 'vitest';
import {
  getCronSessionBaseKey,
  isCronSessionKey,
  parseCronSessionKey,
  sessionKeysAreEquivalent,
} from '@/stores/chat/cron-session-utils';

const BASE = 'agent:product:cron:294717ee-6dde-45a8-8f67-900e2831cc4f';
const RUN = `${BASE}:run:0bfbc08a-7582-4c88-9fd3-47c484e17660`;

describe('parseCronSessionKey', () => {
  it('parses a base cron session key', () => {
    expect(parseCronSessionKey(BASE)).toEqual({
      agentId: 'product',
      jobId: '294717ee-6dde-45a8-8f67-900e2831cc4f',
    });
  });

  it('parses a run-scoped cron session key', () => {
    expect(parseCronSessionKey(RUN)).toEqual({
      agentId: 'product',
      jobId: '294717ee-6dde-45a8-8f67-900e2831cc4f',
      runSessionId: '0bfbc08a-7582-4c88-9fd3-47c484e17660',
    });
  });

  it('rejects non-cron keys', () => {
    expect(parseCronSessionKey('agent:main:main')).toBeNull();
    expect(isCronSessionKey('agent:main:main')).toBe(false);
  });
});

describe('getCronSessionBaseKey', () => {
  it('collapses a run-scoped cron key to its base key', () => {
    expect(getCronSessionBaseKey(RUN)).toBe(BASE);
  });

  it('returns a base cron key unchanged', () => {
    expect(getCronSessionBaseKey(BASE)).toBe(BASE);
  });

  it('returns non-cron keys unchanged', () => {
    expect(getCronSessionBaseKey('agent:main:main')).toBe('agent:main:main');
  });
});

describe('sessionKeysAreEquivalent', () => {
  it('matches identical keys', () => {
    expect(sessionKeysAreEquivalent(BASE, BASE)).toBe(true);
  });

  it('matches a base cron key against its run-scoped variant', () => {
    expect(sessionKeysAreEquivalent(BASE, RUN)).toBe(true);
    expect(sessionKeysAreEquivalent(RUN, BASE)).toBe(true);
  });

  it('does not match cron keys for different jobs', () => {
    const otherRun = 'agent:product:cron:other-job:run:abc';
    expect(sessionKeysAreEquivalent(BASE, otherRun)).toBe(false);
  });

  it('does not match cron keys across different agents', () => {
    const otherAgent = 'agent:main:cron:294717ee-6dde-45a8-8f67-900e2831cc4f';
    expect(sessionKeysAreEquivalent(BASE, otherAgent)).toBe(false);
  });

  it('does not match plain sessions that are not identical', () => {
    expect(sessionKeysAreEquivalent('agent:main:main', 'agent:main:other')).toBe(false);
  });

  it('returns false for nullish keys', () => {
    expect(sessionKeysAreEquivalent(null, BASE)).toBe(false);
    expect(sessionKeysAreEquivalent(BASE, undefined)).toBe(false);
  });
});
