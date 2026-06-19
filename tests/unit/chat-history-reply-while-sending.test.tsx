import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { Chat } from '@/pages/Chat';

const chatState = {
  currentSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  messages: [],
  sending: true,
  error: null as string | null,
  runError: null as string | null,
  lastUserMessageAt: Date.now(),
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  refresh: vi.fn(),
  clearError: vi.fn(),
  cleanupEmptySession: vi.fn(),
};

const openClawSurfaceState = {
  visibleItems: [] as VisibleChatItem[],
  core: {
    runtime: {
      runStatus: { phase: 'running', runId: 'run-1' },
    },
  },
  initHostSubscriptions: vi.fn(),
  disposeHostSubscriptions: vi.fn(),
  setSessionKey: vi.fn(),
  setThinkingLevel: vi.fn(),
  loadHistory: vi.fn(),
  enqueueOptimisticUserMessage: vi.fn(),
  resolveApproval: vi.fn(),
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => (
      typeof options === 'string' ? options : key
    ),
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: { status: { state: string; gatewayReady: boolean } }) => unknown) => selector({
    status: { state: 'running', gatewayReady: true },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: { agents: Array<{ id: string; name: string }>; fetchAgents: () => void }) => unknown) => selector({
    agents: [{ id: 'main', name: 'main' }],
    fetchAgents: vi.fn(),
  }),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/openclaw-chat-surface', () => ({
  useOpenClawChatSurfaceStore: (selector: (state: typeof openClawSurfaceState) => unknown) => selector(openClawSurfaceState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: { open: boolean; widthPct: number; openChanges: () => void; openPreview: () => void; close: () => void }) => unknown) => selector({
    open: false,
    widthPct: 34,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({ ChatToolbar: () => null }));
vi.mock('@/pages/Chat/ChatInput', () => ({ ChatInput: () => null }));

describe('Chat history reply while sending', () => {
  beforeEach(() => {
    chatState.sending = true;
    chatState.error = null;
    chatState.runError = null;
    chatState.lastUserMessageAt = Date.now();
    openClawSurfaceState.visibleItems = [
      { kind: 'message', id: 'u1', message: { role: 'user', id: 'u1', content: '你好' } },
      {
        kind: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          id: 'a1',
          content: [{ type: 'text', text: '你好，我在。' }],
        },
      },
    ];
    openClawSurfaceState.core.runtime.runStatus = { phase: 'running', runId: 'run-1' };
    openClawSurfaceState.loadHistory.mockReset();
    openClawSurfaceState.loadHistory.mockResolvedValue(undefined);
  });

  it('shows assistant history while the legacy composer is still marked sending', () => {
    render(<Chat />);

    expect(screen.getByText('你好，我在。')).toBeInTheDocument();
    expect(screen.getByTestId('chat-running-pulse')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-run-status')).not.toBeInTheDocument();
  });
});
