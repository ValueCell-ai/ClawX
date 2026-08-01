// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  authoritativeConfig: {} as Record<string, unknown>,
}));

const { mutateOpenClawConfigMock, readOpenClawConfigSnapshotMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  mutateOpenClawConfigMock: vi.fn(),
  readOpenClawConfigSnapshotMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readFile: readFileMock,
    writeFile: writeFileMock,
  };
});

vi.mock('@electron/gateway/config-delivery', () => ({
  mutateOpenClawConfig: mutateOpenClawConfigMock,
  readOpenClawConfigSnapshot: readOpenClawConfigSnapshotMock,
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/runtime/openclaw',
  getOpenClawResolvedDir: () => '/runtime/openclaw',
  getResourcesDir: () => '/resources',
  resolveOpenClawConfigPath: () => '/configured/openclaw.json5',
}));

describe('skill config mutations', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.authoritativeConfig = {};
    readFileMock.mockResolvedValue(JSON.stringify({ staleLocalValue: true }));
    writeFileMock.mockResolvedValue(undefined);
    readOpenClawConfigSnapshotMock.mockImplementation(async () => ({
      config: structuredClone(state.authoritativeConfig),
      exists: true,
    }));
    mutateOpenClawConfigMock.mockImplementation(async (
      mutator: (config: Record<string, unknown>) => void | Promise<void>,
    ) => {
      const before = structuredClone(state.authoritativeConfig);
      await mutator(state.authoritativeConfig);
      return JSON.stringify(before) !== JSON.stringify(state.authoritativeConfig);
    });
  });

  it('updates the coordinator authoritative snapshot without replacing it from a local read', async () => {
    state.authoritativeConfig = {
      gatewayOnly: true,
      skills: {
        entries: {
          existing: { enabled: false },
        },
      },
    };

    const { updateSkillConfig } = await import('@electron/utils/skill-config');
    const result = await updateSkillConfig('new-skill', { enabled: true, apiKey: ' key ' });

    expect(result).toEqual({ success: true });
    expect(state.authoritativeConfig).toEqual({
      gatewayOnly: true,
      skills: {
        entries: {
          existing: { enabled: false },
          'new-skill': { enabled: true, apiKey: 'key' },
        },
      },
    });
    expect(mutateOpenClawConfigMock).toHaveBeenCalledOnce();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('counts removals from the coordinator authoritative snapshot', async () => {
    state.authoritativeConfig = {
      skills: {
        entries: {
          present: { enabled: true },
          keep: { apiKey: 'secret' },
        },
      },
    };

    const { removeSkillConfigs } = await import('@electron/utils/skill-config');
    const result = await removeSkillConfigs([' present ', 'missing']);

    expect(result).toEqual({ success: true, removed: 1 });
    expect(state.authoritativeConfig).toEqual({
      skills: {
        entries: {
          keep: { apiKey: 'secret' },
        },
      },
    });
    expect(mutateOpenClawConfigMock).toHaveBeenCalledOnce();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('reads skill config from the coordinator snapshot instead of the local file', async () => {
    state.authoritativeConfig = {
      skills: { entries: { authoritative: { enabled: true } } },
    };
    const { getSkillConfig } = await import('@electron/utils/skill-config');

    await expect(getSkillConfig('authoritative')).resolves.toEqual({ enabled: true });
    expect(readOpenClawConfigSnapshotMock).toHaveBeenCalledOnce();
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
