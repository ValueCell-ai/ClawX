import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAgentMock,
  deleteAgentMock,
  reconcileAgentSessionTombstonesMock,
  removeAgentSessionsMock,
} = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  deleteAgentMock: vi.fn(),
  reconcileAgentSessionTombstonesMock: vi.fn(),
  removeAgentSessionsMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agents: {
      create: createAgentMock,
      delete: deleteAgentMock,
    },
  },
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      reconcileAgentSessionTombstones: reconcileAgentSessionTombstonesMock,
      removeAgentSessions: removeAgentSessionsMock,
    }),
  },
}));

import { useAgentsStore } from '@/stores/agents';

const survivingSnapshot = {
  agents: [{ id: 'main', name: 'Main Agent' }],
  defaultAgentId: 'main',
  defaultModelRef: null,
  configuredChannelTypes: [],
  channelOwners: {},
  channelAccountOwners: {},
};

describe('agents store deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentsStore.setState({
      agents: [
        { id: 'main', name: 'Main Agent' },
        { id: 'test1', name: 'Test Agent' },
      ] as never,
      defaultAgentId: 'main',
      loading: false,
      error: null,
    });
  });

  it('forgets renderer sessions only after Main confirms agent deletion', async () => {
    deleteAgentMock.mockResolvedValue(survivingSnapshot);

    await useAgentsStore.getState().deleteAgent('test1');

    expect(deleteAgentMock).toHaveBeenCalledWith('test1');
    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledWith(['main']);
    expect(removeAgentSessionsMock).toHaveBeenCalledWith('test1');
    expect(useAgentsStore.getState().agents).toEqual(survivingSnapshot.agents);
  });

  it('clears a deleted-agent tombstone when an authoritative create snapshot restores its id', async () => {
    const recreatedSnapshot = {
      ...survivingSnapshot,
      agents: [
        ...survivingSnapshot.agents,
        { id: 'test1', name: 'Recreated Agent' },
      ],
    };
    createAgentMock.mockResolvedValue(recreatedSnapshot);

    await useAgentsStore.getState().createAgent('Recreated Agent');

    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledWith(['main', 'test1']);
  });

  it('preserves renderer sessions when Main rejects agent deletion', async () => {
    deleteAgentMock.mockRejectedValue(new Error('delete failed'));

    await expect(useAgentsStore.getState().deleteAgent('test1')).rejects.toThrow('delete failed');

    expect(removeAgentSessionsMock).not.toHaveBeenCalled();
    expect(reconcileAgentSessionTombstonesMock).not.toHaveBeenCalled();
    expect(useAgentsStore.getState().agents.map((agent) => agent.id)).toEqual(['main', 'test1']);
  });
});
