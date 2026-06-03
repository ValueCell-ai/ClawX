import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.fn();
const localMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      status: () => statusMock(),
      local: () => localMock(),
      clawhubSearch: vi.fn(),
      clawhubInstall: vi.fn(),
      clawhubUninstall: vi.fn(),
      updateConfigs: vi.fn(),
    },
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

describe('skills store local-first fetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('starts local and gateway requests together, then returns after local skills load', async () => {
    const gatewayDeferred = deferred<{ skills: Array<Record<string, unknown>> }>();
    const localDeferred = deferred<{ success: boolean; skills: Array<Record<string, unknown>> }>();
    statusMock.mockReturnValueOnce(gatewayDeferred.promise);
    localMock.mockReturnValueOnce(localDeferred.promise);

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await Promise.resolve();

    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(localMock).toHaveBeenCalledTimes(1);

    localDeferred.resolve({
      success: true,
      skills: [{ id: 'pdf', name: 'PDF', description: 'local', enabled: true }],
    });

    await expect(fetchPromise).resolves.toBe(true);
    expect(useSkillsStore.getState().skills).toHaveLength(1);
    expect(useSkillsStore.getState().skills[0]).toMatchObject({ id: 'pdf', description: 'local', enabled: true });

    gatewayDeferred.resolve({
      skills: [{ skillKey: 'pdf', description: 'runtime', disabled: false, version: '2.0.0' }],
    });

    await vi.waitFor(() => {
      expect(useSkillsStore.getState().skills[0]).toMatchObject({
        id: 'pdf',
        description: 'runtime',
        version: '2.0.0',
        enabled: true,
      });
    });
  });

  it('does not append bundled gateway skills that are missing from local scan', async () => {
    const gatewayDeferred = deferred<{ skills: Array<Record<string, unknown>> }>();
    statusMock.mockReturnValueOnce(gatewayDeferred.promise);
    localMock.mockResolvedValueOnce({ success: true, skills: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await expect(fetchPromise).resolves.toBe(true);

    gatewayDeferred.resolve({
      skills: [
        { skillKey: 'browser-use', slug: 'browser-use', name: 'browser-use', bundled: true, disabled: false },
        { skillKey: 'skill-creator', slug: 'skill-creator', name: 'skill-creator', bundled: true, disabled: false },
      ],
    });

    await vi.waitFor(() => {
      expect(useSkillsStore.getState().skills.map((skill) => skill.id)).toEqual([]);
    });
  });

  it('does not resurrect gateway-managed skills that are missing from local scan', async () => {
    const gatewayDeferred = deferred<{ skills: Array<Record<string, unknown>> }>();
    statusMock.mockReturnValueOnce(gatewayDeferred.promise);
    localMock.mockResolvedValueOnce({ success: true, skills: [] });

    const { useSkillsStore } = await import('@/stores/skills');
    useSkillsStore.setState({ skills: [], loading: false, error: null });

    const fetchPromise = useSkillsStore.getState().fetchSkills();
    await expect(fetchPromise).resolves.toBe(true);

    gatewayDeferred.resolve({
      skills: [
        { skillKey: 'agent-browser', slug: 'agent-browser', name: 'agent-browser', source: 'openclaw-managed', disabled: false },
        { skillKey: 'plugin-skill', slug: 'plugin-skill', name: 'plugin-skill', source: 'openclaw-plugin', disabled: false },
      ],
    });

    await vi.waitFor(() => {
      expect(useSkillsStore.getState().skills.map((skill) => skill.id)).toEqual(['plugin-skill']);
    });
  });
});
