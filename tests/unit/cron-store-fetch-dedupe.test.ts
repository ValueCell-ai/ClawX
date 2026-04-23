import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
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
});
