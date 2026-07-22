/**
 * Inline workspace browser body — left tree + right preview.
 *
 * Scoped to the effective chat workspace, falling back to the current agent's workspace.
 * Used by `ArtifactPanel`'s browser tab (split-pane on the chat page).
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeRendererProps, type RowRendererProps } from 'react-arborist';
import { ChevronRight, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { readTextFile, statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';
import {
  isDocxPreviewExt,
  isHtmlPreviewExt,
  isPdfPreviewExt,
  isPptxPreviewExt,
  isSheetPreviewExt,
  supportsInlineDocumentPreview,
  supportsRichDocumentPreview,
} from '@/lib/generated-files';
import {
  isFilePreviewWithinSizeLimit,
  richFilePreviewKind,
} from '@/lib/file-preview-capabilities';
import {
  collectInitialExpanded,
  findNode,
  loadWorkspaceTree,
  type WorkspaceTreeNode,
} from '@/lib/workspace-tree';
import type { AgentSummary } from '@/types/agent';
import { formatFileSize } from './format';
import {
  confirmAndOpenFile,
  shouldOfferDirectOpenFallback,
} from './open-file-utils';
import { MaterialFileIcon } from './MaterialFileIcon';
import MarkdownPreview from './MarkdownPreview';
import HtmlPreview from './HtmlPreview';
import ImageViewer from './ImageViewer';
import { getFilePreviewTargetIdentity } from './types';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));
const PdfViewerLazy = lazy(() => import('./PdfViewer'));
const SheetViewerLazy = lazy(() => import('./SheetViewer'));
const DocxViewerLazy = lazy(() => import('./DocxViewer'));
const PptxViewerLazy = lazy(() => import('./PptxViewer'));

const TREE_INDENT_PX = 8;

function formatWorkspacePath(workspace: string): string {
  if (!workspace) return '';

  const windowsHome = workspace.match(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/);
  if (windowsHome) {
    return `~${workspace.slice(windowsHome[0].length) || ''}`;
  }

  const normalized = workspace.replace(/\\/g, '/');
  const posixHome = normalized.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/);
  if (posixHome) {
    return `~${normalized.slice(posixHome[0].length) || ''}`;
  }

  return workspace;
}

function toOpenState(expanded: Set<string>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of expanded) {
    if (id) out[id] = true;
  }
  return out;
}

function splitDisplayPath(displayPath: string): { prefix: string; finalSegment: string } {
  const value = displayPath.trim();
  if (!value) return { prefix: '', finalSegment: '-' };

  const normalized = value.replace(/\\/g, '/');
  if (/^\/+$/u.test(normalized)) return { prefix: '', finalSegment: '/' };
  const windowsDriveRoot = normalized.match(/^([A-Za-z]:)\/+$/u);
  if (windowsDriveRoot) return { prefix: '', finalSegment: `${windowsDriveRoot[1]}/` };

  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex < 0) return { prefix: '', finalSegment: trimmed };
  if (slashIndex === 0) return { prefix: '/', finalSegment: trimmed.slice(1) || trimmed };
  return {
    prefix: trimmed.slice(0, slashIndex + 1),
    finalSegment: trimmed.slice(slashIndex + 1) || trimmed,
  };
}

function HeaderTag({ children, testId, title }: { children: React.ReactNode; testId: string; title?: string }) {
  return (
    <span
      data-testid={testId}
      title={title}
      className="inline-flex h-7 max-w-full min-w-0 items-center overflow-hidden whitespace-nowrap rounded-full border border-black/10 bg-black/[0.03] px-2.5 text-xs font-medium text-foreground/80 dark:border-white/10 dark:bg-white/[0.06]"
    >
      {children}
    </span>
  );
}

function WorkspacePathTag({ displayPath, title }: { displayPath: string; title: string }) {
  const { prefix, finalSegment } = splitDisplayPath(displayPath);
  return (
    <HeaderTag testId="workspace-path-tag" title={title}>
      <span data-testid="workspace-path-prefix" className="min-w-0 shrink-[999] truncate text-muted-foreground">
        {prefix}
      </span>
      <span data-testid="workspace-path-final-segment" className="min-w-0 shrink truncate font-semibold text-foreground">
        {finalSegment}
      </span>
    </HeaderTag>
  );
}

export interface WorkspaceBrowserBodyProps {
  agent: AgentSummary | null;
  /** Effective workspace root. Falls back to agent.workspace for older call sites. */
  workspacePath?: string | null;
  /** Optional display label for workspacePath. */
  workspaceLabel?: string;
  /** Used to mark "Added this run" badges on the tree. */
  runStartedAt?: number | null;
  /** Bumping this number triggers a tree reload (e.g. after AI run idles). */
  refreshSignal?: number;
  /** Compact mode used inside the side panel (smaller fonts/paddings). */
  compact?: boolean;
  /** Left tree column width in px. */
  treeWidth?: number;
  /** Optional slot rendered in the toolbar (e.g. close button when used in a Sheet). */
  toolbarTrailing?: React.ReactNode;
  /** Whether this browser surface is visible and may own the PPTX parser. */
  active?: boolean;
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
  | { status: 'tooLarge'; size?: number }
  | { status: 'binary'; size?: number }
  | { status: 'unsupported'; size?: number }
  | { status: 'error'; message: string };

export function WorkspaceBrowserBody({
  agent,
  workspacePath,
  workspaceLabel,
  runStartedAt,
  refreshSignal,
  compact = false,
  treeWidth,
  toolbarTrailing,
  active = true,
}: WorkspaceBrowserBodyProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileState>({ status: 'idle' });
  const [fileStatePath, setFileStatePath] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [openRelPathState, setOpenRelPathState] = useState<{ scope: string; paths: Set<string> | null }>({
    scope: '',
    paths: null,
  });
  const treeContainerRef = useRef<HTMLDivElement | null>(null);
  const [treeHeight, setTreeHeight] = useState(0);
  const [pptxSlidePositions] = useState(() => new Map<string, number>());

  const explicitWorkspace = workspacePath?.trim() ?? '';
  const workspace = explicitWorkspace || agent?.workspace || '';
  const treeScope = `${agent?.id ?? ''}:${workspace}`;
  const openRelPaths = openRelPathState.scope === treeScope ? openRelPathState.paths : null;
  const workspaceDisplayPath = explicitWorkspace
    ? workspaceLabel || formatWorkspacePath(workspace)
    : formatWorkspacePath(workspace);
  const agentDisplayName = agent?.name?.trim() || '-';
  const directoryDisplayPath = workspaceDisplayPath || '-';
  const headerTitle = t('workspace.header', {
    defaultValue: 'Agent: {{agent}} · Directory: {{directory}}',
    agent: agentDisplayName,
    directory: directoryDisplayPath,
  });

  const reload = useCallback(() => setRefreshTick((v) => v + 1), []);

  useLayoutEffect(() => {
    const updateTreeHeight = () => {
      const nextHeight = treeContainerRef.current?.clientHeight ?? 0;
      setTreeHeight(Math.max(1, nextHeight));
    };

    updateTreeHeight();

    const element = treeContainerRef.current;
    if (!element) return undefined;

    window.addEventListener('resize', updateTreeHeight);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', updateTreeHeight);
      };
    }

    const observer = new ResizeObserver(updateTreeHeight);
    observer.observe(element);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateTreeHeight);
    };
  }, [state.status]);

  // Reset selection when the agent changes.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- intentional reset on agent switch */
    setSelectedRel(null);
    setFileState({ status: 'idle' });
    setFileStatePath(null);
    setOpenRelPathState({ scope: treeScope, paths: null });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [treeScope]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async tree fetch
    setState({ status: 'loading' });
    loadWorkspaceTree(workspace, {
      runStartedAt: runStartedAt ?? null,
      includeHidden: true,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setState({ status: 'error', message: 'load' });
          return;
        }
        setOpenRelPathState((prev) => {
          const initialExpanded = collectInitialExpanded(res.root, 1);
          return {
            scope: treeScope,
            paths: prev.scope === treeScope ? prev.paths ?? initialExpanded : initialExpanded,
          };
        });
        setState({ status: 'ready', root: res.root, truncated: res.truncated });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, runStartedAt, refreshTick, refreshSignal, treeScope]);

  const selectedNode = useMemo(() => {
    if (!selectedRel || state.status !== 'ready') return null;
    return findNode(state.root, selectedRel);
  }, [selectedRel, state]);

  const initialOpenState = useMemo(() => {
    if (state.status !== 'ready') return {};
    return toOpenState(openRelPaths ?? collectInitialExpanded(state.root, 1));
  }, [openRelPaths, state]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- selection-driven loader */
    if (!selectedNode || selectedNode.isDir) {
      setFileState({ status: 'idle' });
      setFileStatePath(null);
      return;
    }
    const node = selectedNode;
    setFileStatePath(node.absPath);
    let cancelled = false;
    if (node.contentType === 'document' && !supportsInlineDocumentPreview(node.ext ?? '')) {
      setFileState({ status: 'loading' });
      void statFile(node.absPath)
        .then((res) => {
          if (cancelled) return;
          setFileState({ status: 'unsupported', size: res.ok ? res.size : undefined });
        })
        .catch(() => {
          if (cancelled) return;
          setFileState({ status: 'unsupported' });
        });
      return () => {
        cancelled = true;
      };
    }
    if (supportsRichDocumentPreview(node.ext ?? '')) {
      // Binary rich viewers handle their own loading; we only need
      // a stat for the badge / direct-open fallbacks.  Files that exceed
      // the inline cap fall back to the existing tooLarge UI so users
      // can still open them with the system default app.
      setFileState({ status: 'loading' });
      void statFile(node.absPath)
        .then((res) => {
          if (cancelled) return;
          const richKind = richFilePreviewKind({
            ext: node.ext ?? '',
            mimeType: node.mimeType ?? '',
          });
          if (
            res.ok
            && richKind
            && typeof res.size === 'number'
            && !isFilePreviewWithinSizeLimit({ kind: 'rich', richKind }, res.size)
          ) {
            setFileState({ status: 'tooLarge', size: res.size });
            return;
          }
          setFileState({ status: 'ready', content: '' });
        })
        .catch(() => {
          if (cancelled) return;
          setFileState({ status: 'ready', content: '' });
        });
      return () => {
        cancelled = true;
      };
    }
    if (node.contentType === 'snapshot' || node.contentType === 'video' || node.contentType === 'audio') {
      setFileState({ status: 'ready', content: '' });
      return;
    }
    setFileState({ status: 'loading' });
    /* eslint-enable react-hooks/set-state-in-effect */
    readTextFile(node.absPath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'tooLarge') {
            setFileState({ status: 'tooLarge', size: res.size });
            return;
          }
          if (res.error === 'binary') {
            setFileState({ status: 'binary', size: res.size });
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
    hostApi.shell.openPath(workspace).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  }, [workspace, t]);

  const handleOpenSelectedInFinder = useCallback(() => {
    if (!selectedNode || selectedNode.isDir) return;
    hostApi.shell.showItemInFolder(selectedNode.absPath).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  }, [selectedNode, t]);

  const handleOpenSelectedDirectly = useCallback(async () => {
    if (!selectedNode || selectedNode.isDir) return;
    const currentSize =
      fileState.status === 'tooLarge' || fileState.status === 'binary' || fileState.status === 'unsupported'
        ? fileState.size
        : undefined;
    try {
      await confirmAndOpenFile({
        filePath: selectedNode.absPath,
        fileName: selectedNode.name,
        size: currentSize,
        t,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('filePreview.errors.openFailed', { defaultValue: 'Open failed: {{error}}', error: message }));
    }
  }, [selectedNode, fileState, t]);

  const handleOfficeTooLarge = useCallback((size?: number) => {
    if (!selectedNode || selectedNode.isDir) return;
    setFileStatePath(selectedNode.absPath);
    setFileState({ status: 'tooLarge', size });
  }, [selectedNode]);

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
            ? t('filePreview.errors.outsideSandbox', 'Path is outside the workspace; read denied')
            : t('workspace.empty', 'Workspace is empty or inaccessible')}
        </div>
      );
    }
    return (
      <div data-testid="workspace-tree" className="flex h-full min-h-0 flex-col overflow-hidden">
        <div ref={treeContainerRef} className="min-h-0 flex-1">
          <Tree<WorkspaceTreeNode>
            key={treeScope}
            data={state.root.children ?? []}
            idAccessor={(node) => node.relPath}
            childrenAccessor={(node) => node.children ?? null}
            selection={selectedRel ?? undefined}
            initialOpenState={initialOpenState}
            openByDefault={false}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            height={treeHeight}
            width="100%"
            rowHeight={compact ? 24 : 28}
            indent={TREE_INDENT_PX}
            overscanCount={8}
            renderRow={WorkspaceTreeContainerRow}
            onActivate={(node) => {
              if (node.data.isDir) {
                node.toggle();
                return;
              }
              setSelectedRel(node.data.relPath);
            }}
            onToggle={(id) => {
              setOpenRelPathState((prev) => {
                const currentPaths = prev.scope === treeScope ? prev.paths : null;
                const next = new Set(currentPaths ?? collectInitialExpanded(state.root, 1));
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return { scope: treeScope, paths: next };
              });
            }}
          >
            {WorkspaceTreeRow}
          </Tree>
        </div>
        {state.truncated && (
          <div className="shrink-0 px-3 py-2 text-2xs text-muted-foreground/80">
            {t('workspace.truncated', 'Directory too large; truncated to first 5000 nodes')}
          </div>
        )}
      </div>
    );
  };

  const renderBody = () => {
    if (!selectedNode || selectedNode.isDir) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t('workspace.pickFile', 'Select a file on the left to preview')}
        </div>
      );
    }
    if (selectedNode.contentType === 'snapshot') {
      return <ImageViewer filePath={selectedNode.absPath} fileName={selectedNode.name} />;
    }
    if (isPdfPreviewExt(selectedNode.ext)) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <PdfViewerLazy filePath={selectedNode.absPath} fileName={selectedNode.name} surface="workspace" />
        </Suspense>
      );
    }
    if (isSheetPreviewExt(selectedNode.ext)) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <SheetViewerLazy filePath={selectedNode.absPath} fileName={selectedNode.name} />
        </Suspense>
      );
    }
    const displayedFileState: FileState = fileStatePath === selectedNode.absPath
      ? fileState
      : { status: 'loading' };
    if (displayedFileState.status === 'loading' || displayedFileState.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }
    if (displayedFileState.status === 'tooLarge') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, displayedFileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {directOpen
              ? t('filePreview.errors.largeBinaryOpenHint', {
                defaultValue: 'This file is {{size}}. ClawX does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                size: formatFileSize(displayedFileState.size ?? 0) || '> 2MB',
              })
              : t('filePreview.errors.tooLarge', 'File too large; preview disabled')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }
    if (displayedFileState.status === 'binary') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, displayedFileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {directOpen
              ? t('filePreview.errors.largeBinaryOpenHint', {
                defaultValue: 'This file is {{size}}. ClawX does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                size: formatFileSize(displayedFileState.size ?? 0) || '> 2MB',
              })
              : t('filePreview.errors.binary', 'Binary files do not support text preview')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }
    if (displayedFileState.status === 'error') {
      const errMsg = displayedFileState.message;
      const hint = errMsg === 'outsideSandbox'
        ? t('filePreview.errors.outsideSandbox', 'Path is outside the workspace; read denied')
        : errMsg === 'notFound'
          ? t('filePreview.errors.notFound', 'File not found')
          : errMsg;
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
          {hint}
        </div>
      );
    }
    if (displayedFileState.status === 'unsupported') {
      const directOpen = shouldOfferDirectOpenFallback(selectedNode.ext, displayedFileState.size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {directOpen
                ? t('filePreview.errors.largeBinaryOpenTitle', 'This file is too large for inline preview')
                : t('filePreview.errors.unsupportedFormatTitle', 'This file format is not supported for inline preview or diff')}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {directOpen
                ? t('filePreview.errors.largeBinaryOpenHint', {
                  defaultValue: 'This file is {{size}}. ClawX does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                  size: formatFileSize(displayedFileState.size ?? 0) || '> 2MB',
                })
                : t(
                  'filePreview.errors.unsupportedFormatHint',
                  'Only directly readable files such as text and Markdown support inline preview and diff. Please open this file in your file manager.',
                )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenSelectedDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleOpenSelectedInFinder}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>
          </div>
        </div>
      );
    }

    if (isDocxPreviewExt(selectedNode.ext)) {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <DocxViewerLazy
            filePath={selectedNode.absPath}
            fileName={selectedNode.name}
            onTooLarge={handleOfficeTooLarge}
          />
        </Suspense>
      );
    }

    if (isPptxPreviewExt(selectedNode.ext)) {
      const identity = getFilePreviewTargetIdentity({ filePath: selectedNode.absPath });
      // CSS hidden is insufficient: pptxviewjs@1.1.9 shares Renderer-global processor/ZIP state.
      // See harness/reference/office-document-preview.md#single-pptx-instance.
      return active ? (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          }
        >
          <PptxViewerLazy
            filePath={selectedNode.absPath}
            fileName={selectedNode.name}
            initialSlideIndex={pptxSlidePositions.get(identity) ?? 0}
            onSlideIndexChange={(index) => pptxSlidePositions.set(identity, index)}
            onTooLarge={handleOfficeTooLarge}
          />
        </Suspense>
      ) : null;
    }

    if (isHtmlPreviewExt(selectedNode.ext)) {
      return (
        <HtmlPreview
          source={displayedFileState.content}
          filePath={selectedNode.absPath}
          fileName={selectedNode.name}
        />
      );
    }

    if (selectedNode.contentType === 'document') {
      return (
        <div className="h-full overflow-auto">
          <MarkdownPreview source={displayedFileState.content} />
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
        <MonacoViewerLazy filePath={selectedNode.absPath} value={displayedFileState.content} readOnly />
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
        <div className="flex min-w-0 items-center gap-2">
          <h2
            data-testid="workspace-header-title"
            title={headerTitle}
            aria-label={headerTitle}
            className="m-0 flex min-w-0 items-center gap-1.5 overflow-hidden text-sm font-medium"
          >
            <HeaderTag testId="workspace-agent-tag" title={agentDisplayName}>
              <span className="min-w-0 truncate">{agentDisplayName}</span>
            </HeaderTag>
            <WorkspacePathTag
              displayPath={directoryDisplayPath}
              title={workspace || directoryDisplayPath}
            />
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={reload}
            disabled={state.status === 'loading'}
            title={t('workspace.actions.refresh', 'Refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', state.status === 'loading' && 'animate-spin')} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleOpenWorkspaceInFinder}
            title={t('workspace.actions.openRootInFinder', 'Show root folder in file manager')}
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
                <MaterialFileIcon filename={selectedNode.name} className="h-4 w-4" />
                <span className="truncate font-mono">{selectedNode.relPath || selectedNode.name}</span>
                {selectedNode.isFresh && (
                  <Badge variant="default" className="ml-1 text-2xs px-1.5 py-0">
                    {t('workspace.freshBadge', 'Added this run')}
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

function WorkspaceTreeContainerRow<T>({ attrs, innerRef, children }: RowRendererProps<T>) {
  return (
    <div {...attrs} ref={innerRef} onClick={undefined}>
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
          'flex h-full w-full items-center gap-1 rounded-md pr-2 text-left text-xs transition-colors',
          node.isSelected
            ? 'bg-black/5 text-foreground dark:bg-white/10'
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
