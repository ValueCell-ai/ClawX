import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Chat } from '@/pages/Chat';

const chatState = {
  currentSessionKey: 'agent:main:main',
  currentAgentId: 'main',
  messages: [],
  sending: false,
  error: null as string | null,
  runError: null as string | null,
  lastUserMessageAt: null as number | null,
  sendMessage: vi.fn(),
  abortRun: vi.fn(),
  refresh: vi.fn(),
  clearError: vi.fn(),
  cleanupEmptySession: vi.fn(),
};

const agentsState = {
  agents: [{ id: 'main', name: 'main', workspace: '/workspace' }],
  fetchAgents: vi.fn(),
};

const artifactPanelState = {
  open: false,
  widthPct: 34,
  openChanges: vi.fn(),
  openPreview: vi.fn(),
  close: vi.fn(),
};

const gatewayState = {
  status: { state: 'running', gatewayReady: true },
};

const openClawSurfaceState = {
  visibleItems: [] as VisibleChatItem[],
  core: {
    runtime: {
      runStatus: null,
    },
  },
  initHostSubscriptions: vi.fn(),
  disposeHostSubscriptions: vi.fn(),
  setSessionKey: vi.fn(),
  loadHistory: vi.fn(),
  enqueueOptimisticUserMessage: vi.fn(),
  setThinkingLevel: vi.fn(),
  abortRun: vi.fn(),
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
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
}));

vi.mock('@/stores/openclaw-chat-surface', () => ({
  useOpenClawChatSurfaceStore: (selector: (state: typeof openClawSurfaceState) => unknown) => selector(openClawSurfaceState),
}));

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => null,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: ({
    onSend,
    onStop,
    sending,
    draftScopeKey,
  }: {
    onSend: (text: string) => void;
    onStop?: () => void;
    sending?: boolean;
    draftScopeKey?: string;
  }) => (
    <button
      type="button"
      data-sending={sending ? 'true' : 'false'}
      data-draft-scope-key={draftScopeKey}
      data-testid="mock-chat-input"
      onClick={() => {
        if (sending) onStop?.();
        else onSend('hello from composer');
      }}
    >
      {sending ? 'Stop' : 'Send'}
    </button>
  ),
}));

function renderChatPage() {
  return render(
    <TooltipProvider>
      <Chat />
    </TooltipProvider>,
  );
}

describe('Chat page OpenClaw surface lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers();
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    chatState.messages = [];
    chatState.sending = false;
    chatState.error = null;
    chatState.runError = null;
    chatState.lastUserMessageAt = null;
    chatState.sendMessage.mockReset();
    chatState.abortRun.mockReset();
    chatState.refresh.mockReset();
    chatState.clearError.mockReset();
    chatState.cleanupEmptySession.mockReset();

    agentsState.fetchAgents.mockReset();
    gatewayState.status = { state: 'running', gatewayReady: true };
    artifactPanelState.open = false;
    artifactPanelState.widthPct = 34;
    artifactPanelState.openChanges.mockReset();
    artifactPanelState.openPreview.mockReset();
    artifactPanelState.close.mockReset();

    openClawSurfaceState.visibleItems = [];
    openClawSurfaceState.core.runtime.runStatus = null;
    openClawSurfaceState.initHostSubscriptions.mockReset();
    openClawSurfaceState.disposeHostSubscriptions.mockReset();
    openClawSurfaceState.setSessionKey.mockReset();
    openClawSurfaceState.loadHistory.mockReset();
    openClawSurfaceState.loadHistory.mockResolvedValue(undefined);
    openClawSurfaceState.enqueueOptimisticUserMessage.mockReset();
    openClawSurfaceState.setThinkingLevel.mockReset();
    openClawSurfaceState.abortRun.mockReset();
    openClawSurfaceState.resolveApproval.mockReset();
  });

  it('renders OpenClaw visible messages on the page surface', async () => {
    openClawSurfaceState.visibleItems = [
      { kind: 'message', id: 'u1', message: { id: 'u1', role: 'user', content: 'hello' } },
      { kind: 'message', id: 'a1', message: { id: 'a1', role: 'assistant', content: 'hi **there**' } },
    ];

    renderChatPage();

    expect(screen.getByTestId('openclaw-chat-surface')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('there')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(openClawSurfaceState.loadHistory).toHaveBeenCalled();
    });
  });

  it('loads OpenClaw history when the gateway becomes running after startup', async () => {
    gatewayState.status = { state: 'starting', gatewayReady: false };

    const { rerender } = renderChatPage();

    await Promise.resolve();
    expect(openClawSurfaceState.setSessionKey).toHaveBeenCalledWith('agent:main:main', 'main');
    expect(openClawSurfaceState.loadHistory).not.toHaveBeenCalled();

    gatewayState.status = { state: 'running', gatewayReady: true };
    rerender(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(openClawSurfaceState.loadHistory).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the composer pulse for a running OpenClaw status without a full chat row', () => {
    openClawSurfaceState.core.runtime.runStatus = { phase: 'running', runId: 'run-1' };

    renderChatPage();

    expect(screen.getByTestId('chat-running-pulse')).toBeInTheDocument();
    expect(screen.getByTestId('chat-running-pulse')).toHaveClass('max-w-3xl');
    expect(screen.queryByTestId('chat-run-status')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-sending', 'true');
  });

  it('stops both OpenClaw surface runs and the legacy sender', () => {
    openClawSurfaceState.core.runtime.runStatus = { phase: 'running', runId: 'run-1' };

    renderChatPage();
    fireEvent.click(screen.getByTestId('mock-chat-input'));

    expect(openClawSurfaceState.abortRun).toHaveBeenCalledTimes(1);
    expect(chatState.abortRun).toHaveBeenCalledTimes(1);
  });

  it('bridges composer sends into the OpenClaw optimistic queue and legacy sender', () => {
    renderChatPage();

    fireEvent.click(screen.getByTestId('mock-chat-input'));

    expect(openClawSurfaceState.setSessionKey).toHaveBeenCalledWith('agent:main:main', 'main');
    expect(openClawSurfaceState.enqueueOptimisticUserMessage).toHaveBeenCalledWith('hello from composer', undefined);
    expect(chatState.sendMessage).toHaveBeenCalledWith('hello from composer', undefined, undefined);
    expect(screen.getByTestId('mock-chat-input')).toHaveAttribute('data-draft-scope-key', 'agent:main:main');
  });

  it('reloads OpenClaw surface history after a blocking legacy send completes', async () => {
    vi.useFakeTimers();
    chatState.sendMessage.mockResolvedValue(undefined);

    renderChatPage();
    await Promise.resolve();
    await Promise.resolve();
    openClawSurfaceState.loadHistory.mockClear();

    fireEvent.click(screen.getByTestId('mock-chat-input'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    const immediateReloads = openClawSurfaceState.loadHistory.mock.calls.length;
    expect(immediateReloads).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(500);
    const delayedReloads = openClawSurfaceState.loadHistory.mock.calls.length;
    expect(delayedReloads).toBeGreaterThan(immediateReloads);

    chatState.currentSessionKey = 'agent:main:other';
    await vi.advanceTimersByTimeAsync(1000);
    expect(openClawSurfaceState.loadHistory).toHaveBeenCalledTimes(delayedReloads);
  });

  it('synchronizes the OpenClaw surface session before enqueueing an optimistic send', () => {
    chatState.currentSessionKey = 'agent:main:session-new';
    chatState.currentAgentId = 'main';

    renderChatPage();
    openClawSurfaceState.setSessionKey.mockClear();
    openClawSurfaceState.enqueueOptimisticUserMessage.mockClear();

    fireEvent.click(screen.getByTestId('mock-chat-input'));

    expect(openClawSurfaceState.setSessionKey).toHaveBeenCalledWith('agent:main:session-new', 'main');
    expect(openClawSurfaceState.enqueueOptimisticUserMessage).toHaveBeenCalledWith('hello from composer', undefined);
    expect(chatState.sendMessage).toHaveBeenCalledWith('hello from composer', undefined, undefined);
  });

  it('reloads the OpenClaw surface when legacy history changes without a terminal stream event', async () => {
    const { rerender } = renderChatPage();

    await waitFor(() => {
      expect(openClawSurfaceState.loadHistory).toHaveBeenCalled();
    });
    openClawSurfaceState.loadHistory.mockClear();

    chatState.messages = [
      { id: 'legacy-user-think', role: 'user', content: '/think high' },
      {
        id: 'legacy-gateway-visible-error',
        role: 'assistant',
        content: [{
          type: 'text',
          text: 'Thinking level "high" is not supported for custom-customec/glm-5.2. Use one of: off.',
        }],
        model: 'gateway-injected',
        provider: 'openclaw',
      },
    ];

    rerender(
      <TooltipProvider>
        <Chat />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(openClawSurfaceState.loadHistory).toHaveBeenCalledTimes(1);
    });
  });
});
