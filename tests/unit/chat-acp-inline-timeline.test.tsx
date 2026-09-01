import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';
import type { AcpCurrentPlan } from '@/lib/acp/current-plan';

const { acpState, agentsState, artifactPanelState, attentionState, chatState, gatewayState, stickState } = vi.hoisted(() => ({
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
  attentionState: {
    bySessionKey: {} as Record<string, { observedBusy: boolean; unread: boolean }>,
    setVisibleSession: vi.fn(),
    markRead: vi.fn(),
  },
  chatState: {
    sessions: [{ key: 'agent:main:main', workspacePath: '/workspace' }],
    sessionLabels: {} as Record<string, string>,
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    loadSessions: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn(),
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
const getAcpSessionFamily = vi.hoisted(() => vi.fn());
const deferredAcpTimeline = vi.hoisted(() => ({ value: null as AcpTimelineSnapshot | null }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useDeferredValue: <T,>(value: T) => deferredAcpTimeline.value ?? value,
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: { resolveWorkspaceContext },
    chat: { getAcpSessionFamily },
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
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
}));

vi.mock('@/stores/session-attention', () => ({
  useSessionAttentionStore: (selector: (state: typeof attentionState) => unknown) => selector(attentionState),
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
        'acp.subagentSessions.marker': 'Subagent',
        'acp.subagentSessions.returnToParent': 'Return to parent conversation',
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

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: ({ disabled, sending, currentPlan, subagentSessions, onSelectSubagent }: {
    disabled?: boolean;
    sending?: boolean;
    currentPlan?: AcpCurrentPlan | null;
    subagentSessions?: Array<{ sessionKey: string; title: string; busy: boolean }>;
    onSelectSubagent?: (sessionKey: string) => void;
  }) => (
    <div
      data-testid="mock-chat-input"
      data-disabled={disabled ? 'true' : 'false'}
      data-sending={sending ? 'true' : 'false'}
      data-current-plan={currentPlan ? `${currentPlan.completedCount}/${currentPlan.totalCount}:${currentPlan.steps.map((step) => step.step).join('|')}` : ''}
      data-subagent-sessions={JSON.stringify(subagentSessions ?? [])}
    >
      {(subagentSessions ?? []).map((session) => (
        <button
          key={session.sessionKey}
          type="button"
          data-testid={`mock-subagent-${session.sessionKey}`}
          onClick={() => onSelectSubagent?.(session.sessionKey)}
        >
          {session.title}
        </button>
      ))}
    </div>
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

function timelineWithCurrentPlan(): AcpTimelineSnapshot {
  return {
    ...emptyTimeline(),
    itemOrder: ['tool:update-plan'],
    itemsById: {
      'tool:update-plan': {
        kind: 'tool-call',
        id: 'tool:update-plan',
        toolCallId: 'update-plan',
        title: 'update_plan: current steps',
        status: 'running',
        input: {
          plan: [
            { step: 'Inspect the current timeline', status: 'completed' },
            { step: 'Render the plan in the composer', status: 'in_progress' },
          ],
        },
        outputParts: [],
        locations: [],
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
    getAcpSessionFamily.mockReset();
    getAcpSessionFamily.mockResolvedValue({ success: true, current: null, children: [] });
    acpState.timeline = timelineWithProcessBlocks();
    deferredAcpTimeline.value = null;
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
    attentionState.bySessionKey = {};
    attentionState.setVisibleSession.mockReset();
    attentionState.markRead.mockReset();
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/workspace' }];
    chatState.sessionLabels = {};
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    chatState.switchSession.mockReset();
    gatewayState.status = { state: 'running', gatewayReady: true, port: 18789 };
    stickState.isAtBottom = true;
    stickState.scrollToBottom.mockReset();
    window.electron.platform = 'linux';
  });

  it('renders ACP process blocks in timeline order', async () => {
    const { Chat } = await import('@/pages/Chat/index');

    const { container } = render(<Chat />);

    expect(screen.getByTestId('acp-chat-timeline')).toBeInTheDocument();
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
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'true');
  });

  it('passes only the visible session structured update_plan to the composer', async () => {
    acpState.timeline = timelineWithCurrentPlan();
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute(
      'data-current-plan',
      '1/2:Inspect the current timeline|Render the plan in the composer',
    );

    acpState.activeSessionKey = 'agent:other:main';
    acpState.timeline = { ...timelineWithCurrentPlan(), sessionId: 'agent:other:main' };
    rerender(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-current-plan', '');
  });

  it('restores direct children and joins their exact Gateway run state with observed-busy fallback', async () => {
    const firstChild = 'agent:main:subagent:first';
    const secondChild = 'agent:main:subagent:second';
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: firstChild, workspacePath: '/workspace', status: 'running', hasActiveRun: true },
      { key: secondChild, workspacePath: '/workspace', status: 'queued' },
    ];
    attentionState.bySessionKey = {
      [secondChild]: { observedBusy: true, unread: false },
    };
    getAcpSessionFamily.mockResolvedValue({
      success: true,
      current: {
        sessionKey: 'agent:main:main',
        title: 'Parent',
        updatedAt: null,
        parentSessionKey: null,
      },
      children: [
        { sessionKey: firstChild, title: '[Subagent Context] First', updatedAt: null, parentSessionKey: 'agent:main:main' },
        { sessionKey: secondChild, title: 'Second', updatedAt: null, parentSessionKey: 'agent:main:main' },
      ],
    });
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('mock-chat-input').getAttribute('data-subagent-sessions') ?? '[]')).toEqual([
        { sessionKey: firstChild, title: '[Subagent Context] First', busy: true },
        { sessionKey: secondChild, title: 'Second', busy: true },
      ]);
    });

    chatState.sessions = chatState.sessions.map((session) => (
      session.key === firstChild ? { ...session, status: 'done', hasActiveRun: false } : session
    ));
    attentionState.bySessionKey = {};
    rerender(<Chat />);

    expect(JSON.parse(screen.getByTestId('mock-chat-input').getAttribute('data-subagent-sessions') ?? '[]'))
      .toEqual([
        { sessionKey: firstChild, title: '[Subagent Context] First', busy: false },
        { sessionKey: secondChild, title: 'Second', busy: false },
      ]);
  });

  it('treats only a structured successful sessions_spawn result as family refresh invalidation', async () => {
    const canonicalChild = 'agent:main:subagent:canonical-child';
    getAcpSessionFamily
      .mockResolvedValueOnce({ success: true, current: null, children: [] })
      .mockResolvedValue({
        success: true,
        current: null,
        children: [{
          sessionKey: canonicalChild,
          title: 'Canonical ACP child',
          updatedAt: null,
          parentSessionKey: 'agent:main:main',
        }],
      });
    acpState.timeline = emptyTimeline();
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);
    await waitFor(() => expect(getAcpSessionFamily).toHaveBeenCalledTimes(1));

    acpState.timeline = {
      ...emptyTimeline(),
      itemOrder: ['tool:failed-spawn'],
      itemsById: {
        'tool:failed-spawn': {
          kind: 'tool-call', id: 'tool:failed-spawn', toolCallId: 'failed-spawn',
          title: 'sessions_spawn: failed', status: 'completed', output: { details: { status: 'error' } },
          outputParts: [], locations: [],
        },
      },
    };
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: canonicalChild, workspacePath: '/workspace' },
    ];
    rerender(<Chat />);
    await Promise.resolve();
    expect(getAcpSessionFamily).toHaveBeenCalledTimes(1);

    acpState.timeline = {
      ...emptyTimeline(),
      itemOrder: ['tool:successful-spawn'],
      itemsById: {
        'tool:successful-spawn': {
          kind: 'tool-call', id: 'tool:successful-spawn', toolCallId: 'successful-spawn',
          title: 'sessions_spawn: start research', status: 'completed',
          output: {
            content: [{ type: 'text', text: 'accepted' }],
            details: {
              status: 'accepted',
              runId: 'run-signal-only',
              childSessionKey: 'agent:main:subagent:signal-only',
            },
          },
          outputParts: [], locations: [],
        },
      },
    };
    rerender(<Chat />);

    await waitFor(() => expect(getAcpSessionFamily).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId(`mock-subagent-${canonicalChild}`)).toBeInTheDocument());
    expect(screen.queryByTestId('mock-subagent-agent:main:subagent:signal-only')).not.toBeInTheDocument();
  });

  it('rejects stale family completion after the selected session changes', async () => {
    const firstSession = 'agent:main:main';
    const secondSession = 'agent:main:other';
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    getAcpSessionFamily.mockImplementation(({ sessionKey }: { sessionKey: string }) => new Promise((resolve) => {
      if (sessionKey === firstSession) resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);
    await waitFor(() => expect(getAcpSessionFamily).toHaveBeenCalledWith({ sessionKey: firstSession }));

    chatState.currentSessionKey = secondSession;
    chatState.sessions = [
      { key: firstSession, workspacePath: '/workspace' },
      { key: secondSession, workspacePath: '/workspace' },
      { key: 'agent:main:subagent:second-child', workspacePath: '/workspace' },
    ];
    acpState.activeSessionKey = secondSession;
    acpState.timeline = { ...emptyTimeline(), sessionId: secondSession };
    rerender(<Chat />);
    await waitFor(() => expect(getAcpSessionFamily).toHaveBeenCalledWith({ sessionKey: secondSession }));

    resolveSecond({
      success: true,
      current: null,
      children: [{
        sessionKey: 'agent:main:subagent:second-child', title: 'Second child', updatedAt: null, parentSessionKey: secondSession,
      }],
    });
    await waitFor(() => expect(screen.getByTestId('mock-subagent-agent:main:subagent:second-child')).toBeInTheDocument());

    resolveFirst({
      success: true,
      current: null,
      children: [{
        sessionKey: 'agent:main:subagent:stale-child', title: 'Stale child', updatedAt: null, parentSessionKey: firstSession,
      }],
    });
    await Promise.resolve();

    expect(screen.getByTestId('mock-subagent-agent:main:subagent:second-child')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-subagent-agent:main:subagent:stale-child')).not.toBeInTheDocument();
  });

  it.each(['darwin', 'win32'] as const)(
    'shows a child marker and returns to the exact direct parent in the %s Chat header',
    async (platform) => {
      const childKey = 'agent:main:subagent:child';
      const parentKey = 'agent:main:parent';
      window.electron.platform = platform;
      chatState.currentSessionKey = childKey;
      chatState.sessions = [
        { key: parentKey, workspacePath: '/workspace' },
        { key: childKey, workspacePath: '/workspace' },
      ];
      acpState.activeSessionKey = childKey;
      acpState.timeline = { ...emptyTimeline(), sessionId: childKey };
      getAcpSessionFamily.mockResolvedValue({
        success: true,
        current: { sessionKey: childKey, title: 'Child', updatedAt: null, parentSessionKey: parentKey },
        children: [],
      });
      const { Chat } = await import('@/pages/Chat/index');
      render(<Chat />);

      await waitFor(() => expect(screen.getByTestId('chat-subagent-marker')).toHaveTextContent('Subagent'));
      fireEvent.click(screen.getByRole('button', { name: 'Return to parent conversation' }));

      expect(attentionState.markRead).toHaveBeenCalledWith(parentKey);
      expect(chatState.switchSession).toHaveBeenCalledWith(parentKey);
    },
  );

  it('uses refreshed ACP current-member titles for a Windows child header', async () => {
    const childKey = 'agent:main:subagent:titled-child';
    const parentKey = 'agent:main:parent';
    window.electron.platform = 'win32';
    chatState.currentSessionKey = childKey;
    chatState.sessions = [
      { key: parentKey, displayName: 'Gateway parent', workspacePath: '/workspace' },
      { key: childKey, displayName: 'Conflicting Gateway child title', workspacePath: '/workspace' },
    ];
    chatState.sessionLabels = { [childKey]: 'Conflicting local child title' };
    acpState.activeSessionKey = childKey;
    acpState.timeline = { ...emptyTimeline(), sessionId: childKey };
    getAcpSessionFamily
      .mockResolvedValueOnce({
        success: true,
        current: {
          sessionKey: childKey,
          title: '[Subagent Context] ACP historical child title',
          updatedAt: null,
          parentSessionKey: parentKey,
        },
        children: [],
      })
      .mockResolvedValue({
        success: true,
        current: {
          sessionKey: childKey,
          title: '[Subagent Context] ACP refreshed child title',
          updatedAt: null,
          parentSessionKey: parentKey,
        },
        children: [],
      });
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);

    await waitFor(() => expect(screen.getByTestId('chat-session-title')).toHaveTextContent('ACP historical child title'));
    expect(screen.getByTestId('chat-session-title')).not.toHaveTextContent('Gateway');
    expect(screen.getByTestId('chat-session-title')).not.toHaveTextContent('local');

    acpState.timeline = {
      ...emptyTimeline(),
      sessionId: childKey,
      itemOrder: ['tool:refresh-family'],
      itemsById: {
        'tool:refresh-family': {
          kind: 'tool-call', id: 'tool:refresh-family', toolCallId: 'refresh-family',
          title: 'sessions_spawn: refresh family', status: 'completed',
          output: {
            details: {
              status: 'accepted',
              runId: 'refresh-run',
              childSessionKey: 'agent:main:subagent:new-child',
            },
          },
          outputParts: [], locations: [],
        },
      },
    };
    rerender(<Chat />);

    await waitFor(() => expect(getAcpSessionFamily).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('chat-session-title')).toHaveTextContent('ACP refreshed child title'));
    expect(screen.getByTestId('chat-subagent-marker')).toHaveTextContent('Subagent');
    expect(screen.getByRole('button', { name: 'Return to parent conversation' })).toBeVisible();
  });

  it('drills into a child through the existing exact session selection path', async () => {
    const childKey = 'agent:main:subagent:child';
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: childKey, workspacePath: '/workspace' },
    ];
    getAcpSessionFamily.mockResolvedValue({
      success: true,
      current: null,
      children: [{ sessionKey: childKey, title: 'Child', updatedAt: null, parentSessionKey: 'agent:main:main' }],
    });
    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    fireEvent.click(await screen.findByTestId(`mock-subagent-${childKey}`));

    expect(attentionState.markRead).toHaveBeenCalledWith(childKey);
    expect(chatState.switchSession).toHaveBeenCalledWith(childKey);
  });

  it('keeps a selected child marker but disables a deleted direct-parent target immediately', async () => {
    const childKey = 'agent:main:subagent:nested-child';
    const directParentKey = 'agent:main:subagent:direct-parent';
    window.electron.platform = 'darwin';
    chatState.currentSessionKey = childKey;
    chatState.sessions = [
      { key: directParentKey, workspacePath: '/workspace' },
      { key: childKey, workspacePath: '/workspace' },
    ];
    acpState.activeSessionKey = childKey;
    acpState.timeline = { ...emptyTimeline(), sessionId: childKey };
    getAcpSessionFamily.mockResolvedValue({
      success: true,
      current: { sessionKey: childKey, title: 'Nested child', updatedAt: null, parentSessionKey: directParentKey },
      children: [],
    });
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);

    const returnButton = await screen.findByRole('button', { name: 'Return to parent conversation' });
    chatState.sessions = [{ key: childKey, workspacePath: '/workspace' }];
    fireEvent.click(returnButton);
    expect(chatState.switchSession).not.toHaveBeenCalled();

    rerender(<Chat />);
    expect(screen.getByTestId('chat-subagent-marker')).toHaveTextContent('Subagent');
    expect(screen.queryByRole('button', { name: 'Return to parent conversation' })).not.toBeInTheDocument();
  });

  it('removes a deleted child from a loaded parent and rejects its stale click target', async () => {
    const childKey = 'agent:main:subagent:deleted-child';
    chatState.sessions = [
      { key: 'agent:main:main', workspacePath: '/workspace' },
      { key: childKey, workspacePath: '/workspace' },
    ];
    getAcpSessionFamily.mockResolvedValue({
      success: true,
      current: { sessionKey: 'agent:main:main', title: 'Parent', updatedAt: null, parentSessionKey: null },
      children: [{ sessionKey: childKey, title: 'Deleted child', updatedAt: null, parentSessionKey: 'agent:main:main' }],
    });
    const { Chat } = await import('@/pages/Chat/index');
    const { rerender } = render(<Chat />);

    const childButton = await screen.findByTestId(`mock-subagent-${childKey}`);
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/workspace' }];
    fireEvent.click(childButton);
    expect(chatState.switchSession).not.toHaveBeenCalled();

    rerender(<Chat />);
    expect(screen.queryByTestId(`mock-subagent-${childKey}`)).not.toBeInTheDocument();
  });

  it('withholds a deferred prior-session plan after the active session changes', async () => {
    const previousSessionKey = 'agent:previous:main';
    const currentSessionKey = 'agent:other:main';
    deferredAcpTimeline.value = { ...timelineWithCurrentPlan(), sessionId: previousSessionKey };
    acpState.timeline = { ...timelineWithCurrentPlan(), sessionId: currentSessionKey };
    acpState.activeSessionKey = currentSessionKey;
    chatState.currentSessionKey = currentSessionKey;

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-current-plan', '');
  });

  it('renders ACP load errors as inline timeline errors', async () => {
    acpState.error = '404 Resource not found';
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(screen.getByTestId('acp-error-banner')).toHaveTextContent('404 Resource not found');
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

  it('renders a nonblank ACP empty state', async () => {
    acpState.timeline = emptyTimeline();
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(screen.getByTestId('acp-chat-empty-state')).toHaveTextContent('What can I do for you?');
    expect(screen.queryByTestId('acp-chat-timeline')).not.toBeInTheDocument();
  });
});
