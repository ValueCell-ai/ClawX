import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '@/pages/Chat';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

const { acpState, agentsState, artifactPanelState, artifactPanelProps, chatState, gatewayState, settingsState } = vi.hoisted(() => ({
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
    pendingImageGenerationTaskIds: [] as string[],
    cancelling: false,
    error: null as string | null,
    activeSessionKey: 'agent:main:main' as string | null,
    workspaceRoot: null as string | null,
    cwd: null as string | null,
    acceptedPromptSessionKeys: [] as string[],
    prepareLocalSession: vi.fn(),
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
  artifactPanelProps: [] as Array<{ fileGroups: unknown[]; uniqueFileCount: number; agent: unknown; runStartedAt?: number | null }>,
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
    acknowledgeAcpSessionCreated: vi.fn(),
    abortRun: vi.fn(),
    clearError: vi.fn(),
    loadMoreHistory: vi.fn(),
    cleanupEmptySession: vi.fn(),
    lastUserMessageAt: null,
  },
  gatewayState: {
    status: { state: 'running', gatewayReady: true, port: 18789 },
  },
  settingsState: {
    chatWorkspacePath: '/workspace',
    setChatWorkspacePath: vi.fn(),
  },
}));

const ensureAcpChatSubscriptions = vi.hoisted(() => vi.fn());
const resolveWorkspaceContext = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    dialog: { open: openDialog },
    files: { resolveWorkspaceContext },
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

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

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
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
    workspaceLabel,
    workspacePath,
    workspaceReadOnly,
  }: {
    disabled?: boolean;
    onSend: (text: string, attachments?: Array<Record<string, unknown>>, targetAgentId?: string | null) => void;
    onStop?: () => void;
    sending?: boolean;
    workspaceLabel?: string;
    workspacePath?: string;
    workspaceReadOnly?: boolean;
    onSelectWorkspace?: (path: string) => void;
  }) => (
    <div data-testid="mock-chat-input" data-disabled={disabled ? 'true' : 'false'} data-sending={sending ? 'true' : 'false'}>
      <span data-testid="mock-workspace-label">{workspaceLabel}</span>
      <span data-testid="mock-workspace-path">{workspacePath}</span>
      <span data-testid="mock-workspace-readonly">{workspaceReadOnly ? 'readonly' : 'editable'}</span>
      <button
        type="button"
        data-testid="mock-send"
        onClick={() => onSend('Ship it', [
          {
            status: 'ready',
            id: 'staged-ready',
            stagedPath: '/tmp/ready.png',
            fileName: 'ready.png',
            mimeType: 'image/png',
          },
          {
            status: 'staging',
            id: 'staged-pending',
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
  ArtifactPanel: (props: { fileGroups: unknown[]; uniqueFileCount: number; agent: unknown; runStartedAt?: number | null }) => {
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
        'workspace.unavailable.title': 'Workspace unavailable',
        'workspace.unavailable.description': `This folder is unavailable: ${String(options?.path ?? '')}`,
        'workspace.unavailable.boundDescription': `This chat workspace is unavailable: ${String(options?.path ?? '')}`,
        'workspace.unavailable.chooseAction': 'Choose workspace',
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
    acpState.workspaceRoot = null;
    acpState.cwd = null;
    acpState.acceptedPromptSessionKeys = [];
    acpState.timeline = populatedTimeline();
    acpState.prepareLocalSession.mockReset();
    acpState.prepareLocalSession.mockImplementation((input: { sessionKey: string; workspaceRoot: string; cwd: string }) => {
      acpState.activeSessionKey = input.sessionKey;
      acpState.workspaceRoot = input.workspaceRoot;
      acpState.cwd = input.cwd;
      acpState.timeline = { ...emptyTimeline(), sessionId: input.sessionKey };
    });
    acpState.loadSession.mockReset();
    acpState.loadSession.mockImplementation(async (input: { sessionKey: string; workspaceRoot: string; cwd: string }) => {
      acpState.activeSessionKey = input.sessionKey;
      acpState.workspaceRoot = input.workspaceRoot;
      acpState.cwd = input.cwd;
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
    resolveWorkspaceContext.mockReset();
    resolveWorkspaceContext.mockImplementation(async (input: { workspaceRoot: string; executionCwd: string }) => ({
      ok: true,
      workspaceRoot: input.workspaceRoot,
      executionCwd: input.executionCwd,
    }));
    openDialog.mockReset();
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/workspace' }];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    chatState.loadSessions.mockReset();
    chatState.loadSessions.mockResolvedValue(undefined);
    chatState.selectAcpSession.mockReset();
    chatState.selectAcpSession.mockImplementation((sessionKey: string, workspacePath?: string) => {
      chatState.currentSessionKey = sessionKey;
      chatState.currentAgentId = sessionKey.split(':')[1] || 'main';
      const existingSession = chatState.sessions.find((session) => session.key === sessionKey);
      if (existingSession) {
        chatState.sessions = chatState.sessions.map((session) => (
          session.key === sessionKey
            ? { ...session, workspacePath: workspacePath ?? session.workspacePath }
            : session
        ));
      } else {
        chatState.sessions = [...chatState.sessions, { key: sessionKey, workspacePath }];
      }
    });
    chatState.acknowledgeAcpSessionCreated.mockReset();
    settingsState.chatWorkspacePath = '/workspace';
    settingsState.setChatWorkspacePath.mockReset();
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
      expect(ensureAcpChatSubscriptions).toHaveBeenCalled();
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main', workspaceRoot: '/workspace', cwd: '/workspace',
      });
    });
  });

  it('sends ready staged attachments and cancels through the ACP session store', async () => {
    acpState.workspaceRoot = '/workspace';
    acpState.cwd = '/workspace';

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send'));
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:main:main',
      cwd: '/workspace',
      message: 'Ship it',
      media: [{
        filePath: '/tmp/ready.png', stagingId: 'staged-ready', fileName: 'ready.png', mimeType: 'image/png',
      }],
    });

    fireEvent.click(screen.getByTestId('mock-stop'));
    expect(acpState.cancel).toHaveBeenCalledTimes(1);
  });

  it('loads from the effective workspace without waiting for agents', async () => {
    const deferred = deferredPromise();
    agentsState.agents = [];
    agentsState.loading = false;
    agentsState.fetchAgents.mockReturnValue(deferred.promise);
    settingsState.chatWorkspacePath = '/global-workspace';
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/session-workspace' }];

    const { rerender } = render(<Chat />);

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main', workspaceRoot: '/session-workspace', cwd: '/session-workspace',
      });
    });

    agentsState.agents = [{ id: 'main', name: 'Main', workspace: '/resolved-workspace', mainSessionKey: 'agent:main:main' }];
    deferred.resolve();
    rerender(<Chat />);

    expect(acpState.loadSession).toHaveBeenCalledTimes(1);
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
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main', workspaceRoot: '/workspace', cwd: '/workspace', createIfMissing: true,
      });
    });
  });

  it('uses OpenClaw session workspacePath for ACP load and read-only footer', async () => {
    chatState.sessions = [{ key: 'agent:main:session-a', workspacePath: '/Users/alex/workspace/ClawX' }];
    chatState.currentSessionKey = 'agent:main:session-a';
    acpState.activeSessionKey = null;
    acpState.loadSession.mockResolvedValue(true);

    render(<Chat />);

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:session-a',
        workspaceRoot: '/Users/alex/workspace/ClawX',
        cwd: '/Users/alex/workspace/ClawX',
      });
    });
    expect(screen.getByTestId('mock-workspace-path')).toHaveTextContent('/Users/alex/workspace/ClawX');
    expect(screen.getByTestId('mock-workspace-readonly')).toHaveTextContent('readonly');
  });

  it('reloads the same ACP session when summary hydration replaces fallback cwd', async () => {
    const sessionKey = 'agent:main:session-a';
    let resolveInitialLoad!: (loaded: boolean) => void;
    const initialLoad = new Promise<boolean>((resolve) => {
      resolveInitialLoad = resolve;
    });
    chatState.sessions = [{ key: sessionKey, updatedAt: 1000 }];
    chatState.currentSessionKey = sessionKey;
    settingsState.chatWorkspacePath = '/workspace';
    acpState.activeSessionKey = null;
    acpState.loadSession.mockImplementation((input: { cwd: string; sessionKey: string }) => {
      if (input.cwd === '~/.openclaw/workspace') return initialLoad;
      return Promise.resolve(true);
    });

    const { rerender } = render(<Chat />);

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey, workspaceRoot: '~/.openclaw/workspace', cwd: '~/.openclaw/workspace',
      });
    });

    chatState.sessions = [{ key: sessionKey, updatedAt: 1000, workspacePath: '/Users/alex/workspace/ClawX' }];
    rerender(<Chat />);

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey,
        workspaceRoot: '/Users/alex/workspace/ClawX',
        cwd: '/Users/alex/workspace/ClawX',
      });
    });
    resolveInitialLoad(true);
  });

  it('starts a new load when returning to a session whose earlier load is still pending', async () => {
    const sessionKey = 'agent:main:session-a';
    let resolveInitialLoad!: (loaded: boolean) => void;
    const initialLoad = new Promise<boolean>((resolve) => {
      resolveInitialLoad = resolve;
    });
    const localSessionKey = 'agent:main:session-local';
    chatState.sessions = [{ key: sessionKey, workspacePath: '/workspace' }];
    chatState.currentSessionKey = sessionKey;
    acpState.activeSessionKey = null;
    acpState.loadSession
      .mockReturnValueOnce(initialLoad)
      .mockResolvedValueOnce(true);

    const { rerender } = render(<Chat />);
    await waitFor(() => expect(acpState.loadSession).toHaveBeenCalledTimes(1));

    chatState.sessions = [
      { key: sessionKey, workspacePath: '/workspace' },
      { key: localSessionKey, workspacePath: '/workspace', createdLocally: true },
    ];
    chatState.currentSessionKey = localSessionKey;
    acpState.activeSessionKey = localSessionKey;
    acpState.cwd = '/workspace';
    rerender(<Chat />);
    await waitFor(() => expect(resolveWorkspaceContext).toHaveBeenCalledTimes(2));

    chatState.currentSessionKey = sessionKey;
    rerender(<Chat />);

    await waitFor(() => expect(resolveWorkspaceContext).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(acpState.loadSession).toHaveBeenCalledTimes(2));
    expect(acpState.loadSession).toHaveBeenLastCalledWith({
      sessionKey,
      workspaceRoot: '/workspace',
      cwd: '/workspace',
    });
    resolveInitialLoad(false);
  });

  it('does not create a local ACP session before first send', async () => {
    chatState.sessions = [{ key: 'agent:main:session-local', createdLocally: true }];
    chatState.currentSessionKey = 'agent:main:session-local';
    acpState.activeSessionKey = null;
    acpState.loadSession.mockResolvedValue(true);

    render(<Chat />);

    await Promise.resolve();
    expect(acpState.loadSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-workspace-readonly')).toHaveTextContent('editable');
  });

  it('blocks ACP creation and prompts for another folder when the global workspace is missing', async () => {
    const sessionKey = 'agent:main:session-local';
    chatState.sessions = [{ key: sessionKey, createdLocally: true }];
    chatState.currentSessionKey = sessionKey;
    acpState.activeSessionKey = null;
    acpState.timeline = { ...emptyTimeline(), sessionId: sessionKey };
    resolveWorkspaceContext.mockResolvedValue({ ok: false, error: 'notFound' });
    openDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\projects\\next-workspace'] });

    render(<Chat />);

    const banner = await screen.findByTestId('workspace-unavailable-banner');
    expect(banner).toHaveTextContent('Workspace unavailable');
    expect(banner).toHaveTextContent('/workspace');
    expect(acpState.prepareLocalSession).toHaveBeenCalledWith({
      sessionKey, workspaceRoot: '/workspace', cwd: '/workspace',
    });
    expect(acpState.loadSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }));
    await waitFor(() => {
      expect(settingsState.setChatWorkspacePath).toHaveBeenCalledWith('D:\\projects\\next-workspace');
    });
  });

  it('clears stale ACP content when switching to a local pending session', async () => {
    const sessionKey = 'agent:main:session-local';
    chatState.sessions = [{ key: sessionKey, createdLocally: true }];
    chatState.currentSessionKey = sessionKey;
    acpState.activeSessionKey = 'agent:main:previous';
    acpState.cwd = '/old-workspace';

    const { rerender } = render(<Chat />);

    await waitFor(() => {
      expect(acpState.prepareLocalSession).toHaveBeenCalledWith({
        sessionKey, workspaceRoot: '/workspace', cwd: '/workspace',
      });
    });
    rerender(<Chat />);

    expect(screen.queryByText('List project files')).not.toBeInTheDocument();
    expect(screen.getByTestId('acp-chat-empty-state')).toBeInTheDocument();
    expect(acpState.loadSession).not.toHaveBeenCalled();
  });

  it('creates a missing ACP session for locally-created sidebar placeholders on first send', async () => {
    const sessionKey = 'agent:main:session-123';
    chatState.currentSessionKey = sessionKey;
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: sessionKey, displayName: sessionKey, createdLocally: true },
    ];

    render(<Chat />);

    expect(acpState.loadSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send'));

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey, workspaceRoot: '/workspace', cwd: '/workspace', createIfMissing: true,
      });
    });
    await waitFor(() => {
      expect(chatState.acknowledgeAcpSessionCreated).toHaveBeenCalledWith(sessionKey, '/workspace');
    });
  });

  it('still creates the ACP session on first send after local renderer preparation', async () => {
    const sessionKey = 'agent:main:session-prepared';
    chatState.currentSessionKey = sessionKey;
    chatState.sessions = [{ key: sessionKey, displayName: sessionKey, createdLocally: true }];
    acpState.activeSessionKey = sessionKey;
    acpState.cwd = '/workspace';

    render(<Chat />);
    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send'));

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey, workspaceRoot: '/workspace', cwd: '/workspace', createIfMissing: true,
      });
    });
    await waitFor(() => {
      expect(chatState.acknowledgeAcpSessionCreated).toHaveBeenCalledWith(sessionKey, '/workspace');
    });
  });

  it('does not auto-load again after first send acknowledges a local session with the same cwd', async () => {
    const sessionKey = 'agent:main:session-local';
    chatState.currentSessionKey = sessionKey;
    chatState.sessions = [{ key: sessionKey, displayName: sessionKey, createdLocally: true }];
    acpState.activeSessionKey = null;
    acpState.cwd = null;
    chatState.acknowledgeAcpSessionCreated.mockImplementation((key: string, workspacePath?: string) => {
      chatState.sessions = chatState.sessions.map((session) => (
        session.key === key
          ? { ...session, createdLocally: false, workspacePath }
          : session
      ));
    });

    const { rerender } = render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send'));

    await waitFor(() => {
      expect(chatState.acknowledgeAcpSessionCreated).toHaveBeenCalledWith(sessionKey, '/workspace');
    });
    expect(acpState.loadSession).toHaveBeenCalledTimes(1);

    rerender(<Chat />);

    await Promise.resolve();
    expect(acpState.loadSession).toHaveBeenCalledTimes(1);
  });

  it('disables the composer while ACP session load is in progress', () => {
    acpState.loading = true;

    render(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'true');
  });

  it('loads ACP sessions and keeps the composer enabled while Gateway is stopped', async () => {
    gatewayState.status = { state: 'stopped', gatewayReady: false, port: 18789 };

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main', workspaceRoot: '/workspace', cwd: '/workspace',
      });
    });
  });

  it('selects and loads the target ACP session before routing target-agent sends', async () => {
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: 'agent:research:desk' },
    ];
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: 'agent:research:desk', workspacePath: '/research-workspace' },
    ];

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:main', workspaceRoot: '/workspace', cwd: '/workspace',
      });
    });
    acpState.loadSession.mockClear();
    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.acceptedPromptSessionKeys).toContain('agent:research:desk');
    });
    expect(acpState.loadSession).toHaveBeenCalledWith({
      sessionKey: 'agent:research:desk', workspaceRoot: '/research-workspace', cwd: '/research-workspace',
    });
    expect(chatState.selectAcpSession).toHaveBeenCalledWith('agent:research:desk', '/research-workspace');
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:research:desk',
      cwd: '/research-workspace',
      message: 'Ask research',
      media: undefined,
    });
    const targetLoadIndex = acpState.loadSession.mock.calls.findIndex(
      ([input]) => input.sessionKey === 'agent:research:desk',
    );
    expect(acpState.loadSession.mock.invocationCallOrder[targetLoadIndex]!).toBeLessThan(
      acpState.sendPrompt.mock.invocationCallOrder.at(-1)!,
    );
    expect(chatState.selectAcpSession.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      acpState.loadSession.mock.invocationCallOrder[targetLoadIndex]!,
    );
  });

  it('creates a new target agent session in its workspace before the first prompt', async () => {
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: 'agent:research:main' },
    ];

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.acceptedPromptSessionKeys).toContain('agent:research:main');
    });
    expect(chatState.selectAcpSession).toHaveBeenCalledWith(
      'agent:research:main',
      '/research-workspace',
    );
    expect(acpState.loadSession).toHaveBeenCalledWith({
      sessionKey: 'agent:research:main',
      workspaceRoot: '/research-workspace',
      cwd: '/research-workspace',
      createIfMissing: true,
    });
    expect(chatState.acknowledgeAcpSessionCreated).toHaveBeenCalledWith(
      'agent:research:main',
      '/research-workspace',
    );
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey: 'agent:research:main',
      cwd: '/research-workspace',
      message: 'Ask research',
      media: undefined,
    });
  });

  it('reloads an active target ACP session before sending when its cwd is stale', async () => {
    const sessionKey = 'agent:research:desk';
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: sessionKey },
    ];
    chatState.currentSessionKey = 'agent:main:session-local';
    chatState.sessions = [
      { key: 'agent:main:session-local', displayName: 'Local', createdLocally: true },
      { key: sessionKey, displayName: 'Research', createdLocally: true },
    ];
    acpState.activeSessionKey = sessionKey;
    acpState.cwd = '/stale-research-workspace';

    render(<Chat />);

    expect(acpState.loadSession).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey,
        workspaceRoot: '/research-workspace',
        cwd: '/research-workspace',
        createIfMissing: true,
      });
    });
    expect(acpState.sendPrompt).toHaveBeenCalledWith({
      sessionKey,
      cwd: '/research-workspace',
      message: 'Ask research',
      media: undefined,
    });
    expect(acpState.loadSession.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      acpState.sendPrompt.mock.invocationCallOrder.at(-1)!,
    );
  });

  it('does not send a target prompt when loading the target ACP session fails', async () => {
    agentsState.agents = [
      { id: 'main', name: 'Main', workspace: '/workspace', mainSessionKey: 'agent:main:main' },
      { id: 'research', name: 'Research', workspace: '/research-workspace', mainSessionKey: 'agent:research:desk' },
    ];
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: 'agent:research:desk', workspacePath: '/research-workspace' },
    ];
    acpState.loadSession.mockImplementation(async (input: { sessionKey: string }) => {
      if (input.sessionKey === 'agent:research:desk') return false;
      acpState.activeSessionKey = input.sessionKey;
      return true;
    });

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('mock-send-target'));

    await waitFor(() => {
      expect(acpState.loadSession).toHaveBeenCalledWith({
        sessionKey: 'agent:research:desk', workspaceRoot: '/research-workspace', cwd: '/research-workspace',
      });
    });
    expect(chatState.selectAcpSession).toHaveBeenCalledWith('agent:research:desk', '/research-workspace');
    expect(acpState.sendPrompt).not.toHaveBeenCalled();
  });

  it('renders a nonblank empty state for empty ACP timelines', () => {
    acpState.timeline = emptyTimeline();

    render(<Chat />);

    expect(screen.getByTestId('acp-chat-empty-state')).toHaveTextContent('What can I do for you?');
    expect(screen.queryByTestId('acp-chat-timeline')).not.toBeInTheDocument();
  });

  it('projects only completed file tools after Main resolves the canonical workspace context', async () => {
    artifactPanelState.open = true;
    settingsState.chatWorkspacePath = '~/.openclaw/workspace';
    chatState.sessions = [{ key: 'agent:main:main' }];
    acpState.cwd = '~/.openclaw/workspace';
    resolveWorkspaceContext.mockResolvedValueOnce({
      ok: true,
      workspaceRoot: '/Users/test/.openclaw/workspace',
      executionCwd: '/Users/test/.openclaw/workspace',
    });
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
          parts: [{
            kind: 'attachment',
            attachmentId: 'attachment:msg-user:0:0',
            reference: { uri: '/workspace/user-upload.md', name: 'user-upload.md', mimeType: 'text/markdown' },
            source: 'acp-resource',
            access: { status: 'pending' },
          }],
        },
        'msg-assistant:0': {
          kind: 'message-segment',
          id: 'msg-assistant:0',
          role: 'assistant',
          messageId: 'msg-assistant',
          segmentIndex: 0,
          parts: [{
            kind: 'attachment',
            attachmentId: 'attachment:msg-assistant:0:0',
            reference: { uri: '/workspace/report.md', name: 'report.md', mimeType: 'text/markdown' },
            source: 'acp-resource',
            access: { status: 'pending' },
          }],
        },
        'tool:write-file': {
          kind: 'tool-call',
          id: 'tool:write-file',
          toolCallId: 'write-file',
          title: 'write: app',
          status: 'completed',
          input: { path: '/Users/test/.openclaw/workspace/src/app.tsx', content: 'export {}' },
          outputParts: [{
            kind: 'attachment',
            attachmentId: 'attachment:tool:write-file:0:0',
            reference: { uri: '/workspace/src/app.tsx', name: 'app.tsx' },
            source: 'acp-resource',
            access: { status: 'pending' },
          }],
          locations: [],
        },
      },
    };

    render(<Chat />);

    await waitFor(() => {
      expect(resolveWorkspaceContext).toHaveBeenCalledWith({
        workspaceRoot: '~/.openclaw/workspace',
        executionCwd: '~/.openclaw/workspace',
      });
      expect(artifactPanelProps.at(-1)?.fileGroups).toEqual([
        expect.objectContaining({ relativePath: 'src/app.tsx' }),
      ]);
      expect(artifactPanelProps.at(-1)?.uniqueFileCount).toBe(1);
      expect(screen.getByText('report.md')).toBeInTheDocument();
    });
  });

  it('discards stale workspace resolver results after a session switch', async () => {
    artifactPanelState.open = true;
    let resolveFirst!: (value: unknown) => void;
    resolveWorkspaceContext
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, workspaceRoot: '/workspace-b', executionCwd: '/workspace-b' });

    const { rerender } = render(<Chat />);
    chatState.currentSessionKey = 'agent:main:second';
    chatState.sessions = [{ key: 'agent:main:second', workspacePath: '/workspace-b' }];
    acpState.activeSessionKey = 'agent:main:second';
    acpState.cwd = '/workspace-b';
    acpState.timeline = { ...emptyTimeline(), sessionId: 'agent:main:second' };
    rerender(<Chat />);

    await waitFor(() => expect(resolveWorkspaceContext).toHaveBeenCalledTimes(2));
    resolveFirst({ ok: true, workspaceRoot: '/workspace', executionCwd: '/workspace' });
    await waitFor(() => expect(artifactPanelProps.at(-1)?.fileGroups).toEqual([]));
  });
});
