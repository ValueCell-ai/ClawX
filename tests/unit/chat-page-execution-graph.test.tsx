import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const hostApiFetchMock = vi.fn();

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [{ id: 'main', name: 'main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn(),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => {
  const state = {
    open: false,
    widthPct: 45,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  };
  return {
    useArtifactPanel: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => {
      if (typeof params === 'string') return params;
      if (key === 'executionGraph.collapsedSummary') {
        return `collapsed ${String(params?.toolCount ?? '')} ${String(params?.processCount ?? '')}`.trim();
      }
      if (key === 'executionGraph.agentRun') {
        return `Main execution`;
      }
      if (key === 'executionGraph.title') {
        return 'Execution Graph';
      }
      if (key === 'executionGraph.collapseAction') {
        return 'Collapse';
      }
      if (key === 'executionGraph.thinkingLabel') {
        return 'Thinking';
      }
      if (key.startsWith('taskPanel.stepStatus.')) {
        return key.split('.').at(-1) ?? key;
      }
      return key;
    },
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null },
    scrollRef: { current: null },
    scrollToBottom: vi.fn(),
    isAtBottom: true,
  })),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => null,
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({
    message,
    textOverride,
    isStreaming,
    suppressAssistantText,
  }: {
    message: { content?: unknown };
    textOverride?: string;
    isStreaming?: boolean;
    suppressAssistantText?: boolean;
  }) => {
    const text = typeof textOverride === 'string'
      ? textOverride
      : typeof message?.content === 'string'
        ? message.content
        : Array.isArray(message?.content)
          ? message.content
            .filter((block): block is { type?: string; text?: string } => typeof block === 'object' && block !== null)
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join(' ')
          : '';
    return (
      <div data-testid={isStreaming ? 'mock-streaming-message' : 'mock-chat-message'}>
        {suppressAssistantText ? '' : text}
      </div>
    );
  },
}));

describe('Chat execution graph lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    hostApiFetchMock.mockReset();
    hostApiFetchMock.mockResolvedValue({ success: true, messages: [] });
    agentsState.fetchAgents.mockReset();

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Checked X.' },
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-live',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        id: 'final-stream',
        content: [
          { type: 'text', text: 'Checked X.' },
          { type: 'text', text: 'Checked X. Here is the summary.' },
        ],
      },
      streamingTools: [
        {
          toolCallId: 'browser-search',
          name: 'browser',
          status: 'completed',
          updatedAt: Date.now(),
        },
      ],
      pendingFinal: true,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });
  });

  it('keeps the execution graph expanded while the reply is still streaming and shows only the reply suffix in the bubble', async () => {
    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.getByText('Here is the summary.')).toBeInTheDocument();
    expect(screen.queryByText('Checked X. Here is the summary.')).not.toBeInTheDocument();
  });

  it('renders the execution graph immediately for an active run before any stream content arrives', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-starting',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
  });

  it('renders generated file cards with line stats for edit tools', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Patch the workspace file',
        },
        {
          role: 'assistant',
          id: 'edit-turn',
          content: [
            {
              type: 'tool_use',
              id: 'edit-1',
              name: 'Edit',
              input: {
                file_path: '/workspace/demo.ts',
                old_string: 'const value = 1\n',
                new_string: 'const value = 2\n',
              },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'reply-turn',
          content: [{ type: 'text', text: 'Updated the file.' }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByText('demo.ts')).toBeInTheDocument();
    });

    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('shows a scroll-to-latest button when the chat is scrolled away from the bottom', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: Array.from({ length: 24 }, (_, idx) => ({
        role: idx % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${idx + 1}`,
        timestamp: Date.now() + idx,
      })),
      loading: false,
      error: null,
      runError: null,
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { useStickToBottomInstant } = await import('@/hooks/use-stick-to-bottom-instant');
    vi.mocked(useStickToBottomInstant).mockReturnValue({
      contentRef: { current: null },
      scrollRef: { current: null },
      scrollToBottom: vi.fn(),
      isAtBottom: false,
    } as ReturnType<typeof useStickToBottomInstant>);

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    expect(await screen.findByTestId('chat-scroll-to-latest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scrollToLatest' })).toBeInTheDocument();
  });

  it('stops showing trailing thinking and renders run error callout after terminal model error', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Checked X.' },
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: '404 Resource not found',
      runError: '404 Resource not found',
      sending: false,
      activeRunId: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.getAllByText('404 Resource not found').length).toBeGreaterThan(0);
  });

  it('keeps history final reply folded while matching streamed text is still active', async () => {
    const finalText = 'History final answer is already recorded.';
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Summarize the run',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Reading the source data.' },
            { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/tmp/source.txt' } },
          ],
        },
        {
          role: 'assistant',
          id: 'final-turn',
          content: [{ type: 'text', text: finalText }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-history-stream-race',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: finalText }],
      },
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toHaveAttribute('data-collapsed', 'false');
    });

    expect(screen.getByTestId('mock-streaming-message')).toHaveTextContent(finalText);
    expect(
      screen.getAllByTestId('mock-chat-message')
        .filter((element) => element.textContent === finalText),
    ).toHaveLength(0);
  });

  it('stops trailing thinking when history already contains the final reply but sending is stuck', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: '执行一下github1',
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'text', text: 'Fetching GitHub trending data.' },
            { type: 'tool_use', id: 'fetch-1', name: 'web_fetch', input: { url: 'https://example.com' } },
          ],
        },
        {
          role: 'assistant',
          id: 'final-turn',
          content: [{ type: 'text', text: '执行完成 ✅ 今天的 github1 已写入飞书文档。' }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-stuck',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now() - 60 * 60 * 1000,
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.getByText('执行完成 ✅ 今天的 github1 已写入飞书文档。')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-indicator')).not.toBeInTheDocument();
  });

  it('stops trailing thinking when generated image media arrives but session wake is missed', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: '生成一个小麦',
        },
        {
          role: 'assistant',
          id: 'image-tool-turn',
          content: [
            {
              type: 'toolCall',
              id: 'image-1',
              name: 'image_generate',
              arguments: { prompt: 'golden wheat' },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'message-tool-turn',
          content: [
            {
              type: 'toolCall',
              id: 'message-1',
              name: 'message',
              arguments: {
                action: 'send',
                attachments: [{ path: '/tmp/wheat.png' }],
              },
            },
          ],
        },
        {
          role: 'assistant',
          id: 'generated-image',
          content: [{
            type: 'image',
            url: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            mimeType: 'image/png',
            alt: 'wheat.png',
          }],
          _attachedFiles: [{
            fileName: 'wheat.png',
            mimeType: 'image/png',
            fileSize: 42,
            preview: 'data:image/png;base64,ok',
            gatewayUrl: '/api/chat/media/outgoing/agent%3Amain%3As-1/image-1/full',
            source: 'gateway-media',
          }],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-stuck-image',
      streamingText: '',
      streamingMessage: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: '等待图片生成完成。' }],
      },
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('chat-execution-step-thinking-trailing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-typing-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-activity-indicator')).not.toBeInTheDocument();
  });

  it('keeps the run active when narration landed in history before tools finished', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        {
          role: 'user',
          content: 'Check semiconductor chatter',
        },
        {
          role: 'assistant',
          id: 'narration-turn',
          content: [{ type: 'text', text: 'Let me search for that first.' }],
        },
        {
          role: 'assistant',
          id: 'tool-turn',
          content: [
            { type: 'tool_use', id: 'browser-search', name: 'browser', input: { action: 'search', query: 'semiconductor' } },
          ],
        },
      ],
      loading: false,
      error: null,
      runError: null,
      sending: true,
      activeRunId: 'run-narration',
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: Date.now(),
      pendingToolImages: [],
      sessions: [{ key: 'agent:main:main' }],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessionLabels: {},
      sessionLastActivity: {},
      thinkingLevel: null,
    });

    const { Chat } = await import('@/pages/Chat/index');

    render(<Chat />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-execution-step-thinking-trailing')).toBeInTheDocument();
    });
  });
});
