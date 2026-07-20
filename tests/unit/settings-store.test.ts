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

  it('keeps the global workspace when removing a different recent path', async () => {
    useSettingsStore.setState({ chatWorkspacePath: '/kept' });

    await useSettingsStore.getState().removeWorkspace('/missing');

    expect(useSettingsStore.getState().chatWorkspacePath).toBe('/kept');
    expect(useSettingsStore.getState().recentWorkspacePaths).toEqual(['/kept']);
  });
});
