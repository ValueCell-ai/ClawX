import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const triggerMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    cron: {
      list: () => hostApiFetchMock('/api/cron/jobs'),
      trigger: (id: string) => triggerMock(id),
    },
  },
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      currentAgentId: 'main',
    }),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('cron store fetchJobs dedupe', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    hostApiFetchMock.mockReset();
    triggerMock.mockReset().mockResolvedValue({ ok: true, queued: true });
  });

  it('reuses in-flight fetchJobs request when called concurrently', async () => {
    const listDeferred = deferred<Array<{ id: string }>>();
    hostApiFetchMock.mockReturnValueOnce(listDeferred.promise);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ jobs: [], loading: false, error: null });

    const first = useCronStore.getState().fetchJobs();
    const second = useCronStore.getState().fetchJobs();
    await Promise.resolve();

    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/cron/jobs');

    listDeferred.resolve([{ id: 'job-1' }]);
    await Promise.all([first, second]);

    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['job-1']);
  });

  it.each([true, false])('coalesces completion refreshes behind an older list and keeps final success=%s', async (success) => {
    const oldList = deferred<Array<{ id: string }>>();
    const completedJob = {
      id: 'water-job',
      lastRun: {
        time: '2026-11-10T08:40:00Z', success,
        ...(success ? {} : { error: 'model connection timed out' }),
      },
    };
    hostApiFetchMock.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([completedJob]);
    const { useCronStore } = await import('@/stores/cron');

    const ordinary = useCronStore.getState().fetchJobs();
    await Promise.resolve();
    const completion = useCronStore.getState().fetchJobs({ force: true });
    const concurrentCompletion = useCronStore.getState().fetchJobs({ force: true });
    const concurrentOrdinary = useCronStore.getState().fetchJobs();
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    oldList.resolve([{ id: 'water-job' }]);
    await Promise.all([ordinary, completion, concurrentCompletion, concurrentOrdinary]);

    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    expect(useCronStore.getState()).toMatchObject({ jobs: [completedJob], loading: false, error: null });
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('reconciles a queue acknowledgement through the same list reader without rerunning the task', async () => {
    const oldList = deferred<Array<{ id: string }>>();
    const completedJob = {
      id: 'water-job', lastRun: { time: '2026-11-10T08:40:00Z', success: true },
    };
    hostApiFetchMock.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([completedJob]);
    const { useCronStore } = await import('@/stores/cron');

    const ordinary = useCronStore.getState().fetchJobs();
    await Promise.resolve();
    const triggered = useCronStore.getState().triggerJob('water-job');
    await Promise.resolve();
    const completion = useCronStore.getState().fetchJobs({ force: true });
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    oldList.resolve([{ id: 'water-job' }]);
    await Promise.all([ordinary, triggered, completion]);

    expect(triggerMock).toHaveBeenCalledExactlyOnceWith('water-job');
    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    expect(useCronStore.getState().jobs).toEqual([completedJob]);
  });

  it('still performs a queued completion refresh when the older read fails', async () => {
    const oldList = deferred<Array<{ id: string }>>();
    const completedJob = {
      id: 'water-job', lastRun: { time: '2026-11-10T08:40:00Z', success: false, error: 'run failed' },
    };
    hostApiFetchMock.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([completedJob]);
    const { useCronStore } = await import('@/stores/cron');

    const ordinary = useCronStore.getState().fetchJobs();
    await Promise.resolve();
    const completion = useCronStore.getState().fetchJobs({ force: true });
    oldList.reject(new Error('old list read failed'));
    await Promise.all([ordinary, completion]);

    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    expect(useCronStore.getState()).toMatchObject({ jobs: [completedJob], loading: false, error: null });
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('does not lose a forced refresh arriving while the previous read settles', async () => {
    const oldList = deferred<Array<{ id: string }>>();
    const completedJob = {
      id: 'water-job', lastRun: { time: '2026-11-10T08:40:00Z', success: true },
    };
    hostApiFetchMock.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([completedJob]);
    const { useCronStore } = await import('@/stores/cron');

    const ordinary = useCronStore.getState().fetchJobs();
    await Promise.resolve();
    oldList.resolve([{ id: 'water-job' }]);
    const completion = Promise.resolve().then(() => useCronStore.getState().fetchJobs({ force: true }));
    await Promise.all([ordinary, completion]);

    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    expect(useCronStore.getState().jobs).toEqual([completedJob]);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('preserves the last task state on a failed forced refresh and allows a later retry', async () => {
    const job = {
      id: 'water-job', lastRun: { time: '2026-11-10T08:40:00Z', success: true },
    };
    hostApiFetchMock
      .mockResolvedValueOnce([job])
      .mockRejectedValueOnce(new Error('list unavailable'))
      .mockResolvedValueOnce([]);
    const { useCronStore } = await import('@/stores/cron');
    await useCronStore.getState().fetchJobs();

    await useCronStore.getState().fetchJobs({ force: true });
    expect(useCronStore.getState()).toMatchObject({ jobs: [job], loading: false });
    expect(useCronStore.getState().error).toContain('list unavailable');
    await useCronStore.getState().fetchJobs({ force: true });

    expect(hostApiFetchMock).toHaveBeenCalledTimes(3);
    expect(useCronStore.getState()).toMatchObject({ jobs: [], loading: false, error: null });
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('drops a cached job the Gateway no longer returns once it is past the create grace window', async () => {
    // Simulates a one-time `at` task the runtime auto-deleted after it ran.
    const staleJob = {
      id: 'once-job',
      name: 'one-time',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    hostApiFetchMock.mockResolvedValueOnce([{ id: 'recurring-job' }]);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ jobs: [staleJob as never], loading: false, error: null });

    await useCronStore.getState().fetchJobs();

    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['recurring-job']);
  });

  it('preserves a just-created cached job the Gateway has not surfaced yet', async () => {
    // Bridges the brief race where an optimistic create is not yet in cron.list.
    const freshJob = {
      id: 'fresh-job',
      name: 'fresh',
      createdAt: new Date().toISOString(),
    };
    hostApiFetchMock.mockResolvedValueOnce([{ id: 'recurring-job' }]);

    const { useCronStore } = await import('@/stores/cron');
    useCronStore.setState({ jobs: [freshJob as never], loading: false, error: null });

    await useCronStore.getState().fetchJobs();

    expect(useCronStore.getState().jobs.map((job) => job.id)).toEqual(['recurring-job', 'fresh-job']);
  });
});
