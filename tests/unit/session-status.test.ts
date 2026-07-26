import { describe, expect, it } from 'vitest';
import { projectSessionRunState } from '@/stores/chat/session-status';

describe('projectSessionRunState', () => {
  it.each(['done', 'failed', 'timeout', 'killed'])(
    'projects bundled terminal status %s as idle despite a stale active run',
    (status) => {
      expect(projectSessionRunState({ status, hasActiveRun: true })).toBe('idle');
    },
  );

  it.each(['completed', 'finished', 'error', 'aborted', 'cancelled'])(
    'projects terminal alias %s as idle',
    (status) => {
      expect(projectSessionRunState({ status, hasActiveRun: true })).toBe('idle');
    },
  );

  it('normalizes terminal status before projecting it', () => {
    expect(projectSessionRunState({ status: '  FINISHED  ', hasActiveRun: true })).toBe('idle');
  });

  it('uses a non-terminal active-run boolean when present', () => {
    expect(projectSessionRunState({ status: 'queued', hasActiveRun: true })).toBe('busy');
    expect(projectSessionRunState({ status: 'running', hasActiveRun: false })).toBe('idle');
  });

  it('falls back to running status when the active-run boolean is missing', () => {
    expect(projectSessionRunState({ status: ' RUNNING ' })).toBe('busy');
  });

  it('returns unknown without a usable status signal', () => {
    expect(projectSessionRunState({})).toBe('unknown');
    expect(projectSessionRunState({ status: 'queued' })).toBe('unknown');
    expect(projectSessionRunState({ status: '  ' })).toBe('unknown');
  });
});
