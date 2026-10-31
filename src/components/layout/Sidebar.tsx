/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Cpu,
  MessageCircle,
  Monitor,
  Search,
  Pin,
  PinOff,
  MoreHorizontal,
  CircleAlert,
  Puzzle,
  Bot,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronRight,
  ChevronsUpDown,
  ChevronsDownUp,
  LoaderCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isGatewayRestarting } from '@/lib/gateway-status';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { groupSessionsByWorkspace, type WorkspaceSessionEntry } from './session-buckets';
import { matchesTaskSearch } from './task-search';
import type { ChatSession } from '@/stores/chat';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import {
  shouldIncludeSessionInSidebarList,
  shouldIncludeSessionInWorkspaceDeletion,
} from '@/stores/chat/session-key-utils';
import { CHANNEL_NAMES } from '@shared/types/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApi } from '@/lib/host-api';
import { formatSessionRelativeTime } from '@/lib/relative-time';
import { SIDEBAR_COLLAPSED_WIDTH, MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
import { BrandWordmark } from './BrandWordmark';
import { useNewChatAction } from './use-new-chat-action';
import { isDefaultWorkspacePath } from '@/lib/workspace-context';
import { useWorkspaceAvailability } from '@/hooks/use-workspace-availability';
import { projectSessionRunState } from '@/stores/chat/session-status';
import { getSessionDisplayTitle } from '@shared/chat/session-title';
import { IssueReportExport } from '@/components/settings/IssueReportExport';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, badge, collapsed, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      data-testid={testId}
      className={({ isActive }) => cn(
        'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
        'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
        isActive ? 'bg-black/5 dark:bg-white/10 text-foreground' : '',
        collapsed && 'justify-center px-0',
      )}
    >
      <>
        <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">{icon}</div>
        {!collapsed && (
          <>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
            {badge && (
              <Badge variant="secondary" className="ml-auto shrink-0">
                {badge}
              </Badge>
            )}
          </>
        )}
      </>
    </NavLink>
  );
}

const taskMenuItemClass = 'clawx-menu-item flex cursor-pointer items-center text-sm outline-none focus:bg-black/5 dark:focus:bg-white/10';

const INITIAL_NOW_MS = Date.now();
const INITIAL_WORKSPACE_SESSION_LIMIT = 5;
const WORKSPACE_SESSION_LIMIT_INCREMENT = 5;

function getWorkspaceTestIdSegment(workspacePath: string): string {
  return encodeURIComponent(workspacePath.trim() || 'workspace');
}

export function getWorkspaceGroupStateKey(workspacePath: string): string {
  return workspacePath;
}

export function getWorkspaceGroupTestId(workspacePath: string): string {
  return `workspace-session-group-${getWorkspaceTestIdSegment(workspacePath)}`;
}

export function getWorkspaceGroupToggleTestId(workspacePath: string): string {
  return `workspace-session-group-toggle-${getWorkspaceTestIdSegment(workspacePath)}`;
}

export function getWorkspaceGroupRenameTestId(workspacePath: string): string {
  return `workspace-session-group-rename-${getWorkspaceTestIdSegment(workspacePath)}`;
}

function getWorkspaceGroupDeleteTestId(workspacePath: string): string {
  return `workspace-session-group-delete-${getWorkspaceTestIdSegment(workspacePath)}`;
}

function getWorkspaceLoadMoreTestId(workspacePath: string): string {
  return `workspace-session-load-more-${getWorkspaceTestIdSegment(workspacePath)}`;
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function Sidebar() {
  const isMac = window.electron?.platform === 'darwin';
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const pinnedSessionKeys = useSettingsStore((state) => state.pinnedSessionKeys);
  const toggleSessionPin = useSettingsStore((state) => state.toggleSessionPin);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const chatWorkspacePath = useSettingsStore((state) => state.chatWorkspacePath);
  const recentWorkspacePaths = useSettingsStore((state) => state.recentWorkspacePaths);
  const workspaceLabels = useSettingsStore((state) => state.workspaceLabels);
  const setWorkspaceLabel = useSettingsStore((state) => state.setWorkspaceLabel);
  const removeWorkspace = useSettingsStore((state) => state.removeWorkspace);
  const [isResizing, setIsResizing] = useState(false);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const closeSearch = () => {
    setSearchQuery('');
    setSearchOpen(false);
    searchToggleRef.current?.focus();
  };
  useEffect(() => {
    const searchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setSidebarCollapsed(false);
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener('keydown', searchShortcut);
    return () => window.removeEventListener('keydown', searchShortcut);
  }, [setSidebarCollapsed]);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const deleteSessions = useChatStore((s) => s.deleteSessions);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sessionAttentionByKey = useSessionAttentionStore((s) => s.bySessionKey);
  const markRead = useSessionAttentionStore((s) => s.markRead);
  const handleNewChat = useNewChatAction();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isGatewayReady = isGatewayRunning && gatewayStatus.gatewayReady !== false;
  const gatewayRestarting = isGatewayRestarting(gatewayStatus);
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;

  useEffect(() => {
    if (!isGatewayReady) return;
    void loadSessions();
  }, [gatewayRuntimeKey, isGatewayReady, loadSessions]);
  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useEffect(() => {
    if (!isMac) return;
    void hostApi.window.syncTrafficLightPosition(sidebarCollapsed);
  }, [isMac, sidebarCollapsed]);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const { t, i18n } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{
    path: string;
    label: string;
    sessionKeys: string[];
  } | null>(null);
  const [workspaceDeleteDialogOpen, setWorkspaceDeleteDialogOpen] = useState(false);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingOriginalLabel, setEditingOriginalLabel] = useState('');
  const [editingWorkspacePath, setEditingWorkspacePath] = useState<string | null>(null);
  const [editingWorkspaceLabel, setEditingWorkspaceLabel] = useState('');
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Record<string, boolean>>({});
  const [workspaceVisibleSessionCounts, setWorkspaceVisibleSessionCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (deleteDialogOpen || !sessionToDelete) return;
    const timer = window.setTimeout(() => setSessionToDelete(null), 160);
    return () => window.clearTimeout(timer);
  }, [deleteDialogOpen, sessionToDelete]);

  useEffect(() => {
    if (workspaceDeleteDialogOpen || !workspaceToDelete) return;
    const timer = window.setTimeout(() => setWorkspaceToDelete(null), 160);
    return () => window.clearTimeout(timer);
  }, [workspaceDeleteDialogOpen, workspaceToDelete]);

  const handleStartRename = (key: string, currentLabel: string) => {
    setEditingSessionKey(key);
    setEditingLabel(currentLabel);
    setEditingOriginalLabel(currentLabel);
  };

  const handleRenameSubmit = async () => {
    const normalizedLabel = editingLabel.trim();
    if (!editingSessionKey || !normalizedLabel || normalizedLabel === editingOriginalLabel.trim()) {
      setEditingSessionKey(null);
      setEditingOriginalLabel('');
      return;
    }
    try {
      await renameSession(editingSessionKey, normalizedLabel);
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingSessionKey(null);
    setEditingOriginalLabel('');
  };

  const handleRenameCancel = () => {
    setEditingSessionKey(null);
    setEditingOriginalLabel('');
  };

  const handleRenameBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    void handleRenameSubmit();
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRenameSubmit();
    } else if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

  const handleStartWorkspaceRename = (workspacePath: string, currentLabel: string) => {
    setEditingWorkspacePath(workspacePath);
    setEditingWorkspaceLabel(currentLabel);
  };

  const handleWorkspaceRenameSubmit = () => {
    if (editingWorkspacePath && editingWorkspaceLabel.trim()) {
      setWorkspaceLabel(editingWorkspacePath, editingWorkspaceLabel);
    }
    setEditingWorkspacePath(null);
  };

  const handleWorkspaceRenameCancel = () => {
    setEditingWorkspacePath(null);
  };

  const handleWorkspaceRenameBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    handleWorkspaceRenameSubmit();
  };

  const handleWorkspaceRenameKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleWorkspaceRenameSubmit();
    } else if (event.key === 'Escape') {
      handleWorkspaceRenameCancel();
    }
  };

  const toggleWorkspaceGroup = (workspacePath: string) => {
    const stateKey = getWorkspaceGroupStateKey(workspacePath);
    setCollapsedWorkspaceGroups((current) => ({
      ...current,
      [stateKey]: !(current[stateKey] ?? false),
    }));
  };

  const loadMoreWorkspaceSessions = (workspacePath: string) => {
    const stateKey = getWorkspaceGroupStateKey(workspacePath);
    setWorkspaceVisibleSessionCounts((current) => ({
      ...current,
      [stateKey]: (current[stateKey] ?? INITIAL_WORKSPACE_SESSION_LIMIT) + WORKSPACE_SESSION_LIMIT_INCREMENT,
    }));
  };

  const stopResizing = useCallback(() => {
    stopResizeRef.current?.();
    stopResizeRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners below keep dragging reliable even if capture is unavailable.
      }

      const onMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(moveEvent.clientX);
      };
      const onUp = () => stopResizing();

      stopResizeRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [setSidebarWidth, sidebarCollapsed, stopResizing],
  );

  useEffect(() => stopResizing, [stopResizing]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const defaultAgentWorkspace = useMemo(
    () => agents.find((agent) => agent.isDefault)?.workspace
      ?? agents.find((agent) => agent.id === 'main')?.workspace,
    [agents],
  );
  const workspaceCatalogSessions = useMemo(
    () => sessions.filter((session) => shouldIncludeSessionInWorkspaceDeletion(session)),
    [sessions],
  );
  const workspaceCatalogGroups = groupSessionsByWorkspace(
    workspaceCatalogSessions,
    sessionLastActivity,
    t('chat:workspace.defaultLabel'),
    chatWorkspacePath,
    workspaceLabels,
    [
      ...recentWorkspacePaths,
      chatWorkspacePath,
      ...sessions.map((session) => session.workspacePath).filter((path): path is string => !!path),
    ],
    defaultAgentWorkspace,
  );
  const workspaceSessionGroups = workspaceCatalogGroups.map((group) => ({
    ...group,
    sessions: group.sessions.filter(({ session }) => shouldIncludeSessionInSidebarList(session)),
  }));
  const workspaceAvailability = useWorkspaceAvailability(
    workspaceSessionGroups.map((group) => group.workspacePath),
  );
  const searchActive = searchQuery.trim().length > 0;
  const pinnedKeys = new Set(pinnedSessionKeys);
  const eligibleEntries = workspaceSessionGroups.flatMap((group) => group.sessions.map((entry) => ({ ...entry, group })));
  const matchesSearch = (entry: typeof eligibleEntries[number]) => matchesTaskSearch(
    searchQuery, entry.session, sessionLabels,
    agentNameById[getAgentIdFromSessionKey(entry.session.key)] || getAgentIdFromSessionKey(entry.session.key),
    entry.group.label, entry.group.workspacePath,
  );
  const entriesByKey = new Map(eligibleEntries.map((entry) => [entry.session.key, entry]));
  const pinnedEntries = pinnedSessionKeys.flatMap((key) => {
    const entry = entriesByKey.get(key);
    return entry && matchesSearch(entry) ? [entry] : [];
  });
  const displayedWorkspaceSessionGroups = workspaceSessionGroups.map((group) => ({
    ...group,
    sessions: group.sessions.filter((entry) => !pinnedKeys.has(entry.session.key) && matchesSearch({ ...entry, group })),
  })).filter((group) => group.sessions.length > 0 || (!searchActive
    && workspaceAvailability[group.workspacePath] === 'unavailable'
    && !isDefaultWorkspacePath(group.workspacePath)));
  const searchResultCount = pinnedEntries.length + displayedWorkspaceSessionGroups.reduce((total, group) => total + group.sessions.length, 0);
  const allWorkspaceGroupsCollapsed = displayedWorkspaceSessionGroups.length > 0
    && displayedWorkspaceSessionGroups.every((group) => collapsedWorkspaceGroups[getWorkspaceGroupStateKey(group.workspacePath)] ?? false);

  const toggleAllWorkspaceGroups = () => {
    const nextCollapsed = !allWorkspaceGroupsCollapsed;
    setCollapsedWorkspaceGroups((current) => {
      const next = { ...current };
      for (const group of displayedWorkspaceSessionGroups) {
        next[getWorkspaceGroupStateKey(group.workspacePath)] = nextCollapsed;
      }
      return next;
    });
  };

  const focusTaskActions = (key: string) => requestAnimationFrame(() => {
    const target = document.getElementById(`task-actions-${key}`);
    if (target) target.focus();
    else searchToggleRef.current?.focus();
  });
  const handleTogglePin = (key: string) => {
    void toggleSessionPin(key).catch(() => {
      toast.error(t('chat:sessionList.pinFailed'));
      focusTaskActions(key);
    });
    focusTaskActions(key);
  };

  const renderSessionRow = ({ session: s, activityMs }: WorkspaceSessionEntry<ChatSession>, workspaceLabel: string, pinned = false) => {
    const agentId = getAgentIdFromSessionKey(s.key);
    const agentName = agentNameById[agentId] || agentId;
    const isEditing = editingSessionKey === s.key;
    const isCurrentSession = isOnChat && currentSessionKey === s.key;
    const sessionLabel = getSessionDisplayTitle(s, sessionLabels);
    const relativeTime = formatSessionRelativeTime(activityMs, nowMs, i18n.language);
    const runState = projectSessionRunState(s);
    const attention = sessionAttentionByKey[s.key];
    const isBusy = runState === 'busy'
      || (runState === 'unknown' && attention?.observedBusy === true);
    const isUnread = !isBusy && attention?.unread === true;
    const lastRunFailed = !isBusy && ['failed', 'error', 'timeout'].includes(s.status?.trim().toLowerCase() ?? '');
    const channelType = s.channel && s.channel !== 'webchat' ? s.channel : null;
    const channelName = channelType
      ? (CHANNEL_NAMES[channelType as keyof typeof CHANNEL_NAMES] ?? channelType)
      : null;

    return (
      <div
        key={s.key}
        className={cn(
          'group relative flex items-center rounded-xl transition-colors motion-reduce:transition-none',
          'hover:bg-black/5 focus-within:bg-black/5 dark:hover:bg-white/5 dark:focus-within:bg-white/5',
          !isEditing && isCurrentSession
            ? 'bg-black/5 dark:bg-white/10'
            : '',
        )}
      >
        {isEditing ? (
          <div className="flex w-full items-center gap-1 px-1.5 py-1" onBlur={handleRenameBlur}>
            <Input
              autoFocus
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              className="h-7 min-w-0 flex-1 text-meta"
              aria-label={t('common:sidebar.renameSessionPlaceholder')}
            />
            <button
              type="button"
              aria-label={t('common:sidebar.saveSessionRename')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleRenameSubmit()}
              className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={t('common:sidebar.cancelSessionRename')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleRenameCancel}
              className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <>
            <button
              data-testid={`sidebar-session-${s.key}`}
              title={[sessionLabel, agentName, workspaceLabel].filter(Boolean).join(' · ')}
              aria-current={isCurrentSession ? 'page' : undefined}
              onClick={() => {
                markRead(s.key);
                if (currentSessionKey !== s.key) {
                  switchSession(s.key);
                }
                navigate('/');
              }}
              onDoubleClick={() => handleStartRename(s.key, sessionLabel)}
              className={cn(
                'flex-1 min-w-0 rounded-xl text-left px-2.5 py-2 text-meta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover:pr-9 group-focus-within:pr-9 group-has-[[data-state=open]]:pr-9',
                isCurrentSession
                  ? 'text-foreground font-medium'
                  : 'text-foreground/75',
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                {agentId !== defaultAgentId && (
                  <span data-testid={`sidebar-session-agent-${s.key}`} title={agentName}
                    className="max-w-16 shrink-0 truncate rounded-md bg-black/[0.04] px-1 text-2xs font-medium text-muted-foreground dark:bg-white/5">
                    {agentName}
                  </span>
                )}
                {channelType && channelName && (
                  <span
                    title={channelName}
                    aria-label={channelName}
                    className="shrink-0 truncate rounded-full bg-blue-500/10 px-2 py-0.5 text-2xs font-medium text-blue-700 dark:bg-blue-400/10 dark:text-blue-400"
                  >
                    {channelName}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{sessionLabel}</span>
              </div>
              {pinned && <span className="mt-0.5 block truncate text-2xs text-muted-foreground">{workspaceLabel}</span>}
            </button>
            {isBusy ? (
              <span
                role="status"
                data-testid={`sidebar-session-busy-${s.key}`}
                aria-label={t('chat:sessionList.aiReplying')}
                title={t('chat:sessionList.aiReplying')}
                className="shrink-0 pr-2 text-blue-700 group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden dark:text-blue-400"
              >
                <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              </span>
            ) : isUnread ? (
              <span
                role="status"
                data-testid={`sidebar-session-unread-${s.key}`}
                aria-label={t('chat:sessionList.unreadReply')}
                title={t('chat:sessionList.unreadReply')}
                className="shrink-0 pr-2 group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden"
              >
                <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-blue-500" />
              </span>
            ) : lastRunFailed ? (
              <span role="status" data-testid={`sidebar-session-failed-${s.key}`} aria-label={t('chat:sessionList.lastRunFailed')} title={t('chat:sessionList.lastRunFailed')}
                className="shrink-0 pr-2 text-orange-700 group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden dark:text-orange-400">
                <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            ) : relativeTime ? (
              <span
                data-testid={`sidebar-session-time-${s.key}`}
                title={new Date(activityMs).toLocaleString()}
                className="shrink-0 pr-2 text-2xs font-medium text-muted-foreground/55 group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden"
              >
                {relativeTime}
              </span>
            ) : null}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" id={`task-actions-${s.key}`} data-testid={`sidebar-session-menu-${s.key}`}
                  aria-label={t('chat:sessionList.taskActions', { title: sessionLabel })}
                  className="pointer-events-none absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-black/5 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 dark:hover:bg-white/10">
                  <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content align="start" side="right" sideOffset={4} className="clawx-menu-list z-50 min-w-36 rounded-xl border border-border bg-surface-modal p-1 shadow-lg">
                <DropdownMenu.Item className={taskMenuItemClass} data-testid={`sidebar-session-pin-${s.key}`} onSelect={() => {
                  handleTogglePin(s.key);
                }}>
                  {pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                  {t(pinned ? 'chat:sessionList.unpin' : 'chat:sessionList.pin')}
                </DropdownMenu.Item>
                <DropdownMenu.Item className={taskMenuItemClass} onSelect={() => handleStartRename(s.key, sessionLabel)}>
                  <Pencil className="mr-2 h-4 w-4" />{t('common:sidebar.renameSession')}
                </DropdownMenu.Item>
                <DropdownMenu.Item data-testid={`sidebar-session-delete-${s.key}`} className={cn(taskMenuItemClass, "text-destructive focus:text-destructive")} onSelect={() => {
                  setSessionToDelete({ key: s.key, label: sessionLabel });
                  setDeleteDialogOpen(true);
                }}>
                  <Trash2 className="mr-2 h-4 w-4" />{t('common:sidebar.deleteSession')}
                </DropdownMenu.Item>
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        )}
      </div>
    );
  };

  const hiddenRoutes = rendererExtensionRegistry.getHiddenRoutes();
  const extraNavItems = rendererExtensionRegistry.getExtraNavItems();

  const coreNavItems = [
    {
      to: '/skills',
      icon: <Puzzle className="h-4 w-4" strokeWidth={2} />,
      label: t('sidebar.skills'),
      testId: 'sidebar-nav-skills',
    },
    {
      to: '/agents',
      icon: <Bot className="h-4 w-4" strokeWidth={2} />,
      label: t('sidebar.agents'),
      testId: 'sidebar-nav-agents',
    },
    { to: '/models', icon: <Cpu className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/channels', icon: <MessageCircle className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    {
      to: '/cron',
      icon: <Clock className="h-4 w-4" strokeWidth={2} />,
      label: t('sidebar.cronTasks'),
      testId: 'sidebar-nav-cron',
    },
    { to: '/computer-use', icon: <Monitor className="h-4 w-4" strokeWidth={2} />, label: t('computerUse.title'), testId: 'sidebar-nav-computer-use' },
  ];

  const navItems = [
    ...coreNavItems.filter((item) => !hiddenRoutes.has(item.to)),
    ...extraNavItems.map((item) => ({
      to: item.to,
      icon: <item.icon className="h-4 w-4" strokeWidth={2} />,
      label: item.labelI18nKey ? t(item.labelI18nKey) : item.label,
      testId: item.testId,
    })),
  ];

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-sidebar',
        isResizing ? 'transition-none' : 'transition-[width] duration-300',
      )}
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth }}
    >
      {isMac && (
        <div
          aria-hidden="true"
          data-testid="mac-sidebar-chrome"
          className="drag-region shrink-0"
          style={{ height: MAC_SIDEBAR_CHROME_HEIGHT }}
        />
      )}

      {/* Top Header Toggle */}
      <div
        data-testid="sidebar-brand-header"
        className={cn('flex h-14 shrink-0 items-center px-3 py-2', sidebarCollapsed ? 'justify-center' : 'justify-between')}
      >
        {!sidebarCollapsed && (
          <div role="img" aria-label="ClawX" data-testid="sidebar-brand" className="flex min-w-0 items-center gap-[9px] overflow-hidden pl-1.5 text-foreground">
            <img src={logoSvg} alt="" className="h-[25.2px] w-auto shrink-0" />
            <BrandWordmark className="h-[17.1px] w-[68.4px] shrink-0" />
          </div>
        )}
        <Button
          data-testid="sidebar-collapse-toggle"
          aria-label={t(sidebarCollapsed ? 'sidebar.expandSidebar' : 'sidebar.collapseSidebar')}
          title={t(sidebarCollapsed ? 'sidebar.expandSidebar' : 'sidebar.collapseSidebar')}
          aria-expanded={!sidebarCollapsed}
          variant="ghost"
          size="icon"
          className={cn(
            'no-drag group relative h-8 w-8 shrink-0 rounded-lg text-muted-foreground/60',
            'hover:bg-black/5 hover:text-foreground focus-visible:text-foreground dark:hover:bg-white/5',
            sidebarCollapsed && 'h-9 w-10',
          )}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <>
              <img data-testid="sidebar-collapsed-logo" src={logoSvg} alt="" className="h-[25.2px] w-auto transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none" />
              <PanelLeft aria-hidden="true" className="absolute h-[18px] w-[18px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
            </>
          ) : (
            <PanelLeftClose aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2 mt-2">
        <button
          type="button"
          data-testid="sidebar-new-chat"
          aria-label={t('sidebar.newChat')}
          title={sidebarCollapsed ? t('sidebar.newChat') : undefined}
          onClick={handleNewChat}
          className={cn(
            'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
            'text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
            <Plus className="h-4 w-4" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">
              {t('sidebar.newChat')}
            </span>
          )}
        </button>

        {navItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
        ))}
      </nav>

      {/* Session list — below Settings, only when expanded */}
      {!sidebarCollapsed && (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <div className="mb-1 flex items-center justify-between gap-2 pl-2.5">
            <span className="text-tiny font-medium text-muted-foreground">
              {t('chat:sessionList.title')}
            </span>
            <div className="flex items-center gap-0.5">
            <button type="button" data-testid="sidebar-search-toggle" ref={searchToggleRef} title={`${t('chat:sessionList.search')} (${isMac ? '⌘K' : 'Ctrl+K'})`}
              aria-label={t('chat:sessionList.search')} aria-expanded={searchOpen}
              onClick={() => { setSearchOpen((open) => !open); setSearchQuery(''); }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10">
              <Search aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="session-list-toggle-all"
              disabled={searchActive || displayedWorkspaceSessionGroups.length === 0}
              aria-label={allWorkspaceGroupsCollapsed ? t('chat:sessionList.expandAll') : t('chat:sessionList.collapseAll')}
              title={allWorkspaceGroupsCollapsed ? t('chat:sessionList.expandAll') : t('chat:sessionList.collapseAll')}
              onClick={toggleAllWorkspaceGroups}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            >
              <span aria-hidden="true" className="flex h-3.5 w-3.5 items-center justify-center">
                {allWorkspaceGroupsCollapsed ? (
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
            </div>
          </div>

          {searchOpen && (
            <div className="relative mx-2.5 mb-2 mt-1.5" role="search">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus ref={searchRef} data-testid="sidebar-task-search" value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('chat:sessionList.searchPlaceholder')} aria-label={t('chat:sessionList.search')}
                onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); } }}
                className="h-7 rounded-lg bg-surface-modal py-1 pl-7 pr-7 text-xs shadow-none" />
              <button type="button" aria-label={t('chat:sessionList.closeSearch')}
                onClick={closeSearch}
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </div>
          )}
          {searchActive && <p role="status" data-testid="sidebar-search-count" className="mb-2 px-2.5 text-tiny text-muted-foreground">{t('chat:sessionList.results', { count: searchResultCount })}</p>}
          {searchActive && searchResultCount === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('chat:sessionList.noResults')}</p>}
          {!searchActive && eligibleEntries.length === 0 && <p className="px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">{t('chat:sessionList.emptyHint')}</p>}
          {pinnedEntries.length > 0 && (
            <section data-testid="sidebar-pinned-tasks" aria-label={t('chat:sessionList.pinned')} className="mb-4 space-y-0.5">
              <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2 text-tiny font-medium text-muted-foreground">
                <Pin aria-hidden="true" className="h-3 w-3" />{t('chat:sessionList.pinned')}
              </div>
              {pinnedEntries.map((entry) => renderSessionRow(entry, entry.group.label, true))}
            </section>
          )}
          <div className="space-y-1.5">
            {displayedWorkspaceSessionGroups.map((workspaceGroup) => {
              const workspaceStateKey = getWorkspaceGroupStateKey(workspaceGroup.workspacePath);
              const collapsed = !searchActive && (collapsedWorkspaceGroups[workspaceStateKey] ?? false);
              const visibleCount = workspaceVisibleSessionCounts[workspaceStateKey] ?? INITIAL_WORKSPACE_SESSION_LIMIT;
              const visibleSessions = searchActive ? workspaceGroup.sessions : workspaceGroup.sessions.slice(0, visibleCount);
              const hiddenCount = Math.max(0, workspaceGroup.sessions.length - visibleSessions.length);
              const loadMoreCount = Math.min(WORKSPACE_SESSION_LIMIT_INCREMENT, hiddenCount);
              const workspaceUnavailable = workspaceAvailability[workspaceGroup.workspacePath] === 'unavailable'
                && !isDefaultWorkspacePath(workspaceGroup.workspacePath);

              return (
                <div
                  key={workspaceGroup.workspacePath}
                  data-testid={getWorkspaceGroupTestId(workspaceGroup.workspacePath)}
                  className="space-y-1"
                >
                  {editingWorkspacePath === workspaceGroup.workspacePath ? (
                    <div
                      className="flex w-full items-center gap-1 px-1.5 py-1"
                      onBlur={handleWorkspaceRenameBlur}
                    >
                      <Input
                        autoFocus
                        value={editingWorkspaceLabel}
                        onChange={(event) => setEditingWorkspaceLabel(event.target.value)}
                        onKeyDown={handleWorkspaceRenameKeyDown}
                        className="h-7 min-w-0 flex-1 text-meta"
                        aria-label={t('chat:sessionList.workspaceName')}
                      />
                      <button
                        type="button"
                        aria-label={t('chat:sessionList.saveWorkspaceRename')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleWorkspaceRenameSubmit}
                        className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t('chat:sessionList.cancelWorkspaceRename')}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleWorkspaceRenameCancel}
                        className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="group flex items-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                      <button
                        type="button"
                        data-testid={getWorkspaceGroupToggleTestId(workspaceGroup.workspacePath)}
                        aria-expanded={!collapsed}
                        aria-label={t('chat:sessionList.workspaceToggle', { workspace: workspaceGroup.label })}
                        onClick={() => toggleWorkspaceGroup(workspaceGroup.workspacePath)}
                        onDoubleClick={() => {
                          if (!isDefaultWorkspacePath(workspaceGroup.workspacePath)) {
                            handleStartWorkspaceRename(workspaceGroup.workspacePath, workspaceGroup.label);
                          }
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-foreground/65 transition-colors hover:text-foreground"
                        title={workspaceGroup.workspacePath}
                      >
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                            !collapsed && 'rotate-90',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{workspaceGroup.label}</span>
                        {workspaceUnavailable && (
                          <Badge
                            variant="warning"
                            data-testid={`workspace-session-group-unavailable-${getWorkspaceTestIdSegment(workspaceGroup.workspacePath)}`}
                            className="shrink-0 px-1.5 py-0 text-2xs"
                          >
                            {t('chat:sessionList.workspaceUnavailableBadge')}
                          </Badge>
                        )}
                        <span className="shrink-0 text-2xs font-medium text-muted-foreground/60 group-hover:hidden group-focus-within:hidden">
                          {workspaceGroup.sessions.length}
                        </span>
                      </button>
                      {!isDefaultWorkspacePath(workspaceGroup.workspacePath) && (
                        <button
                          type="button"
                          data-testid={getWorkspaceGroupRenameTestId(workspaceGroup.workspacePath)}
                          aria-label={t('chat:sessionList.renameWorkspace', { workspace: workspaceGroup.label })}
                          title={t('chat:sessionList.renameWorkspace', { workspace: workspaceGroup.label })}
                          onClick={() => handleStartWorkspaceRename(workspaceGroup.workspacePath, workspaceGroup.label)}
                          className={cn(
                            'hidden shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground group-hover:flex group-focus-within:flex dark:hover:bg-white/10',
                            !workspaceUnavailable && 'mr-2',
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {workspaceUnavailable && (
                        <button
                          type="button"
                          data-testid={getWorkspaceGroupDeleteTestId(workspaceGroup.workspacePath)}
                          aria-label={t('chat:sessionList.deleteWorkspace', { workspace: workspaceGroup.label })}
                          title={t('chat:sessionList.deleteWorkspace', { workspace: workspaceGroup.label })}
                          onClick={(event) => {
                            event.stopPropagation();
                            setWorkspaceToDelete({
                              path: workspaceGroup.workspacePath,
                              label: workspaceGroup.label,
                              sessionKeys: workspaceCatalogGroups
                                .find((group) => group.workspacePath === workspaceGroup.workspacePath)
                                ?.sessions.map(({ session }) => session.key) ?? [],
                            });
                            setWorkspaceDeleteDialogOpen(true);
                          }}
                          className="mr-2 flex shrink-0 items-center justify-center rounded p-0.5 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {!collapsed && (
                    <div className="space-y-0.5">
                      {visibleSessions.map((entry) => renderSessionRow(entry, workspaceGroup.label))}

                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          data-testid={getWorkspaceLoadMoreTestId(workspaceGroup.workspacePath)}
                          aria-label={t('chat:sessionList.loadMoreForWorkspace', {
                            count: loadMoreCount,
                            workspace: workspaceGroup.label,
                          })}
                          onClick={() => loadMoreWorkspaceSessions(workspaceGroup.workspacePath)}
                          className="ml-2 rounded-md px-2 py-1 text-tiny font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                        >
                          {t('chat:sessionList.loadMore')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-1 p-2">
        <div
          data-testid="sidebar-gateway-restarting"
          data-state={gatewayRestarting ? 'visible' : 'hidden'}
          aria-hidden={!gatewayRestarting}
          className={cn(
            'overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out',
            gatewayRestarting ? 'max-h-12 translate-y-0 opacity-100' : 'max-h-0 translate-y-1 opacity-0',
          )}
        >
          <div
            aria-live="polite"
            aria-label={t('common:gateway.restarting')}
            title={t('common:gateway.restarting')}
            className={cn(
              'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5',
              'border border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
              sidebarCollapsed && 'justify-center px-0',
            )}
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {!sidebarCollapsed && (
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {t('common:gateway.restarting')}
              </span>
            )}
          </div>
        </div>

        <NavLink
          to="/settings"
          data-testid="sidebar-nav-settings"
          className={({ isActive }) =>
            cn(
              'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
              'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
              isActive && 'bg-black/5 dark:bg-white/10 text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : '',
            )
          }
        >
          <>
            <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
              <SettingsIcon className="h-4 w-4" strokeWidth={2} />
            </div>
            {!sidebarCollapsed && (
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>
            )}
          </>
        </NavLink>

        <IssueReportExport trigger="sidebar" sidebarCollapsed={sidebarCollapsed} />
      </div>

      {!sidebarCollapsed && (
        <div
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          title="Drag to resize sidebar"
          onPointerDown={handleResizePointerDown}
          className="no-drag group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize select-none"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/40"
          />
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label ?? '' })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          const targetSession = sessionToDelete;
          if (!targetSession) return;
          const result = await deleteSession(targetSession.key);
          if (!result.success) return;
          if (currentSessionKey === targetSession.key) navigate('/');
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
      <ConfirmDialog
        open={workspaceDeleteDialogOpen}
        title={t('chat:sessionList.deleteWorkspaceTitle')}
        message={t('chat:sessionList.deleteWorkspaceConfirm', {
          workspace: workspaceToDelete?.label ?? '',
          count: workspaceToDelete?.sessionKeys.length ?? 0,
        })}
        confirmLabel={t('chat:sessionList.deleteWorkspaceConfirmAction')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          const target = workspaceToDelete;
          if (!target) return;
          const currentWasTargeted = target.sessionKeys.includes(currentSessionKey);
          const result = await deleteSessions(target.sessionKeys);
          if (result.failedKeys.length === 0) {
            try {
              await removeWorkspace(target.path);
            } catch {
              toast.error(t('chat:sessionList.deleteWorkspaceCleanupFailed'));
            }
          } else {
            toast.error(t('chat:sessionList.deleteWorkspacePartialFailure', {
              count: result.failedKeys.length,
            }));
          }
          if (currentWasTargeted && result.deletedKeys.includes(currentSessionKey)) navigate('/');
          setWorkspaceDeleteDialogOpen(false);
        }}
        onCancel={() => setWorkspaceDeleteDialogOpen(false)}
      />
    </aside>
  );
}
