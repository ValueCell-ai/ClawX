export function nextLifecycleEpoch(currentEpoch: number): number {
  return currentEpoch + 1;
}

export function isLifecycleSuperseded(expectedEpoch: number, currentEpoch: number): boolean {
  return expectedEpoch !== currentEpoch;
}

export interface ReconnectAttemptContext {
  scheduledEpoch: number;
  currentEpoch: number;
  shouldReconnect: boolean;
}

export function getReconnectSkipReason(context: ReconnectAttemptContext): string | null {
  if (!context.shouldReconnect) {
    return 'auto-reconnect disabled';
  }
  if (isLifecycleSuperseded(context.scheduledEpoch, context.currentEpoch)) {
    return `stale reconnect callback (scheduledEpoch=${context.scheduledEpoch}, currentEpoch=${context.currentEpoch})`;
  }
  return null;
}
