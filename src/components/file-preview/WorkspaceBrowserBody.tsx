/**
 * Inline workspace browser body — left tree + right preview.
 *
 * Strictly scoped to the current agent's `agent.workspace` directory.
 * Used by `ArtifactPanel`'s 浏览器 tab (split-pane on the chat page).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc, readTextFile } from '@/lib/api-client';
import { supportsInlineDocumentPreview } from '@/lib/generated-files';
import {
  collectInitialExpanded,
  findNode,
  loadWorkspaceTree,
  type WorkspaceTreeNode,
} from '@/lib/workspace-tree';
import type { AgentSummary } from '@/types/agent';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';
import MarkdownPreview from './MarkdownPreview';
import ImageViewer from './ImageViewer';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));

export interface WorkspaceBrowserBodyProps {
  agent: AgentSummary | null;
  /** Used to mark "本轮新增" badges on the tree. */
  runStartedAt?: number | null;
  /** Bumping this number triggers a tree reload (e.g. after AI run idles). */
  refreshSignal?: number;
  /** Compact mode used inside the side panel (smaller fonts/paddings). */
  compact?: boolean;
  /** Left tree column width in px. */
  treeWidth?: number;
  /** Optional slot rendered in the toolbar (e.g. close button when used in a Sheet). */
  toolbarTrailing?: React.ReactNode;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; root: WorkspaceTreeNode; truncated: boolean }
  | { status: 'error'; message: string };

type FileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'tooLarge' }
  | { status: 'binary' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export function WorkspaceBrowserBody({
  agent,
  runStartedAt,
  refreshSignal,
  compact = false,
  treeWidth,
  toolbarTrailing,
}: WorkspaceBrowserBodyProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileState>({ status: 'idle' });
  const [refreshTick, setRefreshTick] = useState(0);
  const [showHidden, setShowHidden] = useState(false);

  const workspace = agent?.workspace ?? '';

  const reload = useCallback(() => setRefreshTick((v) => v + 1), []);

  // Reset selection when the agent changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on agent switch */
    setSelectedRel(null);
    setFileState({ status: 'idle' });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [agent?.id]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async tree fetch
    setState({ status: 'loading' });
    loadWorkspaceTree(workspace, {
      runStartedAt: runStartedAt ?? null,
      includeHidden: showHidden,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setState({ status: 'error', message: 'load' });
          return;
        }
        setState({ status: 'ready', root: res.root, truncated: res.truncated });
        setExpanded((prev) => (prev.size > 0 ? prev : collectInitialExpanded(res.root, 1)));
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, runStartedAt, refreshTick, showHidden, refreshSignal]);

  const selectedNode = useMemo(() => {
    if (!selectedRel || state.status !== 'ready') return null;
    return findNode(state.root, selectedRel);
  }, [selectedRel, state]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- selection-driven loader */
    if (!selectedNode || selectedNode.isDir) {
      setFileState({ status: 'idle' });
      return;
    }
    const node = selectedNode;
    if (node.contentType === 'document' && !supportsInlineDocumentPreview(node.ext ?? '')) {
      setFileState({ status: 'unsupported' });
      return;
    }
    if (node.contentType === 'snapshot' || node.contentType === 'video' || node.contentType === 'audio') {
      setFileState({ status: 'ready', content: '' });
      return;
    }
    let cancelled = false;
    setFileState({ status: 'loading' });
    /* eslint-enable react-hooks/set-state-in-effect */
    readTextFile(node.absPath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'tooLarge') {
            setFileState({ status: 'tooLarge' });
            return;
          }
          if (res.error === 'binary') {
            setFileState({ status: 'binary' });
            return;
          }
          setFileState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        setFileState({ status: 'ready', content: res.content ?? '' });
      })
      .catch((err) => {
        if (cancelled) return;
        setFileState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const handleOpenWorkspaceInFinder = useCallback(() => {
    if (!workspace) return;
    invokeIpc('shell:openPath', workspace).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', '无法在 Finder 中显示'));
    });
  }, [workspace, t]);

  const toggleNode = useCallback((relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  }, []);

  const renderTree = () => {
    if (state.status === 'loading' || state.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      );
    }
    if (state.status === 'error') {
      return (
        <div className="px-4 py-6 text-xs text-destructive">
          {state.message === 'outsideSandbox'
            ? t('filePreview.errors.outsideSandbox', '路径越界，已拒绝读取')
            : t('workspace.empty', '工作空间为空或无法访问')}
        </div>
      );
    }
    return (
      <div className="space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-2xs uppercase tracking-wide text-muted-foreground">
          {t('workspace.title', '工作空间')}
          {agent?.name ? <span className="ml-1 text-foreground/60">· {agent.name}</span> : null}
        </div>
        <FileTreeNodeList
          nodes={state.root.children ?? []}
          depth={0}
          expanded={expanded}
          selectedRel={selectedRel}
          onToggle={toggleNode}
          onSelect={(rel) => setSelectedRel(rel)}
        />
        {state.truncated && (
          <div className="mt-2 px-3 py-2 text-2xs text-muted-foreground/80">
            {t('workspace.truncated', '目录过大，已截断显示 5000 个节点')}
          </div>
        )}
      </div>
    );
  };

  const renderBody = () => {
    if (!selectedNode || selectedNode.isDir) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('workspace.pickFile', '从左侧选择一个文件预览')}
        </div>
      );
    }
    if (selectedNode.contentType === 'snapshot') {
      return <ImageViewer filePath={selectedNode.absPath} fileName={selectedNode.name} />;
    }
    if (fileState.status === 'loading' || fileState.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }
    if (fileState.status === 'tooLarge') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{t('filePreview.errors.tooLarge', '文件过大，已禁用预览')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invokeIpc('shell:showItemInFolder', selectedNode.absPath)}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }
    if (fileState.status === 'binary') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{t('filePreview.errors.binary', '二进制文件不支持文本预览')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invokeIpc('shell:showItemInFolder', selectedNode.absPath)}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }
    if (fileState.status === 'error') {
      const errMsg = fileState.message;
      const hint = errMsg === 'outsideSandbox'
        ? t('filePreview.errors.outsideSandbox', '路径越界，已拒绝读取')
        : errMsg === 'notFound'
          ? t('filePreview.errors.notFound', '文件不存在')
          : errMsg;
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
          {hint}
        </div>
      );
    }
    if (fileState.status === 'unsupported') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {t('filePreview.errors.unsupportedFormatTitle', '此文件格式暂不支持内置预览或变更')}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {t(
                'filePreview.errors.unsupportedFormatHint',
                '当前仅支持文本/Markdown 等可直接读取的文件进行内置预览与变更对比。请在 Finder 中打开该文件。',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => invokeIpc('shell:showItemInFolder', selectedNode.absPath)}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }

    if (selectedNode.contentType === 'document') {
      return (
        <div className="h-full overflow-auto">
          <MarkdownPreview source={fileState.content} />
        </div>
      );
    }

    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
      >
        <MonacoViewerLazy filePath={selectedNode.absPath} value={fileState.content} readOnly />
      </Suspense>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        className={cn(
          'flex items-center justify-between gap-3 border-b border-black/5 dark:border-white/10',
          compact ? 'px-3 py-1.5' : 'px-4 py-2',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="truncate text-sm font-semibold">
            {t('workspace.title', '工作空间')}
            {agent?.name ? <span className="ml-2 font-normal text-foreground/70">· {agent.name}</span> : null}
          </h2>
          {workspace && !compact ? (
            <code className="hidden truncate rounded bg-black/5 px-2 py-0.5 text-2xs text-muted-foreground dark:bg-white/10 sm:inline">
              {workspace}
            </code>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowHidden((v) => !v)}
            title={t('workspace.actions.toggleHidden', '显示/隐藏隐藏文件')}
          >
            {showHidden
              ? t('workspace.actions.hideHidden', '隐藏隐藏文件')
              : t('workspace.actions.showHidden', '显示隐藏文件')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={reload}
            disabled={state.status === 'loading'}
            title={t('workspace.actions.refresh', '刷新')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', state.status === 'loading' && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleOpenWorkspaceInFinder}
            title={t('workspace.actions.openRootInFinder', '在 Finder 中显示根目录')}
          >
            <FolderOpen className="h-3.5 w-3.5 pointer-events-none" />
          </Button>
          {toolbarTrailing}
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: `${treeWidth ?? (compact ? 220 : 280)}px 1fr` }}
      >
        <aside className="min-h-0 overflow-hidden border-r border-black/5 dark:border-white/10">
          <div className="h-full overflow-y-auto py-2 text-sm">{renderTree()}</div>
        </aside>
        <section className="min-h-0 overflow-hidden">
          {selectedNode && !selectedNode.isDir && (
            <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-1.5 text-xs text-muted-foreground dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                <FilePreviewIcon
                  contentType={selectedNode.contentType}
                  mimeType={selectedNode.mimeType}
                  ext={selectedNode.ext}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate font-mono">{selectedNode.relPath || selectedNode.name}</span>
                {selectedNode.isFresh && (
                  <Badge variant="default" className="ml-1 text-2xs px-1.5 py-0">
                    {t('workspace.freshBadge', '本轮新增')}
                  </Badge>
                )}
              </div>
              <span className="shrink-0">{formatFileSize(selectedNode.size ?? 0)}</span>
            </div>
          )}
          <div className="h-[calc(100%-2rem)] min-h-0">{renderBody()}</div>
        </section>
      </div>
    </div>
  );
}

interface FileTreeNodeListProps {
  nodes: WorkspaceTreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedRel: string | null;
  onToggle: (relPath: string) => void;
  onSelect: (relPath: string) => void;
}

function FileTreeNodeList({ nodes, depth, expanded, selectedRel, onToggle, onSelect }: FileTreeNodeListProps) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <FileTreeNodeRow
          key={node.relPath || node.name}
          node={node}
          depth={depth}
          expanded={expanded}
          selectedRel={selectedRel}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface FileTreeNodeRowProps extends Omit<FileTreeNodeListProps, 'nodes'> {
  node: WorkspaceTreeNode;
}

function FileTreeNodeRow({ node, depth, expanded, selectedRel, onToggle, onSelect }: FileTreeNodeRowProps) {
  const isOpen = node.isDir && expanded.has(node.relPath);
  const isSelected = selectedRel === node.relPath;
  const indent = 12 + depth * 14;

  if (node.isDir) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(node.relPath)}
          className={cn(
            'flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs transition-colors',
            'hover:bg-black/5 dark:hover:bg-white/10',
          )}
          style={{ paddingLeft: indent }}
          title={node.relPath || node.name}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              isOpen && 'rotate-90',
            )}
          />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        {isOpen && node.children && node.children.length > 0 && (
          <FileTreeNodeList
            nodes={node.children}
            depth={depth + 1}
            expanded={expanded}
            selectedRel={selectedRel}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.relPath)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
          isSelected
            ? 'bg-primary/10 text-foreground'
            : 'hover:bg-black/5 dark:hover:bg-white/10',
        )}
        style={{ paddingLeft: indent + 16 }}
        title={node.relPath || node.name}
      >
        <FilePreviewIcon
          contentType={node.contentType}
          mimeType={node.mimeType}
          ext={node.ext}
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{node.name}</span>
        {node.isFresh && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
        )}
      </button>
    </li>
  );
}

export default WorkspaceBrowserBody;
