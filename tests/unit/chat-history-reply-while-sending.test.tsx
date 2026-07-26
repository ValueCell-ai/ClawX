import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chat } from '@/pages/Chat';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

const { acpState, agentsState, artifactPanelState, chatState, settingsState } = vi.hoisted(() => ({
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
  agentsState: {
    agents: [{ id: 'main', name: 'main', workspace: '/workspace', mainSessionKey: 'agent:main:main' }] as Array<Record<string, unknown>>,
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  },
  artifactPanelState: {
    open: false,
    widthPct: 34,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
    openBrowser: vi.fn(),
    tab: 'changes',
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

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/artifact-panel', () => ({
  useArtifactPanel: (selector: (state: typeof artifactPanelState) => unknown) => selector(artifactPanelState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
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
      if (key === 'welcome.subtitle') return 'What can I do for you?';
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

vi.mock('@/components/file-preview/ArtifactPanel', () => ({
  ArtifactPanel: () => null,
}));

vi.mock('@/components/file-preview/PanelResizeDivider', () => ({
  PanelResizeDivider: () => null,
}));

function timelineWithAssistantReply(): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:main:main',
    loadGeneration: 1,
    itemOrder: ['msg-user:0', 'msg-assistant:0'],
    itemsById: {
      'msg-user:0': {
        kind: 'message-segment',
        id: 'msg-user:0',
        role: 'user',
        messageId: 'msg-user',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: '你好' }],
      },
      'msg-assistant:0': {
        kind: 'message-segment',
        id: 'msg-assistant:0',
        role: 'assistant',
        messageId: 'msg-assistant',
        segmentIndex: 0,
        parts: [{ kind: 'markdown', text: '你好，我在。' }],
      },
    },
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

describe('Chat history reply while sending', () => {
  beforeEach(() => {
    ensureAcpChatSubscriptions.mockReset();
    acpState.timeline = timelineWithAssistantReply();
    acpState.loading = false;
    acpState.sending = true;
    acpState.cancelling = false;
    acpState.error = null;
    acpState.activeSessionKey = 'agent:main:main';
    acpState.cwd = '/workspace';
    acpState.loadSession.mockReset();
    acpState.loadSession.mockResolvedValue(true);
    agentsState.fetchAgents.mockReset();
    agentsState.fetchAgents.mockResolvedValue(undefined);
    artifactPanelState.open = false;
    artifactPanelState.close.mockReset();
    chatState.sessions = [{ key: 'agent:main:main', workspacePath: '/workspace' }];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.currentAgentId = 'main';
    settingsState.chatWorkspacePath = '/workspace';
  });

  it('shows assistant reply from the ACP timeline even when sending is still true', () => {
    render(<Chat />);

    expect(screen.getByText('你好，我在。')).toBeTruthy();
    expect(screen.queryByText('Thinking')).toBeNull();
  });
});
