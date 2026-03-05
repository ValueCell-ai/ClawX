/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Radio,
  Puzzle,
  Clock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  ExternalLink,
  Pencil,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground',
          collapsed && 'justify-center px-2'
        )
      }
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </>
      )}
    </NavLink>
  );
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

const INITIAL_NOW_MS = Date.now();

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    label ?? sessionLabels[key] ?? displayName ?? key;

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation(['common', 'chat']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [sessionToRename, setSessionToRename] = useState<{ key: string; value: string } | null>(null);
  const [renamingSessionKey, setRenamingSessionKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleStartRename = (key: string, label: string) => {
    setSessionToRename({ key, value: label });
  };

  const handleRenameSubmit = async () => {
    if (!sessionToRename) return;

    const nextLabel = sessionToRename.value.trim();
    if (!nextLabel) {
      toast.error(t('sidebar.renameSessionEmpty', { ns: 'common', defaultValue: 'Session title cannot be empty' }));
      return;
    }

    setRenamingSessionKey(sessionToRename.key);
    try {
      await renameSession(sessionToRename.key, nextLabel);
      toast.success(t('sidebar.renameSessionSuccess', { ns: 'common', defaultValue: 'Session title updated' }));
      setSessionToRename(null);
    } catch (error) {
      toast.error(`${t('sidebar.renameSessionFailed', { ns: 'common', defaultValue: 'Failed to rename session' })}: ${String(error)}`);
    } finally {
      setRenamingSessionKey(null);
    }
  };

  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = [
    { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
    { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
    { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
    { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
    { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
    { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
  ];
  const sessionBucketMap = Object.fromEntries(sessionBuckets.map((bucket) => [bucket.key, bucket])) as Record<
    SessionBucketKey,
    (typeof sessionBuckets)[number]
  >;

  for (const session of [...sessions].sort((a, b) =>
    (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )) {
    const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const navItems = [
    { to: '/cron', icon: <Clock className="h-5 w-5" />, label: t('sidebar.cronTasks') },
    { to: '/skills', icon: <Puzzle className="h-5 w-5" />, label: t('sidebar.skills') },
    { to: '/channels', icon: <Radio className="h-5 w-5" />, label: t('sidebar.channels') },
    { to: '/dashboard', icon: <Home className="h-5 w-5" />, label: t('sidebar.dashboard') },
    { to: '/settings', icon: <Settings className="h-5 w-5" />, label: t('sidebar.settings') },
  ];

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r bg-background transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 overflow-hidden p-2">
        {/* Chat nav item: acts as "New Chat" button, never highlighted as active */}
        <button
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) newSession();
            navigate('/');
          }}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            sidebarCollapsed && 'justify-center px-2',
          )}
        >
          <MessageSquare className="h-5 w-5 shrink-0" />
          {!sidebarCollapsed && <span className="flex-1 text-left">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}

        {/* Session list — below Settings, only when expanded */}
        {!sidebarCollapsed && sessions.length > 0 && (
          <div className="mt-1 max-h-72 space-y-0.5 overflow-y-auto">
            {sessionBuckets.map((bucket) => (
              bucket.sessions.length > 0 ? (
                <div key={bucket.key} className="pt-1">
                  <div className="px-3 py-1 text-[11px] font-medium text-muted-foreground/80">
                    {bucket.label}
                  </div>
                  {bucket.sessions.map((session) => {
                    const isMainSession = session.key.endsWith(':main');
                    const isEditing = sessionToRename?.key === session.key;
                    const isSavingRename = renamingSessionKey === session.key;

                    return (
                      <div key={session.key} className="group relative flex items-center">
                        {isEditing ? (
                          <div className="flex w-full items-center gap-1 px-2 py-1">
                            <Input
                              value={sessionToRename.value}
                              onChange={(event) => setSessionToRename((prev) => (
                                prev ? { ...prev, value: event.target.value } : prev
                              ))}
                              placeholder={t('sidebar.renameSessionPlaceholder', { ns: 'common', defaultValue: 'Session title' })}
                              className="h-8 text-sm"
                              disabled={isSavingRename}
                              autoFocus
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void handleRenameSubmit();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setSessionToRename(null);
                                }
                              }}
                            />
                            <button
                              aria-label={t('sidebar.saveSessionRename', { ns: 'common', defaultValue: 'Save session title' })}
                              onClick={() => void handleRenameSubmit()}
                              className={cn(
                                'flex h-7 w-7 items-center justify-center rounded transition-colors',
                                'text-muted-foreground hover:bg-accent hover:text-primary',
                                isSavingRename && 'opacity-60'
                              )}
                              disabled={isSavingRename}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              aria-label={t('sidebar.cancelSessionRename', { ns: 'common', defaultValue: 'Cancel renaming' })}
                              onClick={() => setSessionToRename(null)}
                              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              disabled={isSavingRename}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => { switchSession(session.key); navigate('/'); }}
                              className={cn(
                                'w-full truncate rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                                isMainSession ? 'pr-7' : 'pr-12',
                                'hover:bg-accent hover:text-accent-foreground',
                                isOnChat && currentSessionKey === session.key
                                  ? 'bg-accent/60 font-medium text-accent-foreground'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {getSessionLabel(session.key, session.displayName, session.label)}
                            </button>
                            {!isMainSession && (
                              <button
                                aria-label={t('sidebar.renameSession', { ns: 'common', defaultValue: 'Rename session' })}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleStartRename(
                                    session.key,
                                    getSessionLabel(session.key, session.displayName, session.label),
                                  );
                                }}
                                className={cn(
                                  'absolute right-6 flex items-center justify-center rounded p-0.5 transition-opacity',
                                  'opacity-0 group-hover:opacity-100',
                                  'text-muted-foreground hover:bg-accent hover:text-primary',
                                )}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              aria-label={t('sidebar.deleteSession', { ns: 'common', defaultValue: 'Delete session' })}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSessionToDelete({
                                  key: session.key,
                                  label: getSessionLabel(session.key, session.displayName, session.label),
                                });
                              }}
                              className={cn(
                                'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                                'opacity-0 group-hover:opacity-100',
                                'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
                              )}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="space-y-2 p-2">
        {devModeUnlocked && !sidebarCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={openDevConsole}
          >
            <Terminal className="mr-2 h-4 w-4" />
            {t('sidebar.devConsole')}
            <ExternalLink className="ml-auto h-3 w-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="w-full"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common.confirm', 'Confirm')}
        message={sessionToDelete ? t('sidebar.deleteSessionConfirm', { label: sessionToDelete.label }) : ''}
        confirmLabel={t('common.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );
}
