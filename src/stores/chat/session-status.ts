import type { ChatSession } from './types';

export type SessionRunProjection = 'busy' | 'idle' | 'unknown';

const TERMINAL_STATUSES = new Set([
  'done',
  'failed',
  'timeout',
  'killed',
  'completed',
  'finished',
  'error',
  'aborted',
  'cancelled',
]);

export function projectSessionRunState(
  session: Pick<ChatSession, 'status' | 'hasActiveRun'>,
): SessionRunProjection {
  const status = session.status?.trim().toLowerCase();

  if (status && TERMINAL_STATUSES.has(status)) return 'idle';
  if (typeof session.hasActiveRun === 'boolean') return session.hasActiveRun ? 'busy' : 'idle';
  if (status === 'running') return 'busy';
  return 'unknown';
}
