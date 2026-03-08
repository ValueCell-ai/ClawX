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

export type GatewayLifecycleState = 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';

export interface RestartDeferralContext {
  state: GatewayLifecycleState;
  startLock: boolean;
}

/**
 * Restart requests should not interrupt an in-flight startup/reconnect flow.
 * Doing so can kill a just-spawned process and leave the manager stopped.
 */
export function shouldDeferRestart(context: RestartDeferralContext): boolean {
  return context.startLock || context.state === 'starting' || context.state === 'reconnecting';
}

export interface DeferredRestartActionContext extends RestartDeferralContext {
  hasPendingRestart: boolean;
  shouldReconnect: boolean;
}

export type DeferredRestartAction = 'none' | 'wait' | 'drop' | 'execute';

/**
 * Decide what to do with a pending deferred restart once lifecycle changes.
 *
 * A deferred restart is an explicit restart() call that was postponed because
 * the manager was mid-startup/reconnect.  When the in-flight operation settles
 * we must honour the request — even if the gateway is now running — because
 * the caller may have changed config (e.g. provider switch) that the current
 * process hasn't picked up.
 */
export function getDeferredRestartAction(context: DeferredRestartActionContext): DeferredRestartAction {
  if (!context.hasPendingRestart) return 'none';
  if (shouldDeferRestart(context)) return 'wait';
  if (!context.shouldReconnect) return 'drop';
  return 'execute';
}
