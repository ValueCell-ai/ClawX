import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSessionActivityMs } from '@/components/layout/session-buckets';
import {
  Sidebar,
  getWorkspaceGroupRenameTestId,
  getWorkspaceGroupStateKey,
  getWorkspaceGroupTestId,
  getWorkspaceGroupToggleTestId,
} from '@/components/layout/Sidebar';
import { formatSessionRelativeTime } from '@/lib/relative-time';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useSettingsStore } from '@/stores/settings';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();
const initialGatewayState = useGatewayStore.getState();
const initialSessionAttentionState = useSessionAttentionStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialElectronPlatform = window.electron?.platform;
const sidebarSessionKey = 'agent:main:session-sidebar-test';

function renderSidebar(initialEntry = '/') {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      React.createElement(Sidebar),
    ),
  );
}

function seedSidebarState(renameSession = vi.fn().mockResolvedValue(undefined)) {
  if (window.electron) {
    window.electron.platform = 'linux';
  }
  useSettingsStore.setState({
    sidebarCollapsed: false,
    sidebarWidth: 280,
    devModeUnlocked: false,
  });
  useGatewayStore.setState({
    status: { state: 'stopped', port: 18789 },
  });
  useAgentsStore.setState({
    fetchAgents: vi.fn().mockResolvedValue(undefined),
  });
  useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });
  useChatStore.setState({
    sessions: [{ key: sidebarSessionKey, displayName: 'Original title', updatedAt: 1 }],
    currentSessionKey: sidebarSessionKey,
    sessionLabels: {},
    sessionLastActivity: { [sidebarSessionKey]: 1 },
    renameSession,
    loadHistory: vi.fn().mockResolvedValue(undefined),
    loadSessions: vi.fn().mockResolvedValue(undefined),
  });
}

afterEach(() => {
  cleanup();
  if (window.electron && initialElectronPlatform) {
    window.electron.platform = initialElectronPlatform;
  }
  useAgentsStore.setState(initialAgentsState, true);
  useChatStore.setState(initialChatState, true);
  useGatewayStore.setState(initialGatewayState, true);
  useSessionAttentionStore.setState(initialSessionAttentionState, true);
  useSettingsStore.setState(initialSettingsState, true);
  localStorage.removeItem('clawx.session-attention');
});

describe('sidebar session helpers', () => {
  it('hides locally-created empty sessions until they have content', () => {
    const pendingKey = 'agent:main:session-pending';
    seedSidebarState();
    useChatStore.setState({
      sessions: [
        { key: pendingKey, displayName: pendingKey, createdLocally: true },
        { key: sidebarSessionKey, displayName: 'Existing chat', updatedAt: 1 },
      ],
      currentSessionKey: pendingKey,
      sessionLastActivity: { [sidebarSessionKey]: 1 },
    });

    renderSidebar();

    expect(screen.queryByTestId(`sidebar-session-${pendingKey}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`sidebar-session-${sidebarSessionKey}`)).toBeInTheDocument();
  });

  it('hides locally-created empty sessions until they have content', () => {
    const pendingKey = 'agent:main:session-pending';
    seedSidebarState();
    useChatStore.setState({
      sessions: [
        { key: sidebarSessionKey, displayName: 'Existing chat', updatedAt: 1 },
        { key: pendingKey, displayName: pendingKey, createdLocally: true, updatedAt: 2 },
      ],
      currentSessionKey: pendingKey,
      sessionLastActivity: { [sidebarSessionKey]: 1 },
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-${sidebarSessionKey}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-${pendingKey}`)).not.toBeInTheDocument();
  });

  it('marks the current chat session button as the current page', () => {
    seedSidebarState();

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-${sidebarSessionKey}`)).toHaveAttribute('aria-current', 'page');
  });

  it('renders the relative timestamp for an idle read session', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Finished reply',
        status: 'done',
        hasActiveRun: false,
        updatedAt: 1,
      }],
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-time-${sidebarSessionKey}`)).toHaveAttribute(
      'title',
      new Date(1).toLocaleString(),
    );
    expect(screen.queryByTestId(`sidebar-session-busy-${sidebarSessionKey}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-unread-${sidebarSessionKey}`)).not.toBeInTheDocument();
  });

  it('renders an accessible busy indicator without a timestamp', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Active reply',
        status: 'running',
        hasActiveRun: true,
        updatedAt: 1,
      }],
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-busy-${sidebarSessionKey}`)).toHaveAccessibleName('AI is replying');
    expect(screen.queryByTestId(`sidebar-session-time-${sidebarSessionKey}`)).not.toBeInTheDocument();
  });

  it('lets terminal status override stale active state and follows attention', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Completed reply',
        status: 'done',
        hasActiveRun: true,
        updatedAt: 1,
      }],
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: false, unread: true } },
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-unread-${sidebarSessionKey}`)).toHaveAccessibleName('Unread reply');
    expect(screen.queryByTestId(`sidebar-session-busy-${sidebarSessionKey}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-time-${sidebarSessionKey}`)).not.toBeInTheDocument();

    act(() => useSessionAttentionStore.getState().markRead(sidebarSessionKey));

    expect(screen.getByTestId(`sidebar-session-time-${sidebarSessionKey}`)).toBeInTheDocument();
  });

  it('renders an accessible unread indicator without a timestamp for idle sessions', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Unread reply',
        hasActiveRun: false,
        updatedAt: 1,
      }],
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: false, unread: true } },
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-unread-${sidebarSessionKey}`)).toHaveAccessibleName('Unread reply');
    expect(screen.queryByTestId(`sidebar-session-time-${sidebarSessionKey}`)).not.toBeInTheDocument();
  });

  it('keeps persisted observed busy visible while live status is unknown', () => {
    seedSidebarState();
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: true, unread: false } },
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-busy-${sidebarSessionKey}`)).toHaveAccessibleName('AI is replying');
    expect(screen.queryByTestId(`sidebar-session-time-${sidebarSessionKey}`)).not.toBeInTheDocument();
  });

  it('gives busy state precedence over an older unread marker', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'New active reply',
        hasActiveRun: true,
        updatedAt: 1,
      }],
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: true, unread: true } },
    });

    renderSidebar();

    expect(screen.getByTestId(`sidebar-session-busy-${sidebarSessionKey}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-unread-${sidebarSessionKey}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`sidebar-session-time-${sidebarSessionKey}`)).not.toBeInTheDocument();
  });

  it('marks an unread row read before reloading the selected session and restores its timestamp', () => {
    const originalMarkRead = useSessionAttentionStore.getState().markRead;
    const markRead = vi.fn((sessionKey: string) => originalMarkRead(sessionKey));
    const loadHistory = vi.fn(() => {
      expect(useSessionAttentionStore.getState().bySessionKey[sidebarSessionKey]?.unread).toBe(false);
      return Promise.resolve();
    });
    seedSidebarState();
    useChatStore.setState({
      loadHistory,
    });
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: false, unread: true } },
      markRead,
    });
    renderSidebar();

    fireEvent.click(screen.getByTestId(`sidebar-session-${sidebarSessionKey}`));

    expect(markRead).toHaveBeenCalledWith(sidebarSessionKey);
    expect(loadHistory).toHaveBeenCalledWith(false);
    expect(screen.getByTestId(`sidebar-session-time-${sidebarSessionKey}`)).toBeInTheDocument();
  });

  it('does not treat a retained current session as visible or read on Settings', () => {
    seedSidebarState();
    useSessionAttentionStore.setState({
      bySessionKey: { [sidebarSessionKey]: { observedBusy: false, unread: true } },
    });

    renderSidebar('/settings');

    expect(screen.getByTestId(`sidebar-session-${sidebarSessionKey}`)).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId(`sidebar-session-unread-${sidebarSessionKey}`)).toBeInTheDocument();
    expect(useSessionAttentionStore.getState().bySessionKey[sidebarSessionKey]?.unread).toBe(true);
  });

  it('uses the formatted cache for long explicit labels with working-directory markers', () => {
    const rawLabel = '[Working directory: /user-chosen]\n  A deliberately long manual label that must use the cache display text.  ';
    const displayLabel = '[Working directory: /user-chosen]\n  A deliberately…';
    seedSidebarState();
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Original title',
        label: rawLabel,
        updatedAt: 1,
      }],
      sessionLabels: { [sidebarSessionKey]: displayLabel },
    });

    renderSidebar();

    const sessionRow = screen.getByTestId(`sidebar-session-${sidebarSessionKey}`);
    expect(sessionRow).toHaveTextContent(displayLabel.replace(/\s+/g, ' '));
    expect(sessionRow).not.toHaveTextContent('long manual label that must use the cache display text');
  });

  it('uses an icon-only collapse-all control with an accessible label', () => {
    seedSidebarState();

    renderSidebar();

    const toggleAll = screen.getByTestId('session-list-toggle-all');
    expect(toggleAll).toHaveAccessibleName('Collapse all');
    expect(toggleAll).not.toHaveTextContent('Collapse all');

    fireEvent.click(toggleAll);

    expect(toggleAll).toHaveAccessibleName('Expand all');
    expect(toggleAll).not.toHaveTextContent('Expand all');
  });

  it('keeps rename controls active when focus moves to save and submits on click', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    seedSidebarState(renameSession);
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Rename'));
    const input = screen.getByLabelText('Session title');
    const saveButton = screen.getByLabelText('Save session title');

    fireEvent.change(input, { target: { value: 'Updated title' } });
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: saveButton });
    saveButton.focus();

    expect(renameSession).not.toHaveBeenCalled();
    expect(saveButton).toHaveFocus();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(renameSession).toHaveBeenCalledWith(sidebarSessionKey, 'Updated title');
    });
  });

  it('does not persist a session rename when the title was not changed', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    seedSidebarState(renameSession);
    renderSidebar();

    fireEvent.click(screen.getByLabelText('Rename'));
    fireEvent.click(screen.getByLabelText('Save session title'));

    await waitFor(() => {
      expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument();
    });
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('keeps rename controls active when focus moves to cancel and cancels on click', () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    seedSidebarState(renameSession);
    renderSidebar();
    fireEvent.click(screen.getByLabelText('Rename'));
    const input = screen.getByLabelText('Session title');
    const cancelButton = screen.getByLabelText('Cancel renaming');

    fireEvent.change(input, { target: { value: 'Discarded title' } });
    fireEvent.focus(input);
    fireEvent.blur(input, { relatedTarget: cancelButton });
    cancelButton.focus();

    expect(renameSession).not.toHaveBeenCalled();
    expect(cancelButton).toHaveFocus();

    fireEvent.click(cancelButton);

    expect(renameSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument();
  });

  it('renames imported workspaces while keeping the path as hover text', () => {
    const workspacePath = '/repo/imported';
    const setWorkspaceLabel = vi.fn();
    seedSidebarState();
    useSettingsStore.setState({ workspaceLabels: {}, setWorkspaceLabel });
    useChatStore.setState({
      sessions: [{
        key: sidebarSessionKey,
        displayName: 'Workspace chat',
        workspacePath,
        updatedAt: 1,
      }],
    });

    renderSidebar();

    expect(screen.getByTestId(getWorkspaceGroupToggleTestId(workspacePath))).toHaveAttribute('title', workspacePath);
    fireEvent.click(screen.getByTestId(getWorkspaceGroupRenameTestId(workspacePath)));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Imported project' } });
    fireEvent.click(screen.getByLabelText('Save workspace name'));

    expect(setWorkspaceLabel).toHaveBeenCalledWith(workspacePath, 'Imported project');
  });

  it('uses the timestamp embedded in a locally-created session key as activity fallback', () => {
    const createdAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const session = {
      key: `agent:main:session-${createdAtMs}`,
      displayName: `agent:main:session-${createdAtMs}`,
    };

    const activityMs = getSessionActivityMs(session, {});

    expect(activityMs).toBe(createdAtMs);
  });

  it('prefers real message activity over backend metadata or key creation time', () => {
    const keyCreatedAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const updatedAtMs = new Date('2026-05-06T11:00:00.000Z').getTime();
    const messageActivityMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(getSessionActivityMs(
      {
        key: `agent:main:session-${keyCreatedAtMs}`,
        updatedAt: updatedAtMs,
      },
      { [`agent:main:session-${keyCreatedAtMs}`]: messageActivityMs },
    )).toBe(messageActivityMs);
  });

  it('uses workspace-scoped group state keys and test ids', () => {
    expect(getWorkspaceGroupStateKey('/repo/a')).not.toBe(getWorkspaceGroupStateKey('/repo/b'));
    expect(getWorkspaceGroupTestId('/repo/a')).not.toBe(getWorkspaceGroupTestId('/repo/b'));
    expect(getWorkspaceGroupToggleTestId('/repo/a')).not.toBe(getWorkspaceGroupToggleTestId('/repo/b'));
    expect(getWorkspaceGroupTestId('/repo/a-b')).not.toBe(getWorkspaceGroupTestId('/repo/a/b'));
    expect(getWorkspaceGroupToggleTestId('/repo/a-b')).not.toBe(getWorkspaceGroupToggleTestId('/repo/a/b'));
  });

  it('adds workspace context to load more button accessible names', () => {
    seedSidebarState();
    useChatStore.setState({
      sessions: [
        ...Array.from({ length: 6 }, (_, index) => ({
          key: `agent:main:session-alpha-${index}`,
          displayName: `Alpha ${index}`,
          workspacePath: '/repo/alpha',
          updatedAt: 100 - index,
        })),
        ...Array.from({ length: 6 }, (_, index) => ({
          key: `agent:main:session-beta-${index}`,
          displayName: `Beta ${index}`,
          workspacePath: '/repo/beta',
          updatedAt: 90 - index,
        })),
      ],
      currentSessionKey: 'agent:main:session-alpha-0',
    });

    renderSidebar();

    const alphaLoadMore = screen.getByRole('button', { name: 'Load 1 more sessions in /repo/alpha' });
    const betaLoadMore = screen.getByRole('button', { name: 'Load 1 more sessions in /repo/beta' });

    expect(alphaLoadMore).toHaveTextContent('Load more');
    expect(betaLoadMore).toHaveTextContent('Load more');
  });

  it('formats activity timestamps through timeago with locale mapping', () => {
    const nowMs = new Date('2026-05-06T12:00:00.000Z').getTime();
    const activityMs = nowMs - 2 * 60 * 60 * 1000;

    expect(formatSessionRelativeTime(activityMs, nowMs, 'en')).toBe('2 hours ago');
    expect(formatSessionRelativeTime(activityMs, nowMs, 'zh')).toContain('2');
    expect(formatSessionRelativeTime(0, nowMs, 'en')).toBe('');
  });

  it('clamps future activity timestamps to avoid future relative labels', () => {
    const nowMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(formatSessionRelativeTime(nowMs + 30_000, nowMs, 'en')).toBe('just now');
    expect(formatSessionRelativeTime(nowMs + 30_000, nowMs, 'zh')).toBe('刚刚');
  });
});
