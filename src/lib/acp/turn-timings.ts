import type { SessionTurnTimingCandidate } from '@shared/host-api/contract';
import { acpUserTurns, turnMatchKey } from './openclaw-media-compat';
import type { AcpTimelineSnapshot } from './timeline-types';

export type AcpTurnTiming =
  | { source: 'live'; status: 'running'; startedAtMs: number }
  | { source: 'live' | 'transcript'; status: 'complete'; durationMs: number };

export function alignHistoricalTurnTimings(
  snapshot: AcpTimelineSnapshot,
  timings: SessionTurnTimingCandidate[],
): Record<string, AcpTurnTiming> {
  const acpByKey = new Map(acpUserTurns(snapshot).map((turn) => [turnMatchKey(turn), turn]));
  const validTimings = timings.filter((timing) => (
    Number.isFinite(timing.durationMs) && timing.durationMs >= 0
  ));
  const timingKeyCounts = new Map<string, number>();
  for (const timing of validTimings) {
    const key = turnMatchKey(timing);
    timingKeyCounts.set(key, (timingKeyCounts.get(key) ?? 0) + 1);
  }

  const result: Record<string, AcpTurnTiming> = {};
  for (const timing of validTimings) {
    const key = turnMatchKey(timing);
    if (timingKeyCounts.get(key) !== 1) continue;
    const turn = acpByKey.get(key);
    if (!turn) continue;
    result[turn.turnId] = {
      source: 'transcript',
      status: 'complete',
      durationMs: timing.durationMs,
    };
  }
  return result;
}
