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

  it('does not block initial skills state on slow clawhub list', async () => {
    const clawhubDeferred = deferred<{ success: boolean; results: Array<{ slug: string; version: string; source: string; baseDir: string }> }>();
    rpcMock.mockResolvedValueOnce({
      skills: [
        {
          skillKey: 'demo-skill',
          slug: 'demo-skill',
          name: 'Demo Skill',
          description: 'Gateway skill',
          disabled: false,
          version: '1.0.0',
          source: 'openclaw-bundled',
        },
      ],
    });
    hostApiFetchMock.mockImplementation((path: unknown) => {
      if (path === '/api/clawhub/list') return clawhubDeferred.promise;
      if (path === '/api/skills/configs') return Promise.resolve({});
      return Promise.reject(new Error(`Unexpected path: ${String(path)}`));
    });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().loading).toBe(false);
    expect(useSkillsStore.getState().skills).toEqual([
      expect.objectContaining({
        id: 'demo-skill',
        name: 'Demo Skill',
        source: 'openclaw-bundled',
      }),
    ]);

    clawhubDeferred.resolve({
      success: true,
      results: [
        {
          slug: 'later-skill',
          version: '2.0.0',
          source: 'openclaw-managed',
          baseDir: '/tmp/later-skill',
        },
      ],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(useSkillsStore.getState().skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'demo-skill',
      }),
      expect.objectContaining({
        id: 'later-skill',
        baseDir: '/tmp/later-skill',
      }),
    ]));
  });
});
