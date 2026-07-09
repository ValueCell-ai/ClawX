import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from '@/pages/Chat';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      if (key === 'questionDirectory.fallback') return `Question ${String(options?.number ?? '')}`;
      if (key === 'questionDirectory.moreHint') return `${String(options?.count ?? '')} more questions not shown`;
      if (key === 'toolbar.currentAgent') return `Talking to ${String(options?.agent ?? '')}`;
      return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
    },
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

const { acpState, chatState, settingsState } = vi.hoisted(() => ({
  acpState: {
    timeline: {
      sessionId: 'agent:main:main',
      loadGeneration: 1,
      itemOrder: [],
      itemsById: {},
      metadata: {},
      openMessageSegments: {},
      segmentCounts: {},
    } as AcpTimelineSnapshot,
    loading: false,
    sending: false,
    cancelling: false,
    error: null as string | null,
    activeSessionKey: 'agent:main:main' as string | null,
    cwd: '/workspace' as string | null,
    prepareLocalSession: vi.fn(),
    loadSession: vi.fn().mockResolvedValue(true),
    sendPrompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
    clearError: vi.fn(),
  },
  chatState: {
    sessions: [{ key: 'agent:main:main', workspacePath: '/workspace' }],
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    loading: false,
    refresh: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue(undefined),
    selectAcpSession: vi.fn(),
    acknowledgeAcpSessionCreated: vi.fn(),
  },
  settingsState: {
    chatWorkspacePath: '/workspace',
    setChatWorkspacePath: vi.fn(),
  },
}));

const ensureAcpChatSubscriptions = vi.hoisted(() => vi.fn());

vi.mock('@/stores/acp-chat-session', () => ({
  ensureAcpChatSubscriptions,
  useAcpChatSessionStore: (selector: (state: typeof acpState) => unknown) => selector(acpState),
}));

const legacyChatFields = {
  currentSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  sessionLabels: {},
  loadingMoreHistory: false,
  hasMoreHistory: false,
  sending: false,
  error: null,
  runError: null,
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  activeRunId: null,
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  clearError: vi.fn(),
  loadMoreHistory: vi.fn(),
  loadHistory: vi.fn(),
  cleanupEmptySession: vi.fn(),
  lastUserMessageAt: null,
};

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState & typeof legacyChatFields) => unknown) => selector({
    ...legacyChatFields,
    ...chatState,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string; workspace: string }>; fetchAgents: () => void }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: { open: boolean; widthPct: number; openChanges: () => void; openPreview: () => void; close: () => void; openBrowser: () => void; tab: string }) => unknown) => selector({
    open: false,
    widthPct: 34,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
    openBrowser: vi.fn(),
    tab: 'changes',
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => null,
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => null,
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

function timelineFromQuestions(questions: string[]): AcpTimelineSnapshot {
  const itemOrder: string[] = [];
  const itemsById: AcpTimelineSnapshot['itemsById'] = {};

  questions.forEach((question, index) => {
    const userId = `msg-user:${index}`;
    const assistantId = `msg-assistant:${index}`;
    itemOrder.push(userId, assistantId);
    itemsById[userId] = {
      kind: 'message-segment',
      id: userId,
      role: 'user',
      messageId: `msg-user-${index}`,
      segmentIndex: 0,
      parts: [{ kind: 'markdown', text: question }],
    };
    itemsById[assistantId] = {
      kind: 'message-segment',
      id: assistantId,
      role: 'assistant',
      messageId: `msg-assistant-${index}`,
      segmentIndex: 0,
      parts: [{ kind: 'markdown', text: `reply ${index + 1}` }],
    };
  });

  return {
    ...emptyTimeline(),
    itemOrder,
    itemsById,
  };
}

describe('Chat question directory', () => {
  beforeEach(() => {
    ensureAcpChatSubscriptions.mockReset();
    acpState.timeline = emptyTimeline();
    acpState.loading = false;
    acpState.sending = false;
    acpState.cancelling = false;
    acpState.error = null;
    acpState.activeSessionKey = 'agent:main:main';
    acpState.cwd = '/workspace';
    acpState.loadSession.mockReset();
    acpState.loadSession.mockResolvedValue(true);
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/workspace' }];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    chatState.refresh.mockReset();
    settingsState.chatWorkspacePath = '/workspace';
  });

  it('renders repeated ACP questions as separate timeline messages while the legacy directory is disabled', () => {
    acpState.timeline = timelineFromQuestions(['hello', 'hello']);

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    expect(screen.getAllByTestId('acp-user-message')).toHaveLength(2);
    expect(screen.getAllByText('hello')).toHaveLength(2);
    expect(screen.getByTestId('chat-question-directory-toggle')).toBeDisabled();
    expect(screen.queryByTestId('chat-question-directory')).not.toBeInTheDocument();
  });

  it('includes the latest ACP question in the timeline', () => {
    const latestQuestion = '给我生成一只哈密瓜';
    acpState.timeline = timelineFromQuestions([
      ...Array.from({ length: 13 }, (_, idx) => `question ${idx + 1}`),
      latestQuestion,
    ]);

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    expect(screen.getByText(latestQuestion)).toBeInTheDocument();
    expect(screen.getByTestId('chat-question-directory-toggle')).toBeDisabled();
  });
});
