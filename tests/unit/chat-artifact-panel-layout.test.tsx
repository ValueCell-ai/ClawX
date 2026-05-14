import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chat } from '@/pages/Chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? '',
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

const chatState = {
  messages: [],
  currentSessionKey: 'main:test',
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
  useArtifactPanel: (selector: (state: { open: boolean; widthPct: number; openChanges: () => void; openPreview: () => void; close: () => void }) => unknown) => selector({
    open: true,
    widthPct: 34,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => <div data-testid="artifact-panel" />,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => <div data-testid="panel-resize-divider" />,
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: () => ({
    contentRef: { current: null },
    scrollRef: { current: null },
  }),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: (value: boolean) => value,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => <div data-testid="chat-toolbar" />,
}));

describe('Chat artifact panel layout', () => {
  it('layers the right artifact panel above the macOS drag strip', async () => {
    window.electron.platform = 'darwin';

    render(<Chat />);

    const panel = await screen.findByTestId('artifact-panel');
    const aside = panel.closest('aside');

    expect(aside).toHaveClass('relative');
    expect(aside).toHaveClass('z-20');
  });
});
