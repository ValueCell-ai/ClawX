import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSettingMock = vi.fn();
const setSettingMock = vi.fn();

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

describe('skill-policy utils', () => {
  const memory = new Map<string, unknown>();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    memory.clear();

    getSettingMock.mockImplementation(async (key: string) => memory.get(key));
    setSettingMock.mockImplementation(async (key: string, value: unknown) => {
      memory.set(key, value);
    });
  });

  it('migrates legacy enabled/disabled settings when policy is uninitialized', async () => {
    memory.set('skillPolicy', { globalEnabled: [], agentOverrides: {} });
    memory.set('skillPolicyInitialized', false);
    memory.set('enabledSkills', ['alpha', 'beta']);
    memory.set('disabledSkills', ['beta']);

    const { readSkillPolicy } = await import('@electron/utils/skill-policy');
    const policy = await readSkillPolicy();

    expect(policy.globalEnabled).toEqual(['alpha']);
    expect(policy.agentOverrides).toEqual({});
    expect(setSettingMock).toHaveBeenCalledWith('skillPolicyInitialized', true);
  });

  it('computes effective skills from global baseline and agent override', async () => {
    const { computeEffectiveSkills } = await import('@electron/utils/skill-policy');
    const effective = computeEffectiveSkills(
      {
        globalEnabled: ['alpha', 'beta'],
        agentOverrides: {
          writer: {
            enabled: ['gamma'],
            disabled: ['beta'],
          },
        },
      },
      'writer',
    );

    expect(effective).toEqual(['alpha', 'gamma']);
  });

  it('normalizes overlap and removes empty agent override entries', async () => {
    memory.set('skillPolicy', { globalEnabled: ['base'], agentOverrides: {} });
    memory.set('skillPolicyInitialized', true);
    memory.set('enabledSkills', []);
    memory.set('disabledSkills', []);

    const { updateSkillPolicyAgentOverride } = await import('@electron/utils/skill-policy');
    await updateSkillPolicyAgentOverride('writer', {
      enabled: ['base', 'plus', 'plus'],
      disabled: ['plus', 'base', 'minus', 'minus'],
    });

    const policyAfterFirstWrite = memory.get('skillPolicy') as {
      globalEnabled: string[];
      agentOverrides: Record<string, { enabled?: string[]; disabled?: string[] }>;
    };
    expect(policyAfterFirstWrite.agentOverrides.writer).toEqual({
      enabled: ['base', 'plus'],
      disabled: ['minus'],
    });

    await updateSkillPolicyAgentOverride('writer', {
      enabled: [],
      disabled: [],
    });

    const policyAfterCleanup = memory.get('skillPolicy') as {
      globalEnabled: string[];
      agentOverrides: Record<string, { enabled?: string[]; disabled?: string[] }>;
    };
    expect(policyAfterCleanup.agentOverrides.writer).toBeUndefined();
  });
});
