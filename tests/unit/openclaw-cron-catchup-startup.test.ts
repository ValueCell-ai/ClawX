// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

const requireRuntime = createRequire(import.meta.url);
const dist = resolve('node_modules/openclaw/dist');

it('admits a manual run while a startup catch-up still owns its receipt', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clawx-cron-catchup-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', home);
  vi.stubEnv('OPENCLAW_HOME', home);
  vi.stubEnv('OPENCLAW_CONFIG_PATH', join(home, 'openclaw.json'));
  const { t: CronService } = requireRuntime(join(dist, 'service-pOwE_Xvo.mjs'));
  const { t: GatewayScheduler } = requireRuntime(join(dist, 'gateway-scheduler-B_bclMMV.mjs'));
  const { l: closeDatabase } = requireRuntime(join(dist, 'openclaw-state-db-cache-SfxRpkii.mjs'));
  const held = Promise.withResolvers<void>();
  const executions: string[] = [];
  const finished: string[] = [];
  let now = Date.now();
  const cron = new CronService({
    scheduler: new GatewayScheduler(),
    nowMs: () => now,
    storePath: join(home, 'cron', 'jobs.json'),
    cronEnabled: true,
    defaultAgentId: 'main',
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runIsolatedAgentJob: async ({ job }: { job: { id: string } }) => {
      executions.push(job.id);
      if (job.id === 'catchup') await held.promise;
      return { status: 'ok' };
    },
    onEvent: (event: { jobId: string; action: string; status?: string }) => {
      if (event.action === 'finished' && event.status === 'ok') finished.push(event.jobId);
    },
  });
  let manual: Promise<unknown> | undefined;
  try {
    for (const [id, offset] of [['catchup', 60_000], ['manual', 3_600_000]] as const) {
      await cron.add({
        id, name: id, enabled: true, agentId: 'main',
        schedule: { kind: 'at', at: new Date(now + offset).toISOString() },
        sessionTarget: 'isolated', wakeMode: 'now', deleteAfterRun: false,
        payload: { kind: 'agentTurn', message: 'Synthetic run' }, delivery: { mode: 'none' },
      });
    }
    // Move one due slot between service construction and scheduler activation, as on a slow first launch.
    now += 120_000;
    const started = cron.start();
    await expect.poll(() => executions.includes('catchup'), { timeout: 15_000 }).toBe(true);
    // The Gateway's lazy enqueueRun waits on this same start promise before admitting a manual run.
    manual = started.then(() => cron.enqueueRun('manual', 'force'));
    await expect.poll(() => finished, { timeout: 10_000 }).toEqual(['manual']);
    expect(await manual).toMatchObject({ ok: true, enqueued: true });
    expect(await cron.enqueueRun('catchup', 'force')).toMatchObject({ ran: false, reason: 'already-running' });
    held.resolve();
    await expect.poll(() => finished, { timeout: 10_000 }).toEqual(['manual', 'catchup']);
    expect(executions).toEqual(['catchup', 'manual']);
  } finally {
    held.resolve();
    await manual?.catch(() => {});
    cron.stop();
    await cron.waitForIdle();
    await closeDatabase(join(home, 'state', 'openclaw.sqlite'));
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
}, 90_000);
