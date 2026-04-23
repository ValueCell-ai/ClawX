import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      rpc: (...args: unknown[]) => rpcMock(...args),
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

describe('skills store fetch parallelization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('starts clawhub and config requests before gateway rpc resolves', async () => {
    const gatewayDeferred = deferred<{ skills: Array<Record<string, unknown>> }>();
    rpcMock.mockReturnValueOnce(gatewayDeferred.promise);
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (path === '/api/clawhub/list') return Promise.resolve({ success: true, results: [] });
      if (path === '/api/skills/configs') return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected path: ${String(path)}`));
    });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await Promise.resolve();

    expect(rpcMock).toHaveBeenCalledWith('skills.status');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/clawhub/list');
    expect(hostApiFetchMock).toHaveBeenCalledWith('/api/skills/configs');

    gatewayDeferred.resolve({ skills: [] });
    await fetchPromise;
  });
});
