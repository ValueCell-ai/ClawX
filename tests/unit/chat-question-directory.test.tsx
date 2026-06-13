import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from '@/pages/Chat';

vi.mock('react-i18next', () => ({
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

const chatState = {
  messages: [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'reply 1' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'reply 2' },
  ],
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
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  clearError: vi.fn(),
  loadMoreHistory: vi.fn(),
  loadHistory: vi.fn(),
  refresh: vi.fn(),
  cleanupEmptySession: vi.fn(),
  lastUserMessageAt: null,
};

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string; workspace: string }>; fetchAgents: () => void }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
    fetchAgents: vi.fn(),
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

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: { content?: unknown } }) => <div>{typeof message.content === 'string' ? message.content : ''}</div>,
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => null,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

vi.mock('@/pages/Chat/ExecutionGraphCard', () => ({
  ExecutionGraphCard: () => null,
}));

describe('Chat question directory', () => {
  it('keeps real repeated questions as separate directory entries', async () => {
    render(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    fireEvent.click(await screen.findByTestId('chat-question-directory-toggle'));

    const directory = await screen.findByTestId('chat-question-directory');
    expect(directory).toBeInTheDocument();
    expect(directory.querySelectorAll('button')).toHaveLength(2);
  });

  it('includes the latest question in the directory list', async () => {
    const latestQuestion = '给我生成一只哈密瓜';
    const originalMessages = chatState.messages;
    chatState.messages = [
      ...Array.from({ length: 13 }, (_, idx) => ([
        { role: 'user', content: `question ${idx + 1}` },
        { role: 'assistant', content: `reply ${idx + 1}` },
      ])).flat(),
      { role: 'user', content: latestQuestion },
      { role: 'assistant', content: 'generated image' },
    ];

    try {
      render(
        <TooltipProvider>
          <Chat />
        </TooltipProvider>,
      );

      fireEvent.click(await screen.findByTestId('chat-question-directory-toggle'));

      const lastUserIndex = chatState.messages.length - 2;
      expect(screen.getByTestId(`chat-question-directory-item-${lastUserIndex}`)).toHaveTextContent(latestQuestion);
    } finally {
      chatState.messages = originalMessages;
    }
  });
});
