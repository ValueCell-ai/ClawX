export interface ReconnectConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 10,
  baseDelay: 1000,
  maxDelay: 30000,
};

/** sysexits(3) EX_CONFIG, used by OpenClaw 2026.7.1 for fatal config startup errors. */
export const OPENCLAW_EX_CONFIG_EXIT_CODE = 78;

export function isOpenClawFatalConfigExitCode(code: number | null | undefined): boolean {
  return code === OPENCLAW_EX_CONFIG_EXIT_CODE;
}

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

export interface ReconnectScheduleContext {
  shouldReconnect: boolean;
  hasReconnectTimer: boolean;
  reconnectAttempts: number;
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

export type ReconnectScheduleDecision =
  | { action: 'skip'; reason: string }
  | { action: 'already-scheduled' }
  | { action: 'fail'; attempts: number; maxAttempts: number }
  | { action: 'schedule'; nextAttempt: number; maxAttempts: number; delay: number };

export function getReconnectScheduleDecision(
  context: ReconnectScheduleContext,
): ReconnectScheduleDecision {
  if (!context.shouldReconnect) {
    return { action: 'skip', reason: 'auto-reconnect disabled' };
  }

  if (context.hasReconnectTimer) {
    return { action: 'already-scheduled' };
  }

  if (context.reconnectAttempts >= context.maxAttempts) {
    return {
      action: 'fail',
      attempts: context.reconnectAttempts,
      maxAttempts: context.maxAttempts,
    };
  }

  const delay = Math.min(
    context.baseDelay * Math.pow(2, context.reconnectAttempts),
    context.maxDelay,
  );

  return {
    action: 'schedule',
    nextAttempt: context.reconnectAttempts + 1,
    maxAttempts: context.maxAttempts,
    delay,
  };
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
