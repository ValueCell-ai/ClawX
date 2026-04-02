import { logger } from '../utils/logger';
import { LifecycleSupersededError } from './lifecycle-controller';
import { getGatewayStartupRecoveryAction } from './startup-recovery';

export interface ExistingGatewayInfo {
  port: number;
  externalToken?: string;
}

type StartupHooks = {
  port: number;
  ownedPid?: never; // Removed: pid is now read dynamically in findExistingGateway to avoid stale-snapshot bug
  shouldWaitForPortFree: boolean;
  maxStartAttempts?: number;
  resetStartupStderrLines: () => void;
  getStartupStderrLines: () => string[];
  assertLifecycle: (phase: string) => void;
  findExistingGateway: (port: number) => Promise<ExistingGatewayInfo | null>;
  connect: (port: number, externalToken?: string) => Promise<void>;
  onConnectedToExistingGateway: () => void;
  waitForPortFree: (port: number, signal?: AbortSignal) => Promise<void>;
  startProcess: () => Promise<void>;
  waitForReady: (port: number) => Promise<void>;
  onConnectedToManagedGateway: () => void;
  runDoctorRepair: () => Promise<boolean>;
  onDoctorRepairSuccess: () => void;
  delay: (ms: number) => Promise<void>;
  /** Called before a retry to terminate the previously spawned process if still running */
  terminateOwnedProcess?: () => Promise<void>;
};

export async function runGatewayStartupSequence(hooks: StartupHooks): Promise<void> {
  let configRepairAttempted = false;
  let startAttempts = 0;
  const maxStartAttempts = hooks.maxStartAttempts ?? 3;

  while (true) {
    startAttempts++;
    hooks.assertLifecycle('start');
    hooks.resetStartupStderrLines();

    try {
      logger.debug('Checking for existing Gateway...');
      const existing = await hooks.findExistingGateway(hooks.port);
      hooks.assertLifecycle('start/find-existing');
      if (existing) {
        logger.debug(`Found existing Gateway on port ${existing.port}`);
        await hooks.connect(existing.port, existing.externalToken);
        hooks.assertLifecycle('start/connect-existing');
        hooks.onConnectedToExistingGateway();
        return;
      }

      logger.debug('No existing Gateway found, starting new process...');

      if (hooks.shouldWaitForPortFree) {
        await hooks.waitForPortFree(hooks.port);
        hooks.assertLifecycle('start/wait-port');
      }

      await hooks.startProcess();
      hooks.assertLifecycle('start/start-process');

      await hooks.waitForReady(hooks.port);
      hooks.assertLifecycle('start/wait-ready');

      await hooks.connect(hooks.port);
      hooks.assertLifecycle('start/connect');

      hooks.onConnectedToManagedGateway();
      return;
    } catch (error) {
      if (error instanceof LifecycleSupersededError) {
        throw error;
      }

      const recoveryAction = getGatewayStartupRecoveryAction({
        startupError: error,
        startupStderrLines: hooks.getStartupStderrLines(),
        configRepairAttempted,
        attempt: startAttempts,
        maxAttempts: maxStartAttempts,
      });

      if (recoveryAction === 'repair') {
        configRepairAttempted = true;
        logger.warn(
          'Detected invalid OpenClaw config during Gateway startup; running doctor repair before retry',
        );
        const repaired = await hooks.runDoctorRepair();
        if (repaired) {
          logger.info('OpenClaw doctor repair completed; retrying Gateway startup');
          hooks.onDoctorRepairSuccess();
          continue;
        }
        logger.error('OpenClaw doctor repair failed; not retrying Gateway startup');
      }

      if (recoveryAction === 'retry') {
        logger.warn(`Transient start error: ${String(error)}. Retrying... (${startAttempts}/${maxStartAttempts})`);
        await hooks.delay(1000);
        // Terminate the previously spawned process before retrying so it doesn't
        // hold the port and cause another handshake failure.
        if (hooks.terminateOwnedProcess) {
          await hooks.terminateOwnedProcess().catch((err) => {
            logger.warn('Failed to terminate owned process before retry:', err);
          });
        }
        hooks.assertLifecycle('start/retry-pre-port-wait');
        // Wait for port to become free before retrying (handles lingering processes).
        // Use a short-polling AbortController so that a superseding stop()/restart()
        // can cancel the wait promptly instead of blocking for the full 30s timeout.
        if (hooks.shouldWaitForPortFree) {
          const abortController = new AbortController();
          // Poll lifecycle every 500ms and abort the port-wait if superseded
          const lifecyclePollInterval = setInterval(() => {
            try {
              hooks.assertLifecycle('start/retry-port-wait-poll');
            } catch {
              abortController.abort();
            }
          }, 500);
          try {
            await hooks.waitForPortFree(hooks.port, abortController.signal);
          } finally {
            clearInterval(lifecyclePollInterval);
          }
        }
        hooks.assertLifecycle('start/retry-post-port-wait');
        continue;
      }

      throw error;
    }
  }
}
