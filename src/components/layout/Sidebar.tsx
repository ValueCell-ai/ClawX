/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

  const mainSessions = sessions.filter((s) => s.key.endsWith(':main'));
  const otherSessions = sessions.filter((s) => !s.key.endsWith(':main'));

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    label ?? sessionLabels[key] ?? displayName ?? key;

  const openDevConsole = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl') as {
        success: boolean;
        url?: string;
        error?: string;
      };
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation();
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [sessionToRename, setSessionToRename] = useState<{ key: string; value: string } | null>(null);
  const [renamingSessionKey, setRenamingSessionKey] = useState<string | null>(null);

  const handleStartRename = (key: string, label: string) => {
    setSessionToRename({ key, value: label });
  };

  const handleRenameSubmit = async () => {
    if (!sessionToRename) return;

    const nextLabel = sessionToRename.value.trim();
    if (!nextLabel) {
      toast.error(t('sidebar.renameSessionEmpty', 'Session title cannot be empty'));
      return;
    }

    setRenamingSessionKey(sessionToRename.key);
    try {
      await renameSession(sessionToRename.key, nextLabel);
      toast.success(t('sidebar.renameSessionSuccess', 'Session renamed'));
      setSessionToRename(null);
    } catch (error) {
      toast.error(`${t('sidebar.renameSessionFailed', 'Failed to rename session')}: ${String(error)}`);
    } finally {
      setRenamingSessionKey(null);
    }
  };

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
      <nav className="flex-1 overflow-hidden flex flex-col p-2 gap-1">
        {/* Chat nav item: acts as "New Chat" button, never highlighted as active */}
        <button
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) newSession();
            navigate('/');
          }}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground text-muted-foreground',
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
          <div className="mt-1 overflow-y-auto max-h-72 space-y-0.5">
            {[...mainSessions, ...[...otherSessions].sort((a, b) =>
              (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
            )].map((s) => (
              <div key={s.key} className="group relative flex items-center">
                {sessionToRename?.key === s.key ? (
                  <div className="flex w-full items-center gap-1 px-2 py-1">
                    <Input
                      value={sessionToRename.value}
                      onChange={(event) => setSessionToRename((prev) => (
                        prev ? { ...prev, value: event.target.value } : prev
                      ))}
                      placeholder={t('sidebar.renameSessionPlaceholder', 'Session title')}
                      className="h-8 text-sm"
                      disabled={renamingSessionKey === s.key}
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
                      aria-label={t('sidebar.saveSessionRename', 'Save session title')}
                      onClick={() => void handleRenameSubmit()}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded transition-colors',
                        'text-muted-foreground hover:text-primary hover:bg-accent',
                        renamingSessionKey === s.key && 'opacity-60'
                      )}
                      disabled={renamingSessionKey === s.key}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      aria-label={t('sidebar.cancelSessionRename', 'Cancel renaming session')}
                      onClick={() => setSessionToRename(null)}
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
                      disabled={renamingSessionKey === s.key}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { switchSession(s.key); navigate('/'); }}
                      className={cn(
                        'w-full text-left rounded-md px-3 py-1.5 text-sm truncate transition-colors',
                        !s.key.endsWith(':main') && 'pr-12',
                        'hover:bg-accent hover:text-accent-foreground',
                        isOnChat && currentSessionKey === s.key
                          ? 'bg-accent/60 text-accent-foreground font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {getSessionLabel(s.key, s.displayName, s.label)}
                    </button>
                    {!s.key.endsWith(':main') && (
                      <>
                        <button
                          aria-label={t('sidebar.renameSession', 'Rename session')}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartRename(s.key, getSessionLabel(s.key, s.displayName, s.label));
                          }}
                          className={cn(
                            'absolute right-6 flex items-center justify-center rounded p-0.5 transition-opacity',
                            'opacity-0 group-hover:opacity-100',
                            'text-muted-foreground hover:text-primary hover:bg-accent',
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label={t('sidebar.deleteSession', 'Delete session')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionToDelete({
                              key: s.key,
                              label: getSessionLabel(s.key, s.displayName, s.label),
                            });
                          }}
                          className={cn(
                            'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                            'opacity-0 group-hover:opacity-100',
                            'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                          )}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-2 space-y-2">
        {devModeUnlocked && !sidebarCollapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={openDevConsole}
          >
            <Terminal className="h-4 w-4 mr-2" />
            {t('sidebar.devConsole')}
            <ExternalLink className="h-3 w-3 ml-auto" />
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
        title={t('actions.confirm', 'Confirm')}
        message={sessionToDelete ? t('sidebar.deleteSessionConfirm', { label: sessionToDelete.label }) : ''}
        confirmLabel={t('actions.delete', 'Delete')}
        cancelLabel={t('actions.cancel', 'Cancel')}
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
