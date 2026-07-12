import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const hostApiTriggerMock = vi.fn();
const hostApiDeleteMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
  hostApi: {
    cron: {
      list: () => hostApiFetchMock('/api/cron/jobs'),
      trigger: (id: string) => hostApiTriggerMock(id),
      delete: (id: string) => hostApiDeleteMock(id),
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('does not invoke cron.run when the selected runtime marks it unsupported', async () => {
    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({
      status: {
        state: 'running',
        port: 18789,
        operationCapabilities: {
          'cron.run': {
            capability: 'cron',
            support: 'unsupported',
            notes: 'manual cron execution is unavailable',
          },
        },
      },
    });

    await expect(useCronStore.getState().triggerJob('job-1'))
      .rejects.toThrow('Runtime operation cron.run is unavailable');
    expect(hostApiFetchMock).not.toHaveBeenCalled();
  });

  it('refreshes an asynchronously-triggered job until its last run changes', async () => {
    vi.useFakeTimers();
    const pendingJob = {
      id: 'job-1',
      name: 'Async job',
      message: 'run',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      agentId: 'main',
      timeoutMins: 3,
    };
    const completedJob = {
      ...pendingJob,
      lastRun: { time: '2026-07-13T01:00:00.000Z', success: true },
    };
    hostApiTriggerMock.mockResolvedValueOnce({ success: true });
    hostApiFetchMock
      .mockResolvedValueOnce([pendingJob])
      .mockResolvedValueOnce([completedJob]);

    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'cc-connect' } });
    useCronStore.setState({ jobs: [pendingJob as never], loading: false, error: null });

    await useCronStore.getState().triggerJob('job-1');
    expect(hostApiTriggerMock).toHaveBeenCalledWith('job-1');
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(useCronStore.getState().jobs[0]?.lastRun).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
    expect(useCronStore.getState().jobs[0]?.lastRun).toEqual(completedJob.lastRun);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hostApiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels completion observation when the job is deleted', async () => {
    vi.useFakeTimers();
    const pendingJob = {
      id: 'job-1',
      name: 'Deleted job',
      message: 'run',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      agentId: 'main',
    };
    hostApiTriggerMock.mockResolvedValueOnce({ success: true });
    hostApiDeleteMock.mockResolvedValueOnce({ success: true });
    hostApiFetchMock.mockResolvedValueOnce([pendingJob]);

    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'cc-connect' } });
    useCronStore.setState({ jobs: [pendingJob as never], loading: false, error: null });

    await useCronStore.getState().triggerJob('job-1');
    await useCronStore.getState().deleteJob('job-1');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(hostApiDeleteMock).toHaveBeenCalledWith('job-1');
    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(useCronStore.getState().jobs).toEqual([]);
  });

  it('supersedes the prior completion observation when a job is triggered again', async () => {
    vi.useFakeTimers();
    const pendingJob = {
      id: 'job-1',
      name: 'Repeated job',
      message: 'run',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      agentId: 'main',
    };
    const completedJob = {
      ...pendingJob,
      lastRun: { time: '2026-07-13T01:00:00.000Z', success: true },
    };
    hostApiTriggerMock.mockResolvedValue({ success: true });
    hostApiFetchMock
      .mockResolvedValueOnce([pendingJob])
      .mockResolvedValueOnce([pendingJob])
      .mockResolvedValueOnce([completedJob]);

    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'cc-connect' } });
    useCronStore.setState({ jobs: [pendingJob as never], loading: false, error: null });

    await useCronStore.getState().triggerJob('job-1');
    await useCronStore.getState().triggerJob('job-1');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(hostApiTriggerMock).toHaveBeenCalledTimes(2);
    expect(hostApiFetchMock).toHaveBeenCalledTimes(3);
    expect(useCronStore.getState().jobs[0]?.lastRun).toEqual(completedJob.lastRun);
  });

  it('stops completion observation when the selected runtime changes', async () => {
    vi.useFakeTimers();
    const pendingJob = {
      id: 'job-1',
      name: 'Runtime switch job',
      message: 'run',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      agentId: 'main',
    };
    hostApiTriggerMock.mockResolvedValueOnce({ success: true });
    hostApiFetchMock.mockResolvedValueOnce([pendingJob]);

    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'cc-connect' } });
    useCronStore.setState({ jobs: [pendingJob as never], loading: false, error: null });

    await useCronStore.getState().triggerJob('job-1');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'openclaw' } });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(hostApiFetchMock).toHaveBeenCalledTimes(1);
    expect(useCronStore.getState().jobs[0]?.lastRun).toBeUndefined();
  });

  it('uses the runtime default timeout when timeoutMins is zero', async () => {
    vi.useFakeTimers();
    const pendingJob = {
      id: 'job-1',
      name: 'Default timeout job',
      message: 'run',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
      agentId: 'main',
      timeoutMins: 0,
    };
    hostApiTriggerMock.mockResolvedValueOnce({ success: true });
    hostApiDeleteMock.mockResolvedValueOnce({ success: true });
    hostApiFetchMock.mockResolvedValue([pendingJob]);

    const { useGatewayStore } = await import('@/stores/gateway');
    const { useCronStore } = await import('@/stores/cron');
    useGatewayStore.setState({ status: { state: 'running', port: 18789, runtimeKind: 'cc-connect' } });
    useCronStore.setState({ jobs: [pendingJob as never], loading: false, error: null });

    await useCronStore.getState().triggerJob('job-1');
    await vi.advanceTimersByTimeAsync(90_000);

    expect(hostApiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(10);
    await useCronStore.getState().deleteJob('job-1');
  });
});
