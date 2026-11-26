// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const bundle = (file: string) => import(pathToFileURL(path.join(dist, file)).href);
const migrated = { command: 'python C:\\jobs\\daily.py --start', timeoutSeconds: 4200 };
const args = { command: migrated.command };
type Instance = { runId: string; instanceId: string };
type Admitted = { operationalRunInstance: Instance };
type Launcher = { signal: AbortSignal; timeoutSeconds: number; beginWorkerWait?: () => (() => void) | undefined };
type Request = {
  job?: { sessionTarget: string; payload: { kind: string; message?: string; timeoutSeconds?: number } };
  abortSignal: AbortSignal;
  clawxBeginWorkerWait?: (timeoutMs: number) => (() => void) | undefined;
  executionIdentity?: { onPostAdmission: (admitted: Admitted) => void | Promise<void> };
};

const { runClawxCronJob, getClawxCronLauncher } = await bundle('clawx-cron-run-context.mjs') as {
  runClawxCronJob: <T>(request: Request, run: (request: Request) => Promise<T>, launcher?: typeof migrated) => Promise<T>;
  getClawxCronLauncher: (tool: { operationalRunInstance?: Instance; timeoutSec?: number } | undefined, params: Record<string, unknown>, configuredTimeout: number, matchesLegacyWorkdir?: boolean, resolvedWorkdir?: string) => Launcher | undefined;
};
type StartupLauncher = { command: string; workdir: string; workerTimeoutSeconds: number };
const { resolveClawxStartupLauncher, matchesClawxStartupLauncher } = await bundle('clawx-cron-startup-launcher.mjs') as {
  resolveClawxStartupLauncher: (job: Request['job']) => StartupLauncher | undefined;
  matchesClawxStartupLauncher: (launcher: StartupLauncher | undefined, params: { command: string }, cwd: string) => boolean;
};
const workdir = 'D:\\fixtures\\tile-cache';
const script = workdir + '\\tiles.py';
const command = `python.exe ${script} --start --scan-timeout-seconds 11 --index-timeout-seconds 75`;
const savedLauncherJob = {
  sessionTarget: 'isolated',
  payload: { kind: 'agentTurn', timeoutSeconds: 60, message: `Build the tile index.\n${command}` },
};
const { t: prepareCronRunAdmission } = await bundle('run-admission-BttHm5Ts.mjs') as {
  t: (params: Record<string, unknown>) => {
    preparedRunAdmission: { admit: (runtime: string) => Promise<Admitted> };
    close: () => void;
  };
};
const { i: enqueueCommandInLane } = await bundle('command-queue-CDH3ocra.mjs') as {
  i: <T>(lane: string, run: () => Promise<T>) => Promise<T>;
};

async function throughAdmission<T>(runId: string, request: Request, run: (tool: Admitted) => Promise<T>) {
  const admission = prepareCronRunAdmission({
    runId,
    agentId: 'main',
    jobId: 'upgrade-fixture',
    sessionId: 'existing-session',
    sessionKey: 'agent:main:existing-session',
    cfg: { logging: { audit: { enabled: false } } },
    executionIdentity: request.executionIdentity,
  });
  try {
    return await enqueueCommandInLane(`test-admission-${randomUUID()}`, async () => {
      const admitted = await admission.preparedRunAdmission.admit('embedded');
      return await run(admitted);
    });
  } finally {
    admission.close();
  }
}

describe('OpenClaw scheduled exec ownership', () => {
  it('matches the saved Windows launcher in its script directory with either path separator', () => {
    const launcher = resolveClawxStartupLauncher(savedLauncherJob);
    expect(launcher?.command).toBe(command);
    const localizedPayload = { ...savedLauncherJob.payload, message: `瓦片索引示例：${command}。地图预览另行生成。` };
    expect(resolveClawxStartupLauncher({ ...savedLauncherJob, payload: localizedPayload })).toEqual(launcher);
    expect(launcher?.workerTimeoutSeconds).toBeGreaterThan(60);
    expect(Number.isSafeInteger(launcher?.workerTimeoutSeconds)).toBe(true);
    expect(matchesClawxStartupLauncher(launcher, { command }, workdir)).toBe(true);
    expect(matchesClawxStartupLauncher(launcher, { command: command.replaceAll('\\', '/') }, workdir.replaceAll('\\', '/'))).toBe(true);
    expect(matchesClawxStartupLauncher(launcher, { command }, workdir + '\\other')).toBe(false);
    for (const actual of [
      command.replace('75', '76'), command.replace(script, 'tiles.py'), command.replace(script, 'D:\\other\\tiles.py'),
      command + ' & echo more', command + '\nWrite-Output more', command.replace(script, '%TEMP%\\tiles.py'),
    ]) {
      expect(matchesClawxStartupLauncher(launcher, { command: actual }, workdir)).toBe(false);
    }
  });

  it('declines ambiguous launchers, ordinary jobs and other deadlines', () => {
    const { payload } = savedLauncherJob;
    for (const message of [
      payload.message + '\n' + command, command.replace(script, 'relative.py'), command + ' && echo done',
      command.replace('75', '60'), command.replace('75', String(Number.MAX_SAFE_INTEGER + 1)),
      command.replace('--start', '--list'), command.replace(script, 'D:\\one\\..\\two\\tiles.py'),
    ]) {
      expect(resolveClawxStartupLauncher({ ...savedLauncherJob, payload: { ...payload, message } })).toBeUndefined();
    }
    for (const timeoutSeconds of [undefined, 0, 59, 61, 120]) {
      expect(resolveClawxStartupLauncher({ ...savedLauncherJob, payload: { ...payload, timeoutSeconds } })).toBeUndefined();
    }
    expect(resolveClawxStartupLauncher({ ...savedLauncherJob, sessionTarget: 'current' })).toBeUndefined();
    expect(resolveClawxStartupLauncher({ ...savedLauncherJob, payload: { ...payload, kind: 'script' } })).toBeUndefined();
  });

  it('installs the wrapper on the scheduler’s isolated agent runner', async () => {
    const source = await readFile(path.join(dist, 'server-cron-BOAcxlHX.mjs'), 'utf8');
    const entry = source.slice(source.indexOf('runIsolatedAgentJob: async'), source.indexOf('runCommandJob: async'));
    expect(entry).toContain('return await runClawxCronJob({');
    expect(entry).toContain('}, runCronIsolatedAgentTurn, getClawxMigratedLauncher(job))');
  });

  it('crosses the native command queue and distinguishes a second admission to the same session and run ID', async () => {
    const postAdmission = vi.fn();
    const request = { abortSignal: new AbortController().signal, executionIdentity: { onPostAdmission: postAdmission } };
    const runId = randomUUID();
    const signal = await runClawxCronJob(request, async (scheduled) =>
      throughAdmission(runId, scheduled, async (tool) => {
        expect(postAdmission).toHaveBeenCalledWith(tool);
        const signal = getClawxCronLauncher(tool, args, 1800)?.signal;
        expect(signal?.aborted).toBe(false);
        expect(getClawxCronLauncher({ operationalRunInstance: { ...tool.operationalRunInstance } }, args, 1800)).toBeUndefined();
        await throughAdmission(runId, request, async (otherTool) => {
          expect(getClawxCronLauncher(otherTool, args, 1800)).toBeUndefined();
        });
        return signal;
      }), migrated,
    );
    expect(signal?.aborted).toBe(true);
    expect(getClawxCronLauncher(undefined, args, 1800)).toBeUndefined();
  });

  it.each(['manual cancellation', 'cron timeout'])('propagates %s and preserves its reason', async (reason) => {
    const controller = new AbortController();
    const request = { abortSignal: controller.signal, executionIdentity: { onPostAdmission: vi.fn() } };
    await runClawxCronJob(request, async (scheduled) =>
      throughAdmission(randomUUID(), scheduled, async (tool) => {
        const signal = getClawxCronLauncher(tool, args, 1800)?.signal;
        controller.abort(reason);
        expect(signal?.aborted).toBe(true);
        expect(signal?.reason).toBe(reason);
      }), migrated,
    );
  });

  it('closes the occurrence when the agent fails', async () => {
    const request = { abortSignal: new AbortController().signal, executionIdentity: { onPostAdmission: vi.fn() } };
    const error = new Error('agent failed');
    let signal: AbortSignal | undefined;
    await expect(runClawxCronJob(request, async (scheduled) =>
      throughAdmission(randomUUID(), scheduled, async (tool) => {
        signal = getClawxCronLauncher(tool, args, 1800)?.signal;
        throw error;
      }), migrated,
    )).rejects.toBe(error);
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the instance ineligible when native admission rejects', async () => {
    const error = new Error('admission failed');
    const tool = { operationalRunInstance: { runId: randomUUID(), instanceId: randomUUID() } };
    const request = {
      abortSignal: new AbortController().signal,
      executionIdentity: { onPostAdmission: async () => { throw error; } },
    };
    await expect(runClawxCronJob(request, async (scheduled) => {
      await scheduled.executionIdentity?.onPostAdmission(tool);
    }, migrated)).rejects.toBe(error);
    expect(getClawxCronLauncher(tool, args, 1800)).toBeUndefined();
  });

  it('opts in only the certified command and preserves per-command and configured timeouts', async () => {
    const request = {
      job: { sessionTarget: 'isolated', payload: { kind: 'agentTurn' } },
      abortSignal: new AbortController().signal, executionIdentity: { onPostAdmission: vi.fn() },
    };
    await runClawxCronJob(request, (scheduled) => throughAdmission(randomUUID(), scheduled, async (tool) => {
      const find = (params: Record<string, unknown>, configured?: number) => getClawxCronLauncher(
        { ...tool, timeoutSec: configured }, { ...args, ...params }, configured ?? 1800,
      );
      expect(find({ yieldMs: 20 })?.timeoutSeconds).toBe(4200);
      expect(find({}, 100)?.timeoutSeconds).toBe(100);
      expect(find({ timeoutSeconds: 50 }, 100)?.timeoutSeconds).toBe(50);
      expect(find({ timeoutSeconds: 0 })?.timeoutSeconds).toBe(0);
      expect(find({ awaitResults: true })?.timeoutSeconds).toBe(4200);
      expect(getClawxCronLauncher(tool, args, 1800, false)).toBeUndefined();
      expect(getClawxCronLauncher(tool, { ...args, awaitResults: true }, 1800, false)?.timeoutSeconds).toBe(1800);
      for (const overrides of [{ command: 'echo done' }, { command: args.command + ' && echo done' },
        { pty: true }, { background: true }, { env: { PYTHONPATH: 'other' } }]) {
        expect(find(overrides)).toBeUndefined();
      }
    }), migrated);
  });

  it('waits for an explicitly awaited exec in an admitted isolated agent job without a migration', async () => {
    const request = {
      job: { sessionTarget: 'isolated', payload: { kind: 'agentTurn' } },
      abortSignal: new AbortController().signal,
      executionIdentity: { onPostAdmission: vi.fn() },
    };
    const runId = randomUUID();
    const params = { command: 'echo launch', workdir: 'C:\\jobs\\scripts', awaitResults: true };
    const signal = await runClawxCronJob(request, (scheduled) => throughAdmission(runId, scheduled, async (tool) => {
      expect(request.executionIdentity.onPostAdmission).toHaveBeenCalledWith(tool);
      const launcher = getClawxCronLauncher(tool, params, 90);
      expect(launcher?.timeoutSeconds).toBe(90);
      expect(launcher?.signal.aborted).toBe(false);
      expect(getClawxCronLauncher(tool, { ...params, timeoutSeconds: 40 }, 90)?.timeoutSeconds).toBe(40);
      for (const overrides of [{ awaitResults: undefined }, { awaitResults: false }, { background: true }, { pty: true }]) {
        expect(getClawxCronLauncher(tool, { ...params, ...overrides }, 90)).toBeUndefined();
      }
      await throughAdmission(runId, request, async (interactiveTool) => {
        expect(getClawxCronLauncher(interactiveTool, params, 90)).toBeUndefined();
      });
      return launcher?.signal;
    }));
    expect(signal?.aborted).toBe(true);
  });

  it.runIf(process.platform === 'win32')('recognizes the saved short launcher without an explicit awaitResults or a migration', async () => {
    const request = {
      job: structuredClone(savedLauncherJob),
      abortSignal: new AbortController().signal,
      clawxBeginWorkerWait: vi.fn(() => vi.fn()),
      executionIdentity: { onPostAdmission: vi.fn() },
    };
    const saved = structuredClone(request.job);
    const finishedLauncher = await runClawxCronJob(request, (scheduled) =>
      throughAdmission(randomUUID(), scheduled, async (tool) => {
        const params = { command, workdir };
        const launcher = getClawxCronLauncher(tool, params, 1800, false, workdir);
        expect(launcher).toBeDefined();
        expect(launcher?.signal.aborted).toBe(false);
        expect(getClawxCronLauncher(tool, { ...params, timeoutSeconds: 45 }, 1800, false, workdir)?.timeoutSeconds).toBe(45);
        expect(getClawxCronLauncher(tool, { ...params, awaitResults: true }, 1800, false, workdir)?.beginWorkerWait).toBeTypeOf('function');
        expect(getClawxCronLauncher(tool, params, 1800, false, workdir + '\\other')).toBeUndefined();
        const changes = [
          { command: command.replace('tiles.py', 'unrelated.py') },
          { command: command + ' && echo extra' },
          { background: true }, { pty: true }, { env: { PYTHONPATH: 'other' } },
        ];
        for (const change of changes) {
          expect(getClawxCronLauncher(tool, { ...params, ...change }, 1800, false, workdir)).toBeUndefined();
        }
        expect(getClawxCronLauncher({ operationalRunInstance: { ...tool.operationalRunInstance } },
          params, 1800, false, workdir)).toBeUndefined();
        return launcher;
      }));
    expect(finishedLauncher?.signal.aborted).toBe(true);
    expect(finishedLauncher?.beginWorkerWait?.()).toBeUndefined();
    expect(request.clawxBeginWorkerWait).not.toHaveBeenCalled();
    expect(request.job).toEqual(saved);
  });

  it('keeps the saved command on its ordinary deadline without a scheduler-owned worker clock', async () => {
    const request = {
      job: structuredClone(savedLauncherJob), abortSignal: new AbortController().signal,
      executionIdentity: { onPostAdmission: vi.fn() },
    };
    await runClawxCronJob(request, (scheduled) => throughAdmission(randomUUID(), scheduled, async (tool) => {
      expect(getClawxCronLauncher(tool, { command, workdir }, 1800, false, workdir)).toBeUndefined();
    }));
  });

  it.each([
    ['current', 'agentTurn'],
    ['session:existing', 'agentTurn'],
    ['main', 'agentTurn'],
    ['isolated', 'systemEvent'],
    ['isolated', 'script'],
  ])('keeps %s / %s jobs on ordinary exec cleanup', async (sessionTarget, kind) => {
    const request = {
      job: { sessionTarget, payload: { kind } },
      abortSignal: new AbortController().signal,
      executionIdentity: { onPostAdmission: vi.fn() },
    };
    await runClawxCronJob(request, (scheduled) => throughAdmission(randomUUID(), scheduled, async (tool) => {
      expect(getClawxCronLauncher(tool, { ...args, awaitResults: true }, 1800)).toBeUndefined();
    }));
  });

  it('keeps a command outside any eligible scheduling context on ordinary exec cleanup', async () => {
    const request = { abortSignal: new AbortController().signal, executionIdentity: { onPostAdmission: vi.fn() } };
    await runClawxCronJob(request, (scheduled) => throughAdmission(randomUUID(), scheduled, async (tool) => {
      expect(getClawxCronLauncher(tool, args, 1800)).toBeUndefined();
      expect(getClawxCronLauncher(tool, { ...args, awaitResults: true }, 1800)).toBeUndefined();
    }));
  });

  it('preserves the original runner when the scheduler has no admission binding', async () => {
    const request = { abortSignal: new AbortController().signal };
    const original = vi.fn(async (input: Request) => input);
    await expect(runClawxCronJob(request, original, migrated)).resolves.toBe(request);
    expect(original).toHaveBeenCalledOnce();
  });
});
