/** Workspace navigation and the single shared file preview surface. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps, type RowRendererProps } from 'react-arborist';
import { ChevronRight, ChevronsDownUp, Eye, EyeOff, Folder, FolderOpen, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { findNode, loadWorkspaceTree, type WorkspaceTreeNode } from '@/lib/workspace-tree';
import { expandedSearchPaths, visibleWorkspaceChildren, workspaceRelativePath } from '@/lib/workspace-browser';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { DEFAULT_WORKSPACE_BROWSER_PREFERENCES, useWorkspaceBrowser, type WorkspaceFileView } from '@/stores/workspace-browser';
import type { AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';
import type { AgentSummary } from '@/types/agent';
import { MaterialFileIcon } from './MaterialFileIcon';
import { buildWorkspacePreviewTarget } from './build-preview-target';
import { FilePreviewSurface } from './FilePreviewSurface';

const TREE_INDENT_PX = 12;
const EMPTY_GROUPS: AcpSessionFileGroup[] = [];

function displayWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~');
}

export interface WorkspaceBrowserBodyProps {
  agent: AgentSummary | null;
  workspacePath?: string | null;
  workspaceLabel?: string;
  runStartedAt?: number | null;
  refreshSignal?: number;
  compact?: boolean;
  treeWidth?: number;
  toolbarTrailing?: React.ReactNode;
  active?: boolean;
  previewOnly?: boolean;
  fileGroups?: AcpSessionFileGroup[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; root: WorkspaceTreeNode; truncated: boolean }
  | { status: 'error' };

export function WorkspaceBrowserBody({ agent, workspacePath, workspaceLabel, runStartedAt, refreshSignal, treeWidth, toolbarTrailing, active = true, previewOnly = false, fileGroups = EMPTY_GROUPS }: WorkspaceBrowserBodyProps) {
  const { t } = useTranslation('chat');
  const workspace = workspacePath?.trim() || agent?.workspace || '';
  const scope = `${agent?.id ?? ''}:${workspace}`;
  const preferences = useWorkspaceBrowser(state => state.scopes[scope] ?? DEFAULT_WORKSPACE_BROWSER_PREFERENCES);
  const updatePreferences = useWorkspaceBrowser(state => state.update);
  const remember = useWorkspaceBrowser(state => state.remember);
  const file = useArtifactPanel(state => state.focusedFile);
  const setFile = useArtifactPanel(state => state.setFocusedFile);
  const [load, setLoad] = useState<{ scope: string; value: LoadState }>({ scope, value: { status: 'loading' } });
  const state: LoadState = load.scope === scope ? load.value : { status: 'loading' };
  const [refreshTick, setRefreshTick] = useState(0);
  const [queryState, setQueryState] = useState({ scope, value: '' });
  const query = queryState.scope === scope ? queryState.value : '';
  const setQuery = (value: string) => setQueryState({ scope, value });
  const [treeVersion, setTreeVersion] = useState(0);
  const [listOnly, setListOnly] = useState(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const recordedFocus = useRef<{ scope: string; file: typeof file }>({ scope, file: null });
  const root = state.status === 'ready' ? state.root : null;
  const resolvedWorkspace = root?.absPath || workspace;
  const selectedRel = workspaceRelativePath(file, resolvedWorkspace) ?? workspaceRelativePath(file, workspace);
  const narrow = width > 0 && width < 560;
  const showFiles = !previewOnly && (!narrow || !file || listOnly);
  const showPreview = previewOnly || !narrow || (!!file && !listOnly);
  const maxNavigationWidth = Math.max(160, Math.min(400, Math.floor(width * 0.5)));
  const navigationWidth = Math.min(treeWidth ?? preferences.treeWidth, maxNavigationWidth);
  const children = useMemo(() => root ? visibleWorkspaceChildren(root, query, preferences.showHidden) : [], [root, query, preferences.showHidden]);
  const expanded = useMemo(() => query.trim() ? expandedSearchPaths(children) : Object.fromEntries(preferences.expanded.map(path => [path, true])), [children, preferences.expanded, query]);
  const taskPaths = useMemo(() => fileGroups
    .map(group => ({ path: group.relativePath, last: group.activities.reduce<(typeof group.activities)[number] | undefined>((last, item) => !last || item.sequence > last.sequence ? item : last, undefined) }))
    .filter(item => item.last && item.last.action !== 'deleted')
    .sort((a, b) => (b.last?.sequence ?? 0) - (a.last?.sequence ?? 0))
    .map(item => item.path), [fileGroups]);
  const quickPaths = (preferences.view === 'task' ? taskPaths : preferences.recent).filter(path => (
    (preferences.showHidden || !path.split(/[\\/]/).some(part => part.startsWith('.')))
    && path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (preferences.view === 'task' || (root && findNode(root, path)))
  ));

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void loadWorkspaceTree(workspace, { runStartedAt: runStartedAt ?? null, includeHidden: true }).then(result => {
      if (!cancelled) setLoad({ scope, value: result ? { status: 'ready', ...result } : { status: 'error' } });
    }, () => { if (!cancelled) setLoad({ scope, value: { status: 'error' } }); });
    return () => { cancelled = true; };
  }, [workspace, runStartedAt, refreshTick, refreshSignal, scope]);

  useEffect(() => {
    // A retained file from the previous workspace must not become history in
    // the new scope while its directory request is resolving.
    if (recordedFocus.current.scope !== scope) {
      recordedFocus.current = { scope, file };
      return;
    }
    if (file !== recordedFocus.current.file && selectedRel && root && findNode(root, selectedRel)) {
      recordedFocus.current = { scope, file };
      remember(scope, selectedRel);
    }
  }, [file, selectedRel, root, scope, remember]);

  useLayoutEffect(() => {
    const update = () => {
      setWidth(containerRef.current?.clientWidth ?? 0);
      setHeight(Math.max(1, treeRef.current?.clientHeight ?? 1));
    };
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    if (treeRef.current) observer.observe(treeRef.current);
    return () => observer.disconnect();
  }, [showFiles, state.status, previewOnly, preferences.view]);

  useEffect(() => () => dragCleanup.current?.(), []);
  const resize = useCallback((value: number) => updatePreferences(scope, { treeWidth: Math.round(Math.max(160, Math.min(maxNavigationWidth, value))) }), [scope, updatePreferences, maxNavigationWidth]);
  const openFile = (relativePath: string) => {
    const node = root ? findNode(root, relativePath) : null;
    setFile(buildWorkspacePreviewTarget({ workspaceRoot: resolvedWorkspace, relativePath }, { size: node?.size }));
    remember(scope, relativePath);
    setListOnly(false);
  };
  const browse = () => { useArtifactPanel.getState().setTab('browser'); setListOnly(true); requestAnimationFrame(() => searchRef.current?.focus()); };

  const renderFiles = () => {
    if (!workspace) return <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t('workspace.empty')}</div>;
    if (state.status === 'loading') return <div className="flex h-full items-center justify-center"><LoadingSpinner size="sm" /></div>;
    if (state.status === 'error' || !workspace) return <div className="px-4 py-8 text-center text-xs text-muted-foreground">{t('workspace.empty')}</div>;
    if (preferences.view !== 'all') return (
      <div className="h-full space-y-1 overflow-y-auto p-1.5" data-testid="workspace-quick-files">
        {!quickPaths.length && <div className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">{t(query.trim() ? 'workspace.noResults' : preferences.view === 'task' ? 'workspace.taskEmpty' : 'workspace.recentEmpty')}</div>}
        {quickPaths.map(path => <button key={path} type="button" title={path} data-testid={`workspace-quick-file-${path}`} aria-current={selectedRel === path ? 'true' : undefined} onClick={() => openFile(path)} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40', selectedRel === path ? 'bg-primary/10' : 'hover:bg-black/5 dark:hover:bg-white/5')}>
          <MaterialFileIcon filename={path} className="h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block truncate font-medium">{path.split(/[\\/]/).pop()}</span><span className="block truncate text-2xs text-muted-foreground">{path}</span></span>
        </button>)}
      </div>
    );
    if (!children.length) return <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t(query.trim() ? 'workspace.noResults' : 'workspace.noFiles')}</p>;
    return <Tree<WorkspaceTreeNode> key={`${scope}:${treeVersion}:${query}:${preferences.showHidden}`} data={children} idAccessor={node => node.relPath} childrenAccessor={node => node.children ?? null} selection={selectedRel ?? undefined} initialOpenState={expanded} openByDefault={false} disableDrag disableDrop disableEdit disableMultiSelection height={height} width="100%" rowHeight={28} indent={TREE_INDENT_PX} overscanCount={6} renderRow={WorkspaceTreeContainerRow}
      onActivate={node => { if (node.data.isDir) node.toggle(); else openFile(node.data.relPath); }}
      onToggle={id => {
        if (query.trim()) return;
        const paths = new Set(preferences.expanded);
        if (paths.has(id)) paths.delete(id); else paths.add(id);
        updatePreferences(scope, { expanded: [...paths] });
      }}>
      {WorkspaceTreeRow}
    </Tree>;
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col" data-testid="workspace-browser-body">
      {!previewOnly && <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <h2 data-testid="workspace-header-title" className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FolderOpen className="h-4 w-4 shrink-0 text-primary/75" />
            <span data-testid="workspace-path-tag" title={resolvedWorkspace} className="truncate">{workspaceLabel || displayWorkspacePath(workspace) || t('workspace.title')}</span>
          </h2>
          <p data-testid="workspace-agent-tag" title={agent?.name} className="mt-0.5 truncate pl-6 text-2xs text-muted-foreground">{agent?.name}</p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workspace.actions.refresh')} aria-label={t('workspace.actions.refresh')} disabled={state.status === 'loading'} onClick={() => { setLoad({ scope, value: { status: 'loading' } }); setRefreshTick(value => value + 1); }}><RefreshCw className={cn('h-3.5 w-3.5', state.status === 'loading' && 'animate-spin')} /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title={t('workspace.actions.openRootInFinder')} aria-label={t('workspace.actions.openRootInFinder')} onClick={() => { void hostApi.shell.showItemInFolder(resolvedWorkspace).catch(() => toast.error(t('filePreview.errors.openInFinderFailed'))); }}><FolderOpen className="h-3.5 w-3.5" /></Button>
          {toolbarTrailing}
        </div>
      </header>}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className={cn('flex min-h-0 min-w-0 shrink-0 flex-col bg-surface-input/30', !showFiles && 'hidden')} style={{ width: narrow ? '100%' : navigationWidth }} aria-label={t('workspace.browseFiles')}>
          <div className="flex items-center gap-1 px-2 pt-2">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input ref={searchRef} data-testid="workspace-file-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('workspace.search')} aria-label={t('workspace.search')} className="h-8 rounded-lg pl-7 pr-6 text-xs" />{query && <button type="button" className="absolute right-1.5 top-2 text-muted-foreground" aria-label={t('workspace.clearSearch')} onClick={() => setQuery('')}><X className="h-3.5 w-3.5" /></button>}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" data-testid="workspace-show-hidden" title={t('workspace.showHidden')} aria-label={t('workspace.showHidden')} aria-pressed={preferences.showHidden} onClick={() => updatePreferences(scope, { showHidden: !preferences.showHidden })}>{preferences.showHidden ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5" />}</Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" data-testid="workspace-collapse-all" title={t('workspace.collapseAll')} aria-label={t('workspace.collapseAll')} onClick={() => { setQuery(''); updatePreferences(scope, { expanded: [] }); setTreeVersion(value => value + 1); }}><ChevronsDownUp className="h-3.5 w-3.5" /></Button>
          </div>
          <Tabs value={preferences.view} onValueChange={view => updatePreferences(scope, { view: view as WorkspaceFileView })} className="px-2 py-2">
            <TabsList className="grid h-7 w-full grid-cols-3 rounded-lg p-0.5" aria-label={t('workspace.browseFiles')}>
              {(['all', 'task', 'recent'] as const).map(view => <TabsTrigger key={view} value={view} data-testid={`workspace-view-${view}`} className="h-6 rounded-md px-1 py-0 text-2xs">{t(`workspace.views.${view}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <div ref={treeRef} data-testid="workspace-tree" className="min-h-0 flex-1">{renderFiles()}</div>
          {state.status === 'ready' && (state.truncated || !!query.trim()) && <p className="border-t border-border/60 px-2 py-1.5 text-2xs text-muted-foreground">{t(state.status === 'ready' && state.truncated ? 'workspace.searchLimited' : 'workspace.searchScope')}</p>}
        </aside>
        {showFiles && showPreview && <div role="separator" aria-label={t('workspace.resizeFiles')} aria-orientation="vertical" aria-valuemin={160} aria-valuemax={maxNavigationWidth} aria-valuenow={Math.round(navigationWidth)} tabIndex={0} data-testid="workspace-tree-divider" className="w-1 shrink-0 cursor-col-resize border-l border-border/60 hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none"
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(navigationWidth + (event.key === 'ArrowLeft' ? -16 : 16)); } else if (event.key === 'Home') { event.preventDefault(); resize(160); } else if (event.key === 'End') { event.preventDefault(); resize(maxNavigationWidth); } }}
          onPointerDown={event => {
            event.preventDefault(); dragCleanup.current?.();
            const left = containerRef.current!.getBoundingClientRect().left;
            const move = (ev: PointerEvent) => resize(ev.clientX - left);
            const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); document.body.style.cursor = ''; document.body.style.userSelect = ''; dragCleanup.current = null; };
            window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; dragCleanup.current = stop;
          }} />}
        <section className={cn('min-h-0 min-w-0 flex-1', !showPreview && 'hidden')}>
          <FilePreviewSurface file={file} revision={refreshTick + (refreshSignal ?? 0)} active={active && showPreview} onBrowse={browse} backToFiles={narrow && !previewOnly} />
        </section>
      </div>
    </div>
  );
}
function WorkspaceTreeContainerRow<T>({ attrs, innerRef, children }: RowRendererProps<T>) {
  return (
    <div {...attrs} ref={innerRef} onClick={undefined} className="!min-w-full">
      {children}
    </div>
  );
}

function WorkspaceTreeRow({ node, style }: NodeRendererProps<WorkspaceTreeNode>) {
  const data = node.data;
  const isOpen = data.isDir && node.isOpen;
  const indent = node.level * TREE_INDENT_PX;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    node.activate();
  };

  return (
    <div style={style} className="h-full px-1" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={data.isDir ? isOpen : undefined}
        className={cn(
          'flex h-full w-full items-center gap-1 rounded-md pr-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40',
          node.isSelected
            ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/15'
            : 'hover:bg-black/5 dark:hover:bg-white/10',
        )}
        style={{ paddingLeft: indent }}
        title={data.relPath || data.name}
      >
        {data.isDir ? (
          <>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                isOpen && 'rotate-90',
              )}
            />
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{data.name}</span>
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <MaterialFileIcon filename={data.name} className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{data.name}</span>
          </>
        )}
        {data.isFresh && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        )}
      </button>
    </div>
  );
}

export default WorkspaceBrowserBody;
