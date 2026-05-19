import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => {
      if (typeof params === 'string') return params;
      if (key === 'executionGraph.collapsedSummary') {
        return `collapsed ${String(params?.toolCount ?? '')} ${String(params?.processCount ?? '')}`.trim();
      }
      if (key === 'executionGraph.agentRun') return 'Main execution';
      if (key === 'executionGraph.title') return 'Execution Graph';
      if (key === 'executionGraph.collapseAction') return 'Collapse';
      if (key === 'executionGraph.thinkingLabel') return 'Thinking';
      if (key.startsWith('taskPanel.stepStatus.')) return key.split('.').at(-1) ?? key;
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

describe('Chat tool card suppression', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not render standalone tool cards for messages inside a user run segment', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'user', content: 'Generate assets' },
        {
          role: 'assistant',
          id: 'tool-exec',
          content: [{ type: 'tool_use', id: 'exec-1', name: 'exec', input: { command: 'ls' } }],
        },
        {
          role: 'assistant',
          id: 'tool-image',
          content: [{ type: 'tool_use', id: 'image-1', name: 'image', input: { path: '/tmp/a.png' } }],
        },
        {
          role: 'assistant',
          id: 'tool-process',
          content: [{ type: 'tool_use', id: 'process-1', name: 'process', input: { action: 'list' } }],
        },
        {
          role: 'assistant',
          id: 'reply',
          content: [{ type: 'text', text: 'All done.' }],
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
      expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
    });

    expect(screen.queryByText('exec')).not.toBeInTheDocument();
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-execution-graph')).toBeInTheDocument();
  });
});
