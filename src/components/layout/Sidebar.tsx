/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  ExternalLink,
  Trash2,
  Cpu,
  ChevronDown,
  ChevronRight,
  Folder,
  MoreVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { useChatMetaStore } from '@/stores/chatMeta';
import { useProjectStore, type Project, type ProjectFolder } from '@/stores/projectStore';
import { useChatStore, type ChatSession } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

type SessionWithMeta = ChatSession & {
  meta: {
    folder: 'main' | 'project' | 'agl';
    projectId?: string;
    type: 'user' | 'agent' | 'system';
    customName?: string;
  };
};

const PROJECT_FOLDER_LABELS: Record<ProjectFolder, string> = {
  main: 'Main Folder',
  projects: 'Projects Folder',
  agl: 'AGL (Logs) Folder',
};

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    const hasExistingMessages = useChatStore.getState().messages.length > 0;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);

  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = useLocation().pathname === '/';

  const { t } = useTranslation(['common', 'chat']);

  const chatMetaStore = useChatMetaStore();
  const chatMeta = chatMetaStore.meta;
  const setMeta = chatMetaStore.setMeta;

  const projectStore = useProjectStore();
  const projects = projectStore.projects;
  const addProject = projectStore.addProject;
  const activeProjectId = projectStore.activeProjectId;
  const setActiveProject = projectStore.setActiveProject;
  const renameProject = projectStore.renameProject;
  const moveProject = projectStore.moveProject;
  const deleteProject = projectStore.deleteProject;

  const [expanded, setExpanded] = useState({ main: true, projects: true, agl: false });
  const [sessionMenuOpenId, setSessionMenuOpenId] = useState<string | null>(null);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);
  const [sessionToRename, setSessionToRename] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [projectToRename, setProjectToRename] = useState<string | null>(null);
  const [projectRenameValue, setProjectRenameValue] = useState('');
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const toggleExpanded = (key: keyof typeof expanded) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const getSessionLabel = (key: string, displayName?: string, label?: string) =>
    chatMeta[key]?.customName ?? sessionLabels[key] ?? label ?? displayName ?? key;

  const createProjectChat = (projectId: string) => {
    const previousActiveProjectId = activeProjectId;
    setActiveProject(projectId);
    const { messages } = useChatStore.getState();
    if (messages.length > 0) newSession();
    const newKey = useChatStore.getState().currentSessionKey;
    setMeta(newKey, { folder: 'project', projectId, type: 'user' });
    setActiveProject(previousActiveProjectId === projectId ? projectId : previousActiveProjectId ?? projectId);
    navigate('/');
  };

  const openDevConsole = async () => {
    try {
      const result = await hostApiFetch<{ success: boolean; url?: string; error?: string }>('/api/gateway/control-ui');
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const enrichedSessions: SessionWithMeta[] = [...sessions]
    .sort((a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0))
    .map((s) => ({
      ...s,
      meta: chatMeta[s.key] || { folder: 'main', type: 'user' },
    }));

  const mainSessions = enrichedSessions.filter((s) => s.meta.folder === 'main');
  const aglSessions = enrichedSessions.filter((s) => s.meta.folder === 'agl');
  const projectSessions = enrichedSessions.filter((s) => s.meta.folder === 'project');

  const sessionsByProject: Record<string, SessionWithMeta[]> = {};
  projectSessions.forEach((s) => {
    const pid = s.meta.projectId || 'unassigned';
    if (!sessionsByProject[pid]) sessionsByProject[pid] = [];
    sessionsByProject[pid].push(s);
  });

  const projectsByFolder: Record<ProjectFolder, Project[]> = {
    main: [],
    projects: [],
    agl: [],
  };
  for (const project of projects) {
    projectsByFolder[project.folder ?? 'projects'].push(project);
  }

  const startProjectRename = (project: Project) => {
    setProjectMenuOpenId(null);
    setProjectToRename(project.id);
    setProjectRenameValue(project.name);
  };

  const submitProjectRename = (projectId: string) => {
    const trimmed = projectRenameValue.trim();
    if (trimmed) {
      renameProject(projectId, trimmed);
    }
    setProjectToRename(null);
    setProjectRenameValue('');
  };

  const renderSession = (s: SessionWithMeta) => {
    const agentId = getAgentIdFromSessionKey(s.key);
    const agentName = agentNameById[agentId] || agentId;
    const isCurrent = isOnChat && currentSessionKey === s.key;

    return (
      <div
        key={s.key}
        className="group relative flex items-center"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', s.key);
        }}
      >
        <button
          onClick={() => {
            switchSession(s.key);
            navigate('/');
          }}
          className={cn(
            'w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] transition-colors pr-7',
            'hover:bg-black/5 dark:hover:bg-white/5',
            isCurrent ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium' : 'text-foreground/75',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 dark:bg-white/[0.08]">
              {agentName}
            </span>
            {sessionToRename === s.key ? (
              <input
                autoFocus
                className="w-full bg-background border rounded px-1 text-xs text-foreground"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setMeta(s.key, { customName: renameValue.trim() || undefined });
                    setSessionToRename(null);
                  } else if (e.key === 'Escape') {
                    setSessionToRename(null);
                  }
                }}
                onBlur={() => {
                  setMeta(s.key, { customName: renameValue.trim() || undefined });
                  setSessionToRename(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="truncate">{getSessionLabel(s.key, s.displayName, s.label)}</span>
            )}
          </div>
        </button>

        <button
          aria-label="Session actions"
          onClick={(e) => {
            e.stopPropagation();
            setProjectMenuOpenId(null);
            setSessionMenuOpenId(sessionMenuOpenId === s.key ? null : s.key);
          }}
          className={cn(
            'absolute right-6 flex items-center justify-center rounded p-0.5 transition-opacity',
            sessionMenuOpenId === s.key ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            'text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10',
          )}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        {sessionMenuOpenId === s.key && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSessionMenuOpenId(null)} />
            <div
              className="absolute right-6 top-6 z-50 w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1.5 font-semibold text-muted-foreground">Actions</div>
              <button
                className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm"
                onClick={() => {
                  setSessionToRename(s.key);
                  setRenameValue(getSessionLabel(s.key, s.displayName, s.label));
                  setSessionMenuOpenId(null);
                }}
              >
                Rename
              </button>
              <div className="h-px bg-border my-1" />
              <div className="px-2 py-1.5 font-semibold text-muted-foreground">Move to...</div>
              <button
                className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm"
                onClick={() => {
                  setMeta(s.key, { folder: 'main', projectId: undefined });
                  setSessionMenuOpenId(null);
                }}
              >
                Main
              </button>
              <button
                className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm"
                onClick={() => {
                  setMeta(s.key, { folder: 'agl', projectId: undefined });
                  setSessionMenuOpenId(null);
                }}
              >
                AGL
              </button>
              {projects.length > 0 && <div className="h-px bg-border my-1" />}
              {projects.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm truncate"
                  onClick={() => {
                    setMeta(s.key, { folder: 'project', projectId: p.id });
                    setSessionMenuOpenId(null);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          aria-label="Delete session"
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
      </div>
    );
  };

  const renderProjectHeader = (project: Project) => {
    const isActive = activeProjectId === project.id;
    const isRenaming = projectToRename === project.id;

    return (
      <div className="group flex items-center gap-1 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5">
        <div
          className={cn(
            'min-w-0 flex-1 cursor-pointer rounded-md px-1 py-0.5 text-[11px] font-medium uppercase tracking-wider transition-colors',
            isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
          )}
          onClick={() => setActiveProject(isActive ? null : project.id)}
          title="Click to set active project"
        >
          {isRenaming ? (
            <input
              autoFocus
              className="w-full bg-background border rounded px-1 py-0.5 text-[11px] font-medium tracking-normal text-foreground"
              value={projectRenameValue}
              onChange={(e) => setProjectRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  submitProjectRename(project.id);
                } else if (e.key === 'Escape') {
                  setProjectToRename(null);
                  setProjectRenameValue('');
                }
              }}
              onBlur={() => submitProjectRename(project.id)}
            />
          ) : (
            <span className="block truncate">{project.name}</span>
          )}
        </div>

        <button
          aria-label={`New chat in ${project.name}`}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            createProjectChat(project.id);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        <button
          aria-label={`Project actions for ${project.name}`}
          className={cn(
            'rounded p-1 text-muted-foreground transition-opacity hover:bg-black/10 dark:hover:bg-white/10',
            projectMenuOpenId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            setSessionMenuOpenId(null);
            setProjectMenuOpenId(projectMenuOpenId === project.id ? null : project.id);
          }}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        <button
          aria-label={`Delete project ${project.name}`}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            setProjectToDelete({ id: project.id, name: project.name });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {projectMenuOpenId === project.id && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpenId(null)} />
            <div
              className="absolute right-2 mt-24 z-50 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1.5 font-semibold text-muted-foreground">Project</div>
              <button
                className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm"
                onClick={() => startProjectRename(project)}
              >
                Rename project
              </button>
              <div className="h-px bg-border my-1" />
              <div className="px-2 py-1.5 font-semibold text-muted-foreground">Move to folder...</div>
              {(['main', 'projects', 'agl'] as ProjectFolder[]).map((folder) => (
                <button
                  key={folder}
                  className="w-full text-left px-2 py-1 hover:bg-accent hover:text-accent-foreground rounded-sm"
                  onClick={() => {
                    moveProject(project.id, folder);
                    setProjectMenuOpenId(null);
                  }}
                >
                  {PROJECT_FOLDER_LABELS[folder]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderProjectGroup = (folder: ProjectFolder) => {
    const folderProjects = projectsByFolder[folder];
    if (folderProjects.length === 0) return null;

    return folderProjects.map((project) => {
      const pSessions = sessionsByProject[project.id] || [];
      return (
        <div
          key={project.id}
          className="relative mt-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const sessionKey = e.dataTransfer.getData('text/plain');
            if (sessionKey) setMeta(sessionKey, { folder: 'project', projectId: project.id });
          }}
        >
          {renderProjectHeader(project)}
          <div className="mt-0.5 space-y-0.5 pl-2">{pSessions.map(renderSession)}</div>
        </div>
      );
    });
  };

  const navItems = [
    { to: '/models', icon: <Cpu className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.models') },
    { to: '/agents', icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.agents') },
    { to: '/channels', icon: <Network className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.channels') },
    { to: '/skills', icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.skills') },
    { to: '/cron', icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />, label: t('sidebar.cronTasks') },
  ];

  return (
    <aside
      className={cn(
        'flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-[#eae8e1]/60 dark:bg-background transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-64',
      )}
      data-testid="sidebar"
    >
      <div className={cn('flex items-center p-2 h-12', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-2 overflow-hidden">
            <img src={logoSvg} alt="ClawX" className="h-5 w-auto shrink-0" />
            <span className="text-sm font-semibold truncate whitespace-nowrap text-foreground/90">ClawX</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        </Button>
      </div>

      <nav className="flex flex-col px-2 gap-0.5">
        <button
          onClick={() => {
            const { messages } = useChatStore.getState();
            if (messages.length > 0) newSession();
            const newKey = useChatStore.getState().currentSessionKey;
            if (activeProjectId) {
              setMeta(newKey, { folder: 'project', projectId: activeProjectId, type: 'user' });
            } else {
              setMeta(newKey, { folder: 'main', type: 'user' });
            }
            navigate('/');
          }}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors mb-2',
            'bg-black/5 dark:bg-accent shadow-none border border-transparent text-foreground',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-foreground/80">
            <Plus className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors mb-0.5',
                'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
                isActive && 'bg-black/5 dark:bg-white/10 text-foreground',
                sidebarCollapsed && 'justify-center px-0',
              )
            }
          >
            {({ isActive }) => (
              <>
                <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                  {item.icon}
                </div>
                {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!sidebarCollapsed && sessions.length > 0 && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 mt-4 space-y-2 pb-2">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const sessionKey = e.dataTransfer.getData('text/plain');
              if (sessionKey) setMeta(sessionKey, { folder: 'main', projectId: undefined });
            }}
          >
            <button
              onClick={() => toggleExpanded('main')}
              className="flex items-center w-full px-2 py-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded.main ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
              <Folder className="w-4 h-4 mr-2" /> Main Folder
            </button>
            {expanded.main && (
              <div className="mt-1 space-y-2 pl-2">
                {renderProjectGroup('main')}
                {mainSessions.length > 0 && <div className="space-y-0.5">{mainSessions.map(renderSession)}</div>}
              </div>
            )}
          </div>

          <div>
            <div
              className="flex items-center justify-between w-full pr-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const sessionKey = e.dataTransfer.getData('text/plain');
                if (sessionKey) setMeta(sessionKey, { folder: 'project', projectId: undefined });
              }}
            >
              <button
                onClick={() => toggleExpanded('projects')}
                className="flex items-center flex-1 px-2 py-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded.projects ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                <Folder className="w-4 h-4 mr-2" /> Projects Folder
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((p) => ({ ...p, projects: true }));
                  setIsAddingProject(true);
                }}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                title="New Project"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {isAddingProject && (
              <div className="px-4 py-1">
                <input
                  autoFocus
                  className="w-full bg-background border rounded px-2 py-1 text-xs text-foreground"
                  placeholder="Project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProjectName.trim()) {
                      addProject(newProjectName.trim(), 'projects');
                      setIsAddingProject(false);
                      setNewProjectName('');
                    } else if (e.key === 'Escape') {
                      setIsAddingProject(false);
                      setNewProjectName('');
                    }
                  }}
                  onBlur={() => {
                    setIsAddingProject(false);
                    setNewProjectName('');
                  }}
                />
              </div>
            )}

            {expanded.projects && (
              <div className="mt-1 space-y-2 pl-4">
                {renderProjectGroup('projects')}
                {sessionsByProject.unassigned && sessionsByProject.unassigned.length > 0 && (
                  <div>
                    <div className="flex items-center px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Unassigned</div>
                    <div className="mt-0.5 space-y-0.5 pl-2">{sessionsByProject.unassigned.map(renderSession)}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const sessionKey = e.dataTransfer.getData('text/plain');
              if (sessionKey) setMeta(sessionKey, { folder: 'agl', projectId: undefined });
            }}
          >
            <button
              onClick={() => toggleExpanded('agl')}
              className="flex items-center w-full px-2 py-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded.agl ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
              <Folder className="w-4 h-4 mr-2" /> AGL (Logs) Folder
            </button>
            {expanded.agl && (
              <div className="mt-1 space-y-2 pl-2">
                {renderProjectGroup('agl')}
                {aglSessions.length > 0 && <div className="space-y-0.5">{aglSessions.map(renderSession)}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="p-2 mt-auto">
        <NavLink
          to="/settings"
          data-testid="sidebar-nav-settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors',
              'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
              isActive && 'bg-black/5 dark:bg-white/10 text-foreground',
              sidebarCollapsed ? 'justify-center px-0' : '',
            )
          }
        >
          {({ isActive }) => (
            <>
              <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
              {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
            </>
          )}
        </NavLink>

        <Button
          data-testid="sidebar-open-dev-console"
          variant="ghost"
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 h-auto text-[14px] font-medium transition-colors w-full mt-1',
            'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
            sidebarCollapsed ? 'justify-center px-0' : 'justify-start',
          )}
          onClick={openDevConsole}
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            <Terminal className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <>
              <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('common:sidebar.openClawPage')}</span>
              <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50 text-muted-foreground" />
            </>
          )}
        </Button>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />

      <ConfirmDialog
        open={!!projectToDelete}
        title={t('common:actions.confirm')}
        message={`Delete project "${projectToDelete?.name}"? Its chats will be moved to Main.`}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          if (!projectToDelete) return;
          const pSessions = sessionsByProject[projectToDelete.id] || [];
          pSessions.forEach((s) => {
            setMeta(s.key, { folder: 'main', projectId: undefined });
          });
          deleteProject(projectToDelete.id);
          setProjectToDelete(null);
        }}
        onCancel={() => setProjectToDelete(null)}
      />
    </aside>
  );
}
