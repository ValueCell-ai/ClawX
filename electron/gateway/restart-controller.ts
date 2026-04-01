import { logger } from '../utils/logger';
import {
  getDeferredRestartAction,
  shouldDeferRestart,
  type GatewayLifecycleState,
} from './process-policy';

type RestartDeferralState = {
  state: GatewayLifecycleState;
  startLock: boolean;
};

type DeferredRestartContext = RestartDeferralState & {
  shouldReconnect: boolean;
};

export class GatewayRestartController {
  private deferredRestartPending = false;
  private deferredRestartRequestedAt = 0;
  private lastRestartCompletedAt = 0;
  private restartDebounceTimer: NodeJS.Timeout | null = null;

  isRestartDeferred(context: RestartDeferralState): boolean {
    return shouldDeferRestart(context);
  }

  markDeferredRestart(reason: string, context: RestartDeferralState): void {
    if (!this.deferredRestartPending) {
      logger.info(
        `Deferring Gateway restart (${reason}) until startup/reconnect settles (state=${context.state}, startLock=${context.startLock})`,
      );
    } else {
      logger.debug(
        `Gateway restart already deferred; keeping pending request (${reason}, state=${context.state}, startLock=${context.startLock})`,
      );
    }
    this.deferredRestartPending = true;
    if (this.deferredRestartRequestedAt === 0) {
      this.deferredRestartRequestedAt = Date.now();
    }
  }

  recordRestartCompleted(): void {
    this.lastRestartCompletedAt = Date.now();
  }

  flushDeferredRestart(
    trigger: string,
    context: DeferredRestartContext,
    executeRestart: () => void,
  ): void {
    const action = getDeferredRestartAction({
      hasPendingRestart: this.deferredRestartPending,
      state: context.state,
      startLock: context.startLock,
      shouldReconnect: context.shouldReconnect,
    });

    if (action === 'none') return;
    if (action === 'wait') {
      logger.debug(
        `Deferred Gateway restart still waiting (${trigger}, state=${context.state}, startLock=${context.startLock})`,
      );
      return;
    }

    const requestedAt = this.deferredRestartRequestedAt;
    this.deferredRestartPending = false;
    this.deferredRestartRequestedAt = 0;
    if (action === 'drop') {
      logger.info(
        `Dropping deferred Gateway restart (${trigger}) because lifecycle already recovered (state=${context.state}, shouldReconnect=${context.shouldReconnect})`,
      );
      return;
    }

    // If a restart already completed after this deferred request was made,
    // the current process is already running with the latest config —
    // skip the redundant restart to avoid "just started then restart" loops.
    if (requestedAt > 0 && this.lastRestartCompletedAt >= requestedAt) {
      logger.info(
        `Dropping deferred Gateway restart (${trigger}): a restart already completed after the request (requested=${requestedAt}, completed=${this.lastRestartCompletedAt})`,
      );
      return;
    }

    logger.info(`Executing deferred Gateway restart now (${trigger})`);
    executeRestart();
  }

  debouncedRestart(delayMs: number, executeRestart: () => void): void {
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer);
    }
    logger.debug(`Gateway restart debounced (will fire in ${delayMs}ms)`);
    this.restartDebounceTimer = setTimeout(() => {
      this.restartDebounceTimer = null;
      executeRestart();
    }, delayMs);
  }

  clearDebounceTimer(): void {
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer);
      this.restartDebounceTimer = null;
    }
  }

  resetDeferredRestart(): void {
    this.deferredRestartPending = false;
    this.deferredRestartRequestedAt = 0;
  }
}
