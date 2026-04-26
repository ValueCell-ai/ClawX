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

describe('skills store slug matching', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('matches ClawHub skill to gateway skill when gateway slug differs from skillKey', async () => {
    // Gateway returns skillKey "foo-v2" but slug "foo"
    rpcMock.mockResolvedValueOnce({
      skills: [{ skillKey: 'foo-v2', slug: 'foo', name: 'Foo Skill', description: 'A skill', disabled: false }],
    });
    // ClawHub lists "foo" as installed (matching by slug, not skillKey)
    hostApiFetchMock
      .mockResolvedValueOnce({ success: true, results: [{ slug: 'foo', version: '1.0.0' }] })
      .mockResolvedValueOnce({});

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    const skills = useSkillsStore.getState().skills;
    // Should be exactly one skill, not two (no placeholder duplicate)
    expect(skills).toHaveLength(1);
    // The skill should be the gateway skill (not the "Recently installed" placeholder)
    expect(skills[0].name).toBe('Foo Skill');
    expect(skills[0].description).not.toBe('Recently installed, initializing...');
  });
});

describe('skills store error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('maps fetchSkills rate-limit error by AppError code', async () => {
    rpcMock.mockResolvedValueOnce({ skills: [] });
    hostApiFetchMock.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().error).toBe('fetchRateLimitError');
  });

  it('maps searchSkills timeout error by AppError code', async () => {
    hostApiFetchMock.mockRejectedValueOnce(new Error('request timeout'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().searchSkills('git');

    expect(useSkillsStore.getState().searchError).toBe('searchTimeoutError');
  });

  it('maps installSkill timeout result into installTimeoutError', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: false, error: 'request timeout' });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('demo-skill')).rejects.toThrow('installTimeoutError');
  });
});
