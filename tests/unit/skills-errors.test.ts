import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.fn();
const localMock = vi.fn();
const clawhubSearchMock = vi.fn();
const clawhubInstallMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    skills: {
      status: () => statusMock(),
      local: () => localMock(),
      clawhubSearch: (input: unknown) => clawhubSearchMock(input),
      clawhubInstall: (input: unknown) => clawhubInstallMock(input),
      clawhubUninstall: vi.fn(),
      updateConfigs: vi.fn(),
    },
  },
}));

describe('skills store error mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('maps fetchSkills rate-limit error when both local and gateway loading fail', async () => {
    statusMock.mockRejectedValueOnce(new Error('gateway unavailable'));
    localMock.mockRejectedValueOnce(new Error('rate limit exceeded'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().fetchSkills();

    expect(useSkillsStore.getState().error).toBe('fetchRateLimitError');
  });

  it('maps searchSkills timeout error by AppError code', async () => {
    clawhubSearchMock.mockRejectedValueOnce(new Error('request timeout'));

    const { useSkillsStore } = await import('@/stores/skills');
    await useSkillsStore.getState().searchSkills('git');

    expect(clawhubSearchMock).toHaveBeenCalledWith({ query: 'git' });
    expect(useSkillsStore.getState().searchError).toBe('searchTimeoutError');
  });

  it('maps installSkill timeout result into installTimeoutError', async () => {
    clawhubInstallMock.mockResolvedValueOnce({ success: false, error: 'request timeout' });

    const { useSkillsStore } = await import('@/stores/skills');
    await expect(useSkillsStore.getState().installSkill('demo-skill')).rejects.toThrow('installTimeoutError');
    expect(clawhubInstallMock).toHaveBeenCalledWith({ slug: 'demo-skill', version: undefined });
  });
});
