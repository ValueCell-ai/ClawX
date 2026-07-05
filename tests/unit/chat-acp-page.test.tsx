import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '@/pages/Chat';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

const { acpState, agentsState, artifactPanelState, artifactPanelProps, chatState, gatewayState } = vi.hoisted(() => ({
  acpState: {
    timeline: {
      sessionId: 'agent:main:main',
      loadGeneration: 1,
      itemOrder: ['msg-user:0', 'tool:list-files', 'msg-assistant:0'],
      itemsById: {
        'msg-user:0': {
          kind: 'message-segment',
          id: 'msg-user:0',
          role: 'user',
          messageId: 'msg-user',
          segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'List project files' }],
        },
        'tool:list-files': {
          kind: 'tool-call',
          id: 'tool:list-files',
          toolCallId: 'list-files',
          title: 'List files',
          status: 'completed',
          outputParts: [{ kind: 'markdown', text: 'src/pages/Chat/index.tsx' }],
          locations: [],
        },
        'msg-assistant:0': {
          kind: 'message-segment',
          id: 'msg-assistant:0',
          role: 'assistant',
          messageId: 'msg-assistant',
          segmentIndex: 0,
          parts: [{ kind: 'markdown', text: 'The Chat page is in src/pages/Chat.' }],
        },
      },
      metadata: {},
      openMessageSegments: {},
      segmentCounts: {},
    } as AcpTimelineSnapshot,
    loading: false,
    sending: false,
    cancelling: false,
    error: null as string | null,
    activeSessionKey: 'agent:main:main' as string | null,
    acceptedPromptSessionKeys: [] as string[],
    loadSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
    clearError: vi.fn(),
  },
  agentsState: {
    agents: [{ id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }],
    loading: false,
    error: null as string | null,
    fetchAgents: vi.fn(),
  },
  artifactPanelState: {
    open: false,
    widthPct: 40,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  },
  artifactPanelProps: [] as Array<{ files: unknown[]; agent: unknown; runStartedAt?: number | null }>,
  chatState: {
    messages: [],
    sessions: [],
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sessionLabels: {},
    loading: false,
    loadingMoreHistory: false,
    hasMoreHistory: false,
    sending: false,
    error: null,
    runError: null,
    streamingMessage: null,
    streamingTools: [],
    pendingFinal: false,
    activeRunId: null,
    runtimeRuns: {},
    sendMessage: vi.fn(),
    loadSessions: vi.fn(),
    selectAcpSession: vi.fn(),
    abortRun: vi.fn(),
    clearError: vi.fn(),
    loadMoreHistory: vi.fn(),
    cleanupEmptySession: vi.fn(),
    lastUserMessageAt: null,
  },
  gatewayState: {
    status: { state: 'running', gatewayReady: true, port: 18789 },
  },
}));

const ensureAcpChatSubscriptions = vi.hoisted(() => vi.fn());

vi.mock('@/stores/acp-chat-session', () => ({
  ensureAcpChatSubscriptions,
  useAcpChatSessionStore: (selector: (state: typeof acpState) => unknown) => selector(acpState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
    isAtBottom: true,
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => <div data-testid="mock-chat-toolbar" />,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: ({
    disabled,
    onSend,
    onStop,
    sending,
  }: {
    disabled?: boolean;
    onSend: (text: string, attachments?: Array<Record<string, unknown>>, targetAgentId?: string | null) => void;
    onStop?: () => void;
    sending?: boolean;
  }) => (
    <div data-testid="mock-chat-input" data-disabled={disabled ? 'true' : 'false'} data-sending={sending ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="mock-send"
        onClick={() => onSend('Ship it', [
          {
            status: 'ready',
            stagedPath: '/tmp/ready.png',
            fileName: 'ready.png',
            mimeType: 'image/png',
          },
          {
            status: 'staging',
            stagedPath: '/tmp/staging.txt',
            fileName: 'staging.txt',
            mimeType: 'text/plain',
          },
        ], null)}
      >
        send
      </button>
      <button type="button" data-testid="mock-stop" onClick={onStop}>stop</button>
      <button type="button" data-testid="mock-send-target" onClick={() => onSend('Ask research', undefined, 'research')}>send target</button>
    </div>
  ),
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: (props: { files: unknown[]; agent: unknown; runStartedAt?: number | null }) => {
    artifactPanelProps.push(props);
    return <div data-testid="mock-artifact-panel" />;
  },
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

vi.mock('@/pages/Chat/ExecutionGraphCard', () => ({
  ExecutionGraphCard: () => <div data-testid="chat-execution-graph" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const labels: Record<string, string> = {
        'acp.tool': 'Tool',
        'acp.completed': 'Completed',
        'acp.loadFailed': 'Load failed',
        'acp.promptFailed': 'Prompt failed',
        'acp.dismiss': 'Dismiss',
        'acp.unsupportedContent': 'Unsupported content',
        'toolbar.currentAgent': `Talking to ${String(options?.agent ?? '')}`,
        'welcome.subtitle': 'What can I do for you?',
      };
      return labels[key] ?? key;
    },
  }),
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

function populatedTimeline(): AcpTimelineSnapshot {
  return {
    ...emptyTimeline(),
    itemOrder: ['msg-user:0', 'tool:list-files', 'msg-assistant:0'],
    itemsById: {
      'msg-user:0': {
        kind: 'message-segment',
        id: 'msg-user:0',
        role: 'user',
        messageId: 'msg-user',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'List project files' }],
      },
      'tool:list-files': {
        kind: 'tool-call',
        id: 'tool:list-files',
        toolCallId: 'list-files',
        title: 'List files',
        status: 'completed',
        outputParts: [{ kind: 'markdown', text: 'src/pages/Chat/index.tsx' }],
        locations: [],
      },
      'msg-assistant:0': {
        kind: 'message-segment',
        id: 'msg-assistant:0',
        role: 'assistant',
        messageId: 'msg-assistant',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: 'The Chat page is in src/pages/Chat.' }],
      },
    },
  };
}

function deferredPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ACP Chat page', () => {
  beforeEach(() => {
    ensureAcpChatSubscriptions.mockReset();
    acpState.loading = false;
    acpState.sending = false;
    acpState.cancelling = false;
    acpState.error = null;
    acpState.activeSessionKey = 'agent:main:main';
    acpState.acceptedPromptSessionKeys = [];
    acpState.timeline = populatedTimeline();
    acpState.loadSession.mockReset();
    acpState.loadSession.mockImplementation(async (input: { sessionKey: string }) => {
      acpState.activeSessionKey = input.sessionKey;
      return true;
    });
    acpState.sendPrompt.mockReset();
    acpState.sendPrompt.mockImplementation(async (input: { sessionKey: string }) => {
      if (acpState.activeSessionKey === input.sessionKey) {
        acpState.acceptedPromptSessionKeys.push(input.sessionKey);
      }
      return acpState.activeSessionKey === input.sessionKey;
    });
    acpState.cancel.mockReset();
    acpState.respondPermission.mockReset();
    acpState.clearError.mockReset();
    agentsState.agents = [{ id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }];
    agentsState.loading = false;
    agentsState.error = null;
    agentsState.fetchAgents.mockReset();
    agentsState.fetchAgents.mockReturnValue(new Promise<void>(() => {}));
    artifactPanelState.open = false;
    artifactPanelState.close.mockReset();
    artifactPanelProps.length = 0;
    chatState.sessions = [{ key: 'agent:main:main' }];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    chatState.loadSessions.mockReset();
    chatState.loadSessions.mockResolvedValue(undefined);
    chatState.selectAcpSession.mockReset();
    chatState.selectAcpSession.mockImplementation((sessionKey: string) => {
      chatState.currentSessionKey = sessionKey;
      chatState.currentAgentId = sessionKey.split(':')[1] || 'main';
    });
    gatewayState.status = { state: 'running', gatewayReady: true, port: 18789 };
  });

  it('renders ACP inline timeline content instead of the execution graph', async () => {
    const { container } = render(<Chat />);

    expect(screen.getByTestId('acp-chat-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    expect(screen.getByText('List project files')).toBeInTheDocument();
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('List files');
    expect(screen.getByTestId('acp-tool-call-card')).toHaveTextContent('src/pages/Chat/index.tsx');
    expect(screen.getByText('The Chat page is in src/pages/Chat.')).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('[data-acp-item-id]')).map((node) => node.getAttribute('data-acp-item-id'))).toEqual([
      'msg-user:0',
      'tool:list-files',
      'msg-assistant:0',
    ]);

    await waitFor(() => {
      expect(ensureAcpChatSubscriptions).toHaveBeenCalledTimes(1);
      expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:main:main', cwd: '/workspace' });
    });
  });

  it('sends ready staged attachments and cancels through the ACP session store', () => {
    render(<Chat />);

    fireEvent.click(screen.getByTestId('mock-send'));
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      cwd: '/workspace',
      message: 'Ship it',
      media: [{ filePath: '/tmp/ready.png', fileName: 'ready.png', mimeType: 'image/png' }],
    });

    fireEvent.click(screen.getByTestId('mock-stop'));
    expect(acpState.cancel).toHaveBeenCalledTimes(1);
  });

  it('waits for unresolved agents before loading instead of using fallback cwd', async () => {
    const deferred = deferredPromise();
    agentsState.agents = [];
    agentsState.loading = false;
    agentsState.fetchAgents.mockReturnValue(deferred.promise);

    const { rerender } = render(<Chat />);

    expect(acpState.loadSession).not.toHaveBeenCalled();

    agentsState.agents = [{ id: 'main', name: 'Main', workspace: '/resolved-workspace', mainSessionKey: 'agent:main:main' }];
    deferred.resolve();
    rerender(<Chat />);

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:main:main', cwd: '/resolved-workspace' });
    });
    expect(acpState.loadSession).not.toHaveBeenCalledWith({ sessionKey: 'agent:main:main', cwd: '/' });
  });

  it('discovers sessions once before loading the default ACP session when ACP has no active session', async () => {
    acpState.activeSessionKey = null;
    chatState.sessions = [];

    render(<Chat />);

    await waitFor(() => {
      expect(chatState.loadSessions).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:main:main', cwd: '/workspace' });
    });
  });

  it('disables the composer while ACP session load is in progress', () => {
    acpState.loading = true;

    render(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'true');
  });

  it('loads ACP sessions and keeps the composer enabled while Gateway is stopped', async () => {
    gatewayState.status = { state: 'stopped', gatewayReady: false, port: 18789 };

    render(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:main:main', cwd: '/workspace' });
    });
  });

  it('selects and loads the target ACP session before routing target-agent sends', async () => {
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: 'agent:research:desk' },
    ];

    render(<Chat />);

    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.acceptedPromptSessionKeys).toContain('agent:research:desk');
    });
    expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:research:desk', cwd: '/research-workspace' });
    expect(chatState.selectAcpSession).toHaveBeenCalledWith('agent:research:desk');
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:research:desk',
      cwd: '/research-workspace',
      message: 'Ask research',
      media: undefined,
    });
    expect(acpState.loadSession.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      acpState.sendPrompt.mock.invocationCallOrder.at(-1)!,
    );
    expect(chatState.selectAcpSession.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      acpState.loadSession.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('does not send a target prompt when loading the target ACP session fails', async () => {
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: 'agent:research:desk' },
    ];
    acpState.loadSession.mockImplementation(async (input: { sessionKey: string }) => {
      if (input.sessionKey === 'agent:research:desk') return false;
      acpState.activeSessionKey = input.sessionKey;
      return true;
    });

    render(<Chat />);

    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({ sessionKey: 'agent:research:desk', cwd: '/research-workspace' });
    });
    expect(chatState.selectAcpSession).toHaveBeenCalledWith('agent:research:desk');
    expect(acpState.sendPrompt).not.toHaveBeenCalled();
  });

  it('renders a nonblank empty state for empty ACP timelines', () => {
    acpState.timeline = emptyTimeline();

    render(<Chat />);

    expect(screen.getByTestId('acp-chat-empty-state')).toHaveTextContent('What can I do for you?');
    expect(screen.queryByTestId('acp-chat-timeline')).not.toBeInTheDocument();
  });

  it('passes generated ACP file render parts to the artifact panel without user attachments', async () => {
    artifactPanelState.open = true;
    acpState.timeline = {
      ...emptyTimeline(),
      itemOrder: ['msg-user:0', 'msg-assistant:0', 'tool:write-file'],
      itemsById: {
        'msg-user:0': {
          kind: 'message-segment',
          id: 'msg-user:0',
          role: 'user',
          messageId: 'msg-user',
          segmentIndex: 0,
          parts: [{ kind: 'file', path: '/workspace/user-upload.md', name: 'user-upload.md', mimeType: 'text/markdown' }],
        },
        'msg-assistant:0': {
          kind: 'message-segment',
          id: 'msg-assistant:0',
          role: 'assistant',
          messageId: 'msg-assistant',
          segmentIndex: 0,
          parts: [{ kind: 'file', path: '/workspace/report.md', name: 'report.md', mimeType: 'text/markdown' }],
        },
        'tool:write-file': {
          kind: 'tool-call',
          id: 'tool:write-file',
          toolCallId: 'write-file',
          title: 'Write file',
          status: 'completed',
          outputParts: [{ kind: 'file', path: '/workspace/src/app.tsx', name: 'app.tsx' }],
          locations: [],
        },
      },
    };

    render(<Chat />);

    await waitFor(() => {
      expect(artifactPanelProps.at(-1)?.files).toEqual([
        expect.objectContaining({ filePath: '/workspace/report.md', fileName: 'report.md', mimeType: 'text/markdown' }),
        expect.objectContaining({ filePath: '/workspace/src/app.tsx', fileName: 'app.tsx' }),
      ]);
      expect(artifactPanelProps.at(-1)?.files).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ filePath: '/workspace/user-upload.md' })]),
      );
    });
  });
});
