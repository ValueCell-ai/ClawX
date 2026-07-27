import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

const { acpState, agentsState, artifactPanelState, chatState, gatewayState, stickState } = vi.hoisted(() => ({
  acpState: {
    timeline: null as AcpTimelineSnapshot | null,
    loading: false,
    sending: false,
    cancelling: false,
    error: null as string | null,
    activeSessionKey: 'agent:main:main' as string | null,
    workspaceRoot: null as string | null,
    cwd: null as string | null,
    prepareLocalSession: vi.fn(),
    loadSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
    clearError: vi.fn(),
  },
  agentsState: {
    agents: [{ id: 'main', name: 'main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }],
    loading: false,
    error: null as string | null,
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  },
  artifactPanelState: {
    open: false,
    widthPct: 45,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  },
  chatState: {
    sessions: [{ key: 'agent:main:main', workspacePath: '/workspace' }],
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    loadSessions: vi.fn().mockResolvedValue(undefined),
    selectAcpSession: vi.fn(),
    acknowledgeAcpSessionCreated: vi.fn(),
  },
  gatewayState: {
    status: { state: 'running', gatewayReady: true, port: 18789 },
  },
  stickState: {
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  },
}));

const ensureAcpChatSubscriptions = vi.hoisted(() => vi.fn());
const resolveWorkspaceContext = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: { resolveWorkspaceContext },
  },
}));

vi.mock('@/stores/acp-chat-session', () => ({
  ensureAcpChatSubscriptions,
  useAcpChatSessionStore: (selector: (state: typeof acpState) => unknown) => selector(acpState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (value: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => {
      if (typeof params === 'string') return params;
      const labels: Record<string, string> = {
        'acp.thought': 'Thought',
        'acp.tool': 'Tool',
        'acp.permission': 'Permission',
        'acp.plan': 'Plan',
        'acp.running': 'Running',
        'acp.pending': 'Pending',
        'acp.completed': 'Completed',
        'acp.failed': 'Failed',
        'acp.cancelled': 'Cancelled',
        'acp.loadFailed': 'Load failed',
        'acp.promptFailed': 'Prompt failed',
        'acp.unsupportedContent': 'Unsupported content',
        'acp.dismiss': 'Dismiss',
        'scrollToLatest': 'Scroll to latest',
        'welcome.subtitle': 'What can I do for you?',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: stickState.scrollToBottom,
    isAtBottom: stickState.isAtBottom,
  })),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: ({ disabled, sending }: { disabled?: boolean; sending?: boolean }) => (
    <div data-testid="mock-chat-input" data-disabled={disabled ? 'true' : 'false'} data-sending={sending ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => <div data-testid="mock-artifact-panel" />,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

function emptyTimeline(): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:main',
    loadGeneration: 1,
    itemOrder: [],
    itemsById: {},
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

function timelineWithProcessBlocks(): AcpTimelineSnapshot {
  return {
    ...emptyTimeline(),
    itemOrder: [
      'msg-user:0',
      'thought:assistant-run',
      'tool:read-file',
      'permission:approve-edit',
      'plan:current',
      'msg-assistant:0',
    ],
    itemsById: {
      'msg-user:0': {
        kind: 'message-segment',
        id: 'msg-user:0',
        role: 'user',
        messageId: 'msg-user',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'Read the file and propose changes' }],
      },
      'thought:assistant-run': {
        kind: 'thought',
        id: 'thought:assistant-run',
        messageId: 'assistant-run',
        parts: [{ kind: 'markdown', text: 'Need to inspect the current implementation first.' }],
      },
      'tool:read-file': {
        kind: 'tool-call',
        id: 'tool:read-file',
        toolCallId: 'read-file',
        title: 'Read file',
        status: 'completed',
        outputParts: [{ kind: 'markdown', text: 'Loaded src/pages/Chat/index.tsx' }],
        locations: [],
      },
      'permission:approve-edit': {
        kind: 'permission',
        id: 'permission:approve-edit',
        requestId: 'approve-edit',
        toolCallId: 'edit-file',
        title: 'Allow edit?',
        options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow' }],
        status: 'pending',
      },
      'plan:current': {
        kind: 'plan',
        id: 'plan:current',
        entries: [{ content: 'Update Chat page tests', status: 'pending' } as never],
      },
      'msg-assistant:0': {
        kind: 'message-segment',
        id: 'msg-assistant:0',
        role: 'assistant',
        messageId: 'msg-assistant',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'The Chat page now renders ACP timeline blocks inline.' }],
      },
    },
  };
}

describe('ACP Chat page inline timeline lifecycle', () => {
  beforeEach(() => {
    ensureAcpChatSubscriptions.mockReset();
    resolveWorkspaceContext.mockReset();
    resolveWorkspaceContext.mockImplementation(async (input: {
      workspaceRoot: string;
      executionCwd: string;
    }) => ({
      ok: true,
      workspaceRoot: input.workspaceRoot,
      executionCwd: input.executionCwd,
    }));
    acpState.timeline = timelineWithProcessBlocks();
    acpState.loading = false;
    acpState.sending = false;
    acpState.cancelling = false;
    acpState.error = null;
    acpState.activeSessionKey = 'agent:main:main';
    acpState.workspaceRoot = null;
    acpState.cwd = null;
    acpState.prepareLocalSession.mockReset();
    acpState.loadSession.mockReset();
    acpState.loadSession.mockResolvedValue(undefined);
    acpState.sendPrompt.mockReset();
    acpState.cancel.mockReset();
    acpState.respondPermission.mockReset();
    acpState.clearError.mockReset();
    agentsState.agents = [{ id: 'main', name: 'main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }];
    agentsState.loading = false;
    agentsState.error = null;
    agentsState.fetchAgents.mockReset();
    agentsState.fetchAgents.mockReturnValue(new Promise<void>(() => {}));
    artifactPanelState.open = false;
    artifactPanelState.close.mockReset();
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', gatewayReady: true, port: 18789 };
    stickState.isAtBottom = true;
    stickState.scrollToBottom.mockReset();
  });

  it('renders ACP process blocks inline instead of the legacy execution graph', async () => {
    const { Chat } = await import('@/pages/Chat/index');

    const { container } = render(<Chat />);

    expect(screen.getByTestId('acp-chat-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-thought-block')).toHaveTextContent('Need to inspect the current implementation first.');
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('Read file');
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('Loaded src/pages/Chat/index.tsx');
    expect(screen.getByTestId('acp-permission-card')).toHaveTextContent('Allow edit?');
    expect(screen.getByTestId('acp-plan-item')).toHaveTextContent('Update Chat page tests');
    expect(screen.getByText('The Chat page now renders ACP timeline blocks inline.')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-acp-item-id]')).map((node) => node.getAttribute('data-acp-item-id'))).toEqual([
      'msg-user:0',
      'thought:assistant-run',
      'tool:read-file',
      'permission:approve-edit',
      'plan:current',
      'msg-assistant:0',
    ]);

    await waitFor(() => {
      expect(ensureAcpChatSubscriptions).toHaveBeenCalled();
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main',
        workspaceRoot: '/workspace',
        cwd: '/workspace',
      });
    });
  });

  it('keeps ACP tool status in the inline timeline while the composer is busy', async () => {
    acpState.sending = true;
    acpState.timeline = {
      ...emptyTimeline(),
      itemOrder: ['tool:read-file'],
      itemsById: {
        'tool:read-file': {
          kind: 'tool-call',
          id: 'tool:read-file',
          toolCallId: 'read-file',
          title: 'Read file',
          status: 'running',
          outputParts: [{ kind: 'markdown', text: 'Reading package.json' }],
          locations: [],
        },
      },
    };
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(screen.getByTestId('acp-chat-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('Read file');
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('Running');
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'true');
  });

  it('renders ACP load errors as inline timeline errors without the graph trailing state', async () => {
    acpState.error = '404 Resource not found';
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('404 Resource not found');
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(acpState.clearError).toHaveBeenCalledTimes(1);
  });

  it('shows the scroll-to-latest button for ACP timelines when scrolled away from the bottom', async () => {
    stickState.isAtBottom = false;
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    const button = screen.getByTestId('chat-scroll-to-latest');
    expect(button).toHaveTextContent('Scroll to latest');

    fireEvent.click(button);

    expect(stickState.scrollToBottom).toHaveBeenCalledWith({ animation: 'smooth', ignoreEscapes: true });
  });

  it('renders a nonblank ACP empty state instead of an empty execution graph', async () => {
    acpState.timeline = emptyTimeline();
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(screen.getByTestId('acp-chat-empty-state')).toHaveTextContent('What can I do for you?');
    expect(screen.queryByTestId('acp-chat-timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
  });
});
