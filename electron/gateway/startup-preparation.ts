import { LifecycleSupersededError } from './lifecycle-controller';
import type { CronInferenceContinuityEntry, GatewayStartupPreparationResult } from './cron-inference-continuity';
export type { CronInferenceContinuityEntry } from './cron-inference-continuity';

export type GatewayStartupReadiness = { ready: true } | { ready: false; reason: string };

export interface GatewayStartupPreparationContext {
  /** Recheck after asynchronous work and immediately before each persistent write. */
  assertActive(): void;
  signal: AbortSignal;
  /** Trusted Main extensions only; restore credentials for the same encrypted session first. */
  restoreCronInferenceContinuity?(entries: readonly CronInferenceContinuityEntry[]): void;
}

export interface GatewayStartupPreparation {
  /** Read-only admission. A stable reason identifies the migration still required. */
  checkReady(context: GatewayStartupPreparationContext): GatewayStartupReadiness | Promise<GatewayStartupReadiness>;
  /**
   * Await all projection writes. If inputs changed since checkReady, repeat the
   * read-only check and throw GatewayStartupMigrationRequiredError before writes.
   * Never classify an arbitrary write failure as a migration request.
   */
  run(context: GatewayStartupPreparationContext): Promise<void>;
}

export class GatewayStartupMigrationRequiredError extends Error {
  constructor(readonly reason: string) {
    super(`Gateway startup preparation requires OpenClaw migration: ${reason}`);
    this.name = 'GatewayStartupMigrationRequiredError';
  }
}

export class GatewayStartupPreparationError extends Error {
  constructor(id: string, cause: unknown) {
    super(`Gateway startup preparation failed: ${id}`, { cause });
    this.name = 'GatewayStartupPreparationError';
  }
}

type Registration = { id: string; preparation: GatewayStartupPreparation };

/** Offline preparations run only for a new managed process, never on attachment. */
export class GatewayStartupPreparations {
  private readonly registrations = new Map<string, Registration>();
  private readonly active = new Map<AbortController, Registration>();

  register(id: string, preparation: GatewayStartupPreparation): () => void {
    if (!id.trim()) throw new Error('Gateway startup preparation requires an id');
    // The admission set itself changed; a running pass cannot silently omit
    // the new participant or use a verdict belonging to its predecessor.
    this.cancelActive();
    const registration = { id, preparation };
    this.registrations.set(id, registration);
    return () => {
      if (this.registrations.get(id) !== registration) return;
      this.registrations.delete(id);
      this.cancelActive();
    };
  }

  cancelActive(): void {
    for (const controller of this.active.keys()) controller.abort();
  }

  async run(assertLifecycle: () => void): Promise<GatewayStartupPreparationResult> {
    const cronInferenceContinuity: CronInferenceContinuityEntry[] = [];
    const entries = [...this.registrations.values()].map((registration) => {
      const controller = new AbortController();
      this.active.set(controller, registration);
      const context: GatewayStartupPreparationContext = {
        signal: controller.signal,
        assertActive: () => {
          assertLifecycle();
          if (controller.signal.aborted || this.registrations.get(registration.id) !== registration) {
            throw new LifecycleSupersededError(`Gateway startup preparation superseded: ${registration.id}`);
          }
        },
        restoreCronInferenceContinuity: (entries) => {
          context.assertActive();
          if (entries.length + cronInferenceContinuity.length > 1000) throw new Error('Too many scheduled-task continuations');
          cronInferenceContinuity.push(...structuredClone(entries));
        },
      };
      return { registration, controller, context };
    });
    let currentId = 'readiness';
    try {
      // No participant writes until every participant has passed admission.
      for (const { registration, context } of entries) {
        currentId = registration.id;
        context.assertActive();
        const readiness = await registration.preparation.checkReady(context);
        context.assertActive();
        if (!readiness.ready) {
          if (!readiness.reason.trim()) throw new Error('Missing startup migration reason');
          throw new GatewayStartupMigrationRequiredError(readiness.reason);
        }
      }
      for (const { registration, context } of entries) {
        currentId = registration.id;
        context.assertActive();
        await registration.preparation.run(context);
        context.assertActive();
      }
      assertLifecycle();
      return { cronInferenceContinuity };
    } catch (error) {
      // A rejected asynchronous callback may race stop/unregister. Cancellation
      // wins before the startup orchestrator classifies a normal failure.
      assertLifecycle();
      for (const { context } of entries) context.assertActive();
      if (error instanceof GatewayStartupMigrationRequiredError) {
        throw new GatewayStartupMigrationRequiredError(`${currentId}: ${error.reason}`);
      }
      throw new GatewayStartupPreparationError(currentId, error);
    } finally {
      for (const { controller } of entries) {
        controller.abort();
        this.active.delete(controller);
      }
    }
  }
}
