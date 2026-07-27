import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    cron: {
      list: () => hostApiFetchMock('/api/cron/jobs'),
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
