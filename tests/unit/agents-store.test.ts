import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAgentMock,
  deleteAgentMock,
  listAgentsMock,
  reconcileAgentSessionTombstonesMock,
  removeAgentSessionsMock,
} = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  deleteAgentMock: vi.fn(),
  listAgentsMock: vi.fn(),
  reconcileAgentSessionTombstonesMock: vi.fn(),
  removeAgentSessionsMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    agents: {
      create: createAgentMock,
      delete: deleteAgentMock,
      list: listAgentsMock,
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

  it('ignores an older list snapshot that resolves after a confirmed deletion', async () => {
    let resolveList!: (snapshot: typeof survivingSnapshot & { agents: Array<{ id: string; name: string }> }) => void;
    listAgentsMock.mockReturnValue(new Promise((resolve) => {
      resolveList = resolve;
    }));
    deleteAgentMock.mockResolvedValue(survivingSnapshot);

    const pendingFetch = useAgentsStore.getState().fetchAgents();
    await useAgentsStore.getState().deleteAgent('test1');
    resolveList({
      ...survivingSnapshot,
      agents: [
        ...survivingSnapshot.agents,
        { id: 'test1', name: 'Stale Agent' },
      ],
    });
    await pendingFetch;

    expect(useAgentsStore.getState().agents).toEqual(survivingSnapshot.agents);
    expect(useAgentsStore.getState().loading).toBe(false);
    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledTimes(1);
    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledWith(['main']);
  });

  it('keeps the newest list snapshot when overlapping refreshes resolve out of order', async () => {
    let resolveOlderList!: (snapshot: typeof survivingSnapshot) => void;
    let resolveNewerList!: (snapshot: typeof survivingSnapshot) => void;
    listAgentsMock
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOlderList = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveNewerList = resolve;
      }));
    const newerSnapshot = {
      ...survivingSnapshot,
      agents: [{ id: 'main', name: 'Newest Main Agent' }],
    };

    const olderFetch = useAgentsStore.getState().fetchAgents();
    const newerFetch = useAgentsStore.getState().fetchAgents();
    resolveNewerList(newerSnapshot);
    await newerFetch;
    resolveOlderList(survivingSnapshot);
    await olderFetch;

    expect(useAgentsStore.getState().agents).toEqual(newerSnapshot.agents);
    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledTimes(1);
    expect(reconcileAgentSessionTombstonesMock).toHaveBeenCalledWith(['main']);
  });

  it('ignores an older list failure that rejects after a confirmed deletion', async () => {
    let rejectList!: (error: Error) => void;
    listAgentsMock.mockReturnValue(new Promise((_resolve, reject) => {
      rejectList = reject;
    }));
    deleteAgentMock.mockResolvedValue(survivingSnapshot);

    const pendingFetch = useAgentsStore.getState().fetchAgents();
    await useAgentsStore.getState().deleteAgent('test1');
    rejectList(new Error('stale list failure'));
    await pendingFetch;

    expect(useAgentsStore.getState().error).toBeNull();
    expect(useAgentsStore.getState().loading).toBe(false);
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
