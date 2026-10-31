import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';

const channelsAccountsMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentModelMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();
const loadWorkspaceMock = vi.fn();
const readTextMock = vi.fn();
const writeTextMock = vi.fn();
const newSessionMock = vi.fn();
const setWorkspaceMock = vi.fn();

const { gatewayState, agentsState, providersState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    updateAgent: typeof updateAgentMock;
    updateAgentModel: typeof updateAgentModelMock;
    createAgent: ReturnType<typeof vi.fn>;
    deleteAgent: ReturnType<typeof vi.fn>;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      updateAgent: updateAgentMock,
      updateAgentModel: updateAgentModelMock,
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: {
      readText: (...args: unknown[]) => readTextMock(...args),
      writeText: (...args: unknown[]) => writeTextMock(...args),
    },
    channels: {
      accounts: (...args: unknown[]) => channelsAccountsMock(...args),
    },
  },
}));

vi.mock('@/lib/agent-workspace', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/agent-workspace')>(),
  loadAgentWorkspace: (...args: unknown[]) => loadWorkspaceMock(...args),
}));
vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign((selector: (state: { sessions: [] }) => unknown) => selector({ sessions: [] }), {
    getState: () => ({ newSession: newSessionMock }),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ setChatWorkspacePath: setWorkspaceMock }) },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onGatewayChannelStatus: (handler: unknown) => subscribeHostEventMock('gateway:channel-status', handler),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    fetchAgentsMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    loadWorkspaceMock.mockImplementation(async (workspace: string) => ({
      workspace, instructions: 'Use primary sources.\n\nPreserve all existing rules.', readOnly: false, error: null,
      files: [
        { filePath: `${workspace}/SOUL.md`, fileName: 'SOUL.md', ext: '.md', mimeType: 'text/markdown', contentType: 'document' },
      ],
    }));
    readTextMock.mockResolvedValue({ ok: true, content: 'Use primary sources.\n\nPreserve all existing rules.', readOnly: false });
    writeTextMock.mockResolvedValue({ ok: true });
    channelsAccountsMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<AgentsWithRouter />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<AgentsWithRouter />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(channelsAccountsMock).toHaveBeenCalledWith();
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<AgentsWithRouter />);
    });

    await waitFor(() => {
      expect(channelsAccountsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not render the legacy gateway warning during transient stopped status', async () => {
    gatewayState.status = { state: 'stopped', port: 18789 };

    render(<AgentsWithRouter />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText('gatewayWarning')).not.toBeInTheDocument();
  });

  const mainAgent = {
    id: 'main', name: 'Main', isDefault: true, modelDisplay: 'model-a',
    modelRef: 'custom-12345678/model-a', overrideModelRef: null,
    inheritedModel: true, workspace: '/workspace', agentDir: '/agent',
    mainSessionKey: 'agent:main:main', channelTypes: [],
  };

  it('selects a configured model in the same dialog without another modal', async () => {
    agentsState.agents = [mainAgent];
    agentsState.defaultModelRef = 'custom-12345678/model-a';
    providersState.accounts = [{ id: 'custom-12345678', label: 'Research Lab', vendorId: 'custom', authMode: 'local', enabled: true, model: 'model-a', metadata: { customModels: ['model-a', 'model-b'] }, updatedAt: '2026-10-31' }];
    render(<AgentsWithRouter />);
    fireEvent.click(screen.getByTestId('agent-manage-main'));
    const trigger = screen.getByRole('combobox', { name: 'settingsDialog.modelLabel' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'model-b' }), { key: 'Enter' });
    await waitFor(() => expect(updateAgentModelMock).toHaveBeenCalledWith('main', 'custom-12345678/model-b'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('edits the full native SOUL.md and keeps the default assistant name editable', async () => {
    agentsState.agents = [mainAgent];
    render(<AgentsWithRouter />);
    fireEvent.click(screen.getByTestId('agent-manage-main'));
    expect(screen.getByLabelText('settingsDialog.nameLabel')).not.toHaveAttribute('readonly');
    fireEvent.click(await screen.findByRole('button', { name: 'profile.editStyle' }));
    const editor = screen.getByTestId('agent-style-editor');
    expect(editor).toHaveValue('Use primary sources.\n\nPreserve all existing rules.');
    fireEvent.change(editor, { target: { value: 'New role.\n\nPreserve all existing rules.' } });
    fireEvent.click(screen.getByRole('button', { name: 'profile.saveStyle' }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('/workspace/SOUL.md', 'New role.\n\nPreserve all existing rules.'));
  });

  it('preserves a conflicting instruction draft and offers an explicit reload', async () => {
    agentsState.agents = [mainAgent];
    render(<AgentsWithRouter />);
    fireEvent.click(screen.getByTestId('agent-manage-main'));
    fireEvent.click(await screen.findByRole('button', { name: 'profile.editStyle' }));
    fireEvent.change(screen.getByTestId('agent-style-editor'), { target: { value: 'My draft' } });
    readTextMock.mockResolvedValue({ ok: true, content: 'External update', readOnly: false });
    fireEvent.click(screen.getByRole('button', { name: 'profile.saveStyle' }));
    await screen.findByRole('button', { name: 'profile.reloadStyle' });
    expect(writeTextMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('agent-style-editor')).toHaveValue('My draft');
    fireEvent.click(screen.getByRole('button', { name: 'profile.reloadStyle' }));
    expect(screen.getByTestId('agent-style-editor')).toHaveValue('External update');
  });

  it('does not offer editing when Main marks the instruction file read-only', async () => {
    agentsState.agents = [mainAgent];
    loadWorkspaceMock.mockResolvedValue({ workspace: '/workspace', instructions: 'Read-only style', readOnly: true, files: [{ fileName: 'SOUL.md', filePath: '/workspace/SOUL.md' }], error: null });
    render(<AgentsWithRouter />);
    fireEvent.click(screen.getByTestId('agent-manage-main'));
    await screen.findByText('profile.readOnlyStyle');
    expect(screen.queryByRole('button', { name: 'profile.editStyle' })).not.toBeInTheDocument();
  });

  it('keeps the last agent snapshot visible while a refresh is in flight', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5',
        modelRef: 'openai/gpt-5',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    const { rerender } = render(<AgentsWithRouter />);

    expect(await screen.findByText('Main')).toBeInTheDocument();

    agentsState.loading = true;
    await act(async () => {
      rerender(<AgentsWithRouter />);
    });

    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the blocking spinner during the initial load before any stable snapshot exists', async () => {
    agentsState.loading = true;
    fetchAgentsMock.mockImplementation(() => new Promise(() => {}));
    refreshProviderSnapshotMock.mockImplementation(() => new Promise(() => {}));
    channelsAccountsMock.mockImplementation(() => new Promise(() => {}));

    const { container } = render(<AgentsWithRouter />);

    expect(container.querySelector('svg.animate-spin')).toBeTruthy();
    expect(screen.getByText('title')).toBeInTheDocument();
  });
});

function AgentsWithRouter() { return <MemoryRouter><Agents /></MemoryRouter>; }
