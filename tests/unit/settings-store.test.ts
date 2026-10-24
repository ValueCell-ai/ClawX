import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';

const settingsSetMany = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    settings: {
      getAll: vi.fn(),
      set: vi.fn(),
      setMany: settingsSetMany,
    },
  },
}));

import { useSettingsStore } from '@/stores/settings';

describe('settings workspace cleanup', () => {
  beforeEach(() => {
    settingsSetMany.mockReset();
    settingsSetMany.mockResolvedValue({ success: true });
    useSettingsStore.setState({
      chatWorkspacePath: '/missing',
      recentWorkspacePaths: ['/missing', '/kept'],
      workspaceLabels: {
        '/missing': 'Missing project',
        '/kept': 'Kept project',
      },
    });
  });

  it('removes workspace metadata and resets a matching global workspace', async () => {
    await useSettingsStore.getState().removeWorkspace('/missing/');

    const state = useSettingsStore.getState();
    expect(state.chatWorkspacePath).toBe(DEFAULT_WORKSPACE_CWD);
    expect(state.recentWorkspacePaths).toEqual([DEFAULT_WORKSPACE_CWD, '/kept']);
    expect(state.workspaceLabels).toEqual({ '/kept': 'Kept project' });
    expect(settingsSetMany).toHaveBeenCalledWith({
      chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
      recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD, '/kept'],
      workspaceLabels: { '/kept': 'Kept project' },
    });
  });

  it('removes configured and resolved aliases in one persisted update', async () => {
    useSettingsStore.setState({
      chatWorkspacePath: '/Users/test/.openclaw/workspace-agent',
      recentWorkspacePaths: [
        '~/.openclaw/workspace-agent',
        '/Users/test/.openclaw/workspace-agent',
        '/kept',
      ],
      workspaceLabels: {
        '~/.openclaw/workspace-agent': 'Configured path',
        '/Users/test/.openclaw/workspace-agent': 'Resolved path',
        '/kept': 'Kept project',
      },
    });

    await useSettingsStore.getState().removeWorkspace(
      '/Users/test/.openclaw/workspace-agent',
      ['~/.openclaw/workspace-agent'],
    );

    expect(useSettingsStore.getState()).toMatchObject({
      chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
      recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD, '/kept'],
      workspaceLabels: { '/kept': 'Kept project' },
    });
    expect(settingsSetMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the global workspace when removing a different recent path', async () => {
    useSettingsStore.setState({ chatWorkspacePath: '/kept' });

    await useSettingsStore.getState().removeWorkspace('/missing');

    expect(useSettingsStore.getState().chatWorkspacePath).toBe('/kept');
    expect(useSettingsStore.getState().recentWorkspacePaths).toEqual(['/kept']);
  });

  it('preserves the first imported workspace name when a duplicate is added', () => {
    const firstWorkspace = '/repo/z/发票';
    const secondWorkspace = '/repo/a/发票';
    useSettingsStore.setState({
      chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
      recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD],
      workspaceLabels: {},
    });

    useSettingsStore.getState().setChatWorkspacePath(firstWorkspace);
    useSettingsStore.getState().setChatWorkspacePath(secondWorkspace);
    useSettingsStore.getState().setChatWorkspacePath(firstWorkspace);

    expect(useSettingsStore.getState().workspaceLabels).toMatchObject({
      [firstWorkspace]: '发票',
      [secondWorkspace]: '发票1',
    });
  });
});

describe('durable task pins', () => {
  it('serializes rapid pin changes and removes only explicitly deleted keys', async () => {
    const { hostApi } = await import('@/lib/host-api');
    const save = vi.mocked(hostApi.settings.set).mockResolvedValue({ success: true });
    save.mockClear();
    useSettingsStore.setState({ pinnedSessionKeys: [] });
    await Promise.all([
      useSettingsStore.getState().toggleSessionPin('agent:main:a'),
      useSettingsStore.getState().toggleSessionPin('agent:code:b'),
      useSettingsStore.getState().toggleSessionPin('agent:main:a'),
    ]);
    expect(save.mock.calls).toEqual([
      ['pinnedSessionKeys', ['agent:main:a']],
      ['pinnedSessionKeys', ['agent:code:b', 'agent:main:a']],
      ['pinnedSessionKeys', ['agent:code:b']],
    ]);
    await useSettingsStore.getState().removePinnedSessions(['agent:main:a']);
    expect(useSettingsStore.getState().pinnedSessionKeys).toEqual(['agent:code:b']);
    await useSettingsStore.getState().removePinnedSessions(['agent:code:b']);
    expect(useSettingsStore.getState().pinnedSessionKeys).toEqual([]);
  });
  it('restores the last state when a pin cannot be saved', async () => {
    const { hostApi } = await import('@/lib/host-api');
    vi.mocked(hostApi.settings.set).mockRejectedValueOnce(new Error('disk unavailable'));
    useSettingsStore.setState({ pinnedSessionKeys: ['agent:main:kept'] });
    await expect(useSettingsStore.getState().toggleSessionPin('agent:main:new')).rejects.toThrow('disk unavailable');
    expect(useSettingsStore.getState().pinnedSessionKeys).toEqual(['agent:main:kept']);
  });
});
