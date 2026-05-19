import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { gatewayState, agentsState } = vi.hoisted(() => ({
  gatewayState: { status: { state: 'running', port: 18789 } },
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

vi.mock('@/pages/Chat/ChatToolbar', () => ({ ChatToolbar: () => null }));
vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => null }));

describe('Chat leading orphan tool folding', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hides paginated-prefix tool rows and folds them into the first user execution graph', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      messages: [
        { role: 'assistant', id: 'orphan-exec', content: [{ type: 'toolCall', id: 'e1', name: 'exec', input: {} }] },
        { role: 'assistant', id: 'orphan-image', content: [{ type: 'toolCall', id: 'i1', name: 'image', input: {} }] },
        { role: 'user', id: 'user-1', content: 'Continue the task' },
        { role: 'assistant', id: 'reply', content: [{ type: 'text', text: 'Finished.' }] },
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

    expect(screen.queryByTestId('chat-message-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-message-1')).not.toBeInTheDocument();
    expect(screen.getByText('Finished.')).toBeInTheDocument();
  });
});
