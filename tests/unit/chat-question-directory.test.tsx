import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('lists repeated ACP questions and smoothly scrolls to the selected user message', () => {
    acpState.timeline = timelineFromQuestions(['hello', 'hello']);

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    const toggle = screen.getByTestId('chat-question-directory-toggle');
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-controls', 'chat-question-directory');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('acp-user-message')).toHaveLength(2);
    expect(screen.getAllByText('hello')).toHaveLength(2);

    fireEvent.click(toggle);

    const directory = screen.getByTestId('chat-question-directory');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(directory).toHaveAttribute('id', 'chat-question-directory');
    expect(directory).toHaveClass('max-h-[40vh]', 'overflow-hidden');
    expect(within(directory).getByRole('navigation')).toHaveClass(
      'max-h-[calc(40vh-5rem)]',
      'lg:max-h-[calc(100vh-13rem)]',
      'overflow-y-auto',
    );
    expect(within(directory).getAllByTestId(/^chat-question-directory-item-/)).toHaveLength(2);
    const scrollColumn = screen.getByTestId('chat-scroll-column');
    const scrollToLatest = screen.getByTestId('chat-scroll-to-latest');
    expect(scrollColumn).toContainElement(scrollToLatest);
    expect(directory).not.toContainElement(scrollToLatest);

    const firstUserMessage = document.getElementById('acp-user-message-msg-user:0');
    const secondUserMessage = document.getElementById('acp-user-message-msg-user:1');
    expect(firstUserMessage).toBeInTheDocument();
    expect(secondUserMessage).toBeInTheDocument();
    if (!firstUserMessage) throw new Error('Expected the first ACP user message anchor');

    const scrollIntoView = vi.fn();
    firstUserMessage.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByTestId('chat-question-directory-item-msg-user:0'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('disables the question directory for zero and one ACP user messages', () => {
    const { rerender } = render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('chat-question-directory-toggle')).toBeDisabled();

    acpState.timeline = timelineFromQuestions(['hello']);
    rerender(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    expect(screen.getByTestId('chat-question-directory-toggle')).toBeDisabled();
  });

  it('caps long question directory titles without changing their scroll target', () => {
    const longQuestion = 'a'.repeat(65);
    const expectedTitle = `${longQuestion.slice(0, 61)}...`;
    acpState.timeline = timelineFromQuestions([longQuestion, 'another question']);

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-question-directory-toggle'));

    const entry = screen.getByTestId('chat-question-directory-item-msg-user:0');
    expect(entry.textContent).toBe(expectedTitle);
    expect(entry).toHaveAttribute('title', expectedTitle);

    const userMessage = document.getElementById('acp-user-message-msg-user:0');
    if (!userMessage) throw new Error('Expected the long ACP user message anchor');
    const scrollIntoView = vi.fn();
    userMessage.scrollIntoView = scrollIntoView;

    fireEvent.click(entry);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('keeps grapheme clusters intact when truncating question directory titles', () => {
    const emoji = '👩‍💻';
    const question = `${'a'.repeat(60)}${emoji} with additional detail`;
    const expectedTitle = `${'a'.repeat(60)}${emoji}...`;
    acpState.timeline = timelineFromQuestions([question, 'another question']);

    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByTestId('chat-question-directory-toggle'));

    const entry = screen.getByTestId('chat-question-directory-item-msg-user:0');
    expect(entry.textContent).toBe(expectedTitle);
    expect(entry.textContent).not.toContain('\uFFFD');
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
    expect(screen.getByTestId('chat-question-directory-toggle')).toBeEnabled();
  });
});
