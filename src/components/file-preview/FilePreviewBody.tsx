/**
 * Inline file preview body.
 *
 * Renders the icon header (file name / path / save / revert) and a
 * minimal tabbed view for a single file.  Documents (Markdown) render
 * only their `preview` tab; code / other text files render `source`.
 * A `diff` tab is added when the file is editable AND there are
 * AI-applied edits to display.  The metadata `info` tab has been
 * intentionally removed — path / size are visible in the header bar.
 *
 * The `mode` prop narrows the tab set for callers that want a single,
 * fixed view (e.g. the artifact panel's 预览 tab forces `preview`, and
 * the 变更 tab's right pane forces `diff`).
 *
 * Used by:
 *   - `FilePreviewOverlay` for the Skills detail Sheet (read-only).
 *   - `ArtifactPanel`'s ChangesTab and PreviewTab.
 *
 * All sandbox / read-only / large-file / binary edge cases are handled
 * here so callers only pass a `FilePreviewTarget` and a `readOnly` flag.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Save, ShieldAlert, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { invokeIpc, readTextFile, writeTextFile } from '@/lib/api-client';
import type { FilePreviewTarget } from './types';
import { supportsInlineDiff, supportsInlineDocumentPreview } from '@/lib/generated-files';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';
import MarkdownPreview from './MarkdownPreview';
import ImageViewer from './ImageViewer';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));
const MonacoDiffViewerLazy = lazy(() => import('./MonacoDiffViewer'));

/**
 * Tab set for the body.
 *
 *   - 'full'    – default: preview / source / diff as appropriate.
 *   - 'preview' – render-only; hides the diff tab and forces read-only.
 *   - 'diff'    – diff-only; the body collapses to a single diff view
 *                 with no tab strip, save/revert, or source toggle.
 */
export type FilePreviewBodyMode = 'full' | 'preview' | 'diff';

export interface FilePreviewBodyProps {
  file: FilePreviewTarget;
  readOnly?: boolean;
  /** Compact mode reduces padding/font for use inside the side panel. */
  compact?: boolean;
  /** Optional slot rendered to the LEFT of the header info (e.g. back button). */
  leadingHeader?: React.ReactNode;
  /** Optional slot rendered to the RIGHT of the header (extra actions). */
  trailingHeader?: React.ReactNode;
  /** Limit the visible tabs.  Default: 'full'. */
  mode?: FilePreviewBodyMode;
  /** When true, hide the file header (name / path / actions). */
  hideHeader?: boolean;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string; size?: number; readOnly: boolean }
  | { status: 'tooLarge'; size?: number }
  | { status: 'binary' }
  | { status: 'outsideSandbox' }
  | { status: 'error'; message: string };

type Tab = 'source' | 'preview' | 'diff';

function tabsForFile(file: FilePreviewTarget, mode: FilePreviewBodyMode): Tab[] {
  // Diff-only mode short-circuits. Callers (e.g. the 变更 tab's right
  // pane) want a pure git-style diff with no tab strip — but only for
  // formats where inline diff is actually supported.
  if (mode === 'diff') return supportsInlineDiff(file) ? ['diff'] : [];

  const tabs: Tab[] = [];
  if (file.contentType === 'document') {
    if (!supportsInlineDocumentPreview(file.ext)) {
      return [];
    }
    // Markdown / plain-text style documents: rendered preview only.
    tabs.push('preview');
  } else if (file.contentType === 'snapshot') {
    tabs.push('preview');
  } else if (file.contentType === 'video' || file.contentType === 'audio') {
    tabs.push('preview');
  } else if (file.contentType === 'code') {
    tabs.push('source');
  } else {
    tabs.push('source');
  }
  // Diff tab appears in 'full' mode whenever we captured a Write/Edit
  // payload — read-only is fine, the diff is informational only.
  if (
    mode === 'full' &&
    supportsInlineDiff(file) &&
    (file.fullContent != null || (file.edits != null && file.edits.length > 0))
  ) {
    tabs.push('diff');
  }
  return tabs;
}

function pickInitialTab(tabs: Tab[], file: FilePreviewTarget): Tab {
  if (file.contentType === 'document' && tabs.includes('preview')) return 'preview';
  // For changes view (edited code), prefer the diff tab if present so
  // the user sees the change immediately on click.
  if (tabs.includes('diff') && file.contentType !== 'document') return 'diff';
  return tabs[0] ?? 'source';
}

function normaliseEol(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

type DiffPair = {
  /** Left pane.  `null` makes Monaco render the side as empty (new-file). */
  oldContent: string | null;
  /** Right pane. */
  newContent: string;
  /**
   * - `whole`       – right pane is the full file (Write tool).
   * - `snippet`     – left/right are the joined Edit op old/new strings.
   * - `unavailable` – the chat captured no payload to diff against.
   */
  kind: 'whole' | 'snippet' | 'unavailable';
};

/** Visual separator between MultiEdit hunks. */
const SNIPPET_SEPARATOR = '\n\n';

/**
 * Build a diff pair purely from the captured tool payload — never reads
 * disk. Edit tools show the exact old → new snippet swap. Write-family
 * tools prefer the captured baseline when available, so modified files
 * render a true before/after diff instead of a misleading all-green view.
 */
function computeDiffPair(file: FilePreviewTarget): DiffPair {
  // Edit / StrReplace / MultiEdit — show the snippet swap directly.
  if (file.edits && file.edits.length > 0) {
    const lefts = file.edits.map((op) => normaliseEol(op.old ?? ''));
    const rights = file.edits.map((op) => normaliseEol(op.new ?? ''));
    const left = lefts.join(SNIPPET_SEPARATOR);
    const right = rights.join(SNIPPET_SEPARATOR);
    if (left || right) {
      return { oldContent: left, newContent: right, kind: 'snippet' };
    }
  }

  if (file.fullContent != null) {
    if (file.baseline?.status === 'ok') {
      return {
        oldContent: normaliseEol(file.baseline.content),
        newContent: normaliseEol(file.fullContent),
        kind: 'whole',
      };
    }
    if (file.baseline?.status === 'missing') {
      return { oldContent: null, newContent: normaliseEol(file.fullContent), kind: 'whole' };
    }
    if (file.baseline?.status === 'unavailable') {
      return { oldContent: null, newContent: '', kind: 'unavailable' };
    }
    if (file.action === 'created') {
      return { oldContent: null, newContent: normaliseEol(file.fullContent), kind: 'whole' };
    }
    return { oldContent: null, newContent: '', kind: 'unavailable' };
  }

  return { oldContent: null, newContent: '', kind: 'unavailable' };
}

export function FilePreviewBody({
  file,
  readOnly = false,
  compact = false,
  leadingHeader,
  trailingHeader,
  mode = 'full',
  hideHeader = false,
}: FilePreviewBodyProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('source');
  const [size, setSize] = useState<number | undefined>(undefined);

  // Preview / diff modes are read-only by definition — those views are
  // for inspecting content, not editing it.
  const enforcedReadOnly = readOnly || mode === 'preview' || mode === 'diff';
  const tabs = useMemo(() => tabsForFile(file, mode), [file, mode]);
  const unsupportedPreviewFormat = file.contentType === 'document' && !supportsInlineDocumentPreview(file.ext);
  const unsupportedDiffFormat = mode === 'diff' && !supportsInlineDiff(file);

  useEffect(() => {
    setTab(pickInitialTab(tabs, file));

    // Diff-only mode renders entirely from the captured tool payload —
    // no disk read needed, so we can mark the body "ready" immediately.
    if (mode === 'diff') {
      setState({ status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      return;
    }

    if (unsupportedPreviewFormat) {
      setState({ status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      return;
    }

    if (file.contentType === 'snapshot' || file.contentType === 'video' || file.contentType === 'audio') {
      setState({ status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    readTextFile(file.filePath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'tooLarge') {
            setState({ status: 'tooLarge', size: res.size });
            return;
          }
          if (res.error === 'binary') {
            setState({ status: 'binary' });
            return;
          }
          if (res.error === 'outsideSandbox') {
            setState({ status: 'outsideSandbox' });
            return;
          }
          setState({ status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        setState({
          status: 'ready',
          content: res.content ?? '',
          size: res.size,
          readOnly: enforcedReadOnly || !!res.readOnly,
        });
        setDraft(res.content ?? '');
        setSize(res.size);
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [file, enforcedReadOnly, mode, tabs, unsupportedPreviewFormat]);

  const effectiveReadOnly = state.status === 'ready' ? state.readOnly : true;
  const dirty =
    state.status === 'ready' && !state.readOnly && draft != null && draft !== state.content;

  const handleSave = useCallback(async () => {
    if (!dirty || draft == null) return;
    setSaving(true);
    try {
      const res = await writeTextFile(file.filePath, draft);
      if (!res.ok) throw new Error(res.error ?? 'unknown');
      setState({ status: 'ready', content: draft, size, readOnly: false });
      toast.success(t('filePreview.toast.saved', '已保存到磁盘'));
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      const localized =
        code === 'outsideSandbox'
          ? t('filePreview.errors.outsideSandbox', '路径越界，已拒绝写入')
          : code === 'readOnlyRoot'
            ? t('filePreview.errors.readOnlyRoot', '该文件位于只读位置（如内置技能），无法修改')
            : t('filePreview.toast.saveFailed', { defaultValue: '保存失败：{{error}}', error: code });
      toast.error(localized);
    } finally {
      setSaving(false);
    }
  }, [file, dirty, draft, size, t]);

  const handleRevert = useCallback(() => {
    if (state.status !== 'ready') return;
    setDraft(state.content);
  }, [state]);

  const handleOpenInFinder = useCallback(() => {
    invokeIpc('shell:showItemInFolder', file.filePath).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', '无法在 Finder 中显示'));
    });
  }, [file, t]);

  const renderUnsupportedFormat = () => (
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
      <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
        <FolderOpen className="mr-2 h-4 w-4" />
        {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
      </Button>
    </div>
  );

  const renderBody = () => {
    if (unsupportedPreviewFormat || unsupportedDiffFormat) {
      return renderUnsupportedFormat();
    }
    if (state.status === 'loading' || state.status === 'idle') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }
    if (state.status === 'tooLarge') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {t('filePreview.errors.tooLarge', {
              defaultValue: '文件过大（{{size}}），已禁用预览',
              size: formatFileSize(state.size ?? 0) || '> 2MB',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }
    if (state.status === 'binary') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{t('filePreview.errors.binary', '二进制文件不支持文本预览')}</p>
          <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }
    if (state.status === 'outsideSandbox') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">
              {t('filePreview.errors.outsideSandboxTitle', '此文件位于沙盒外')}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {t(
                'filePreview.errors.outsideSandboxHint',
                '出于安全考虑，ClawX 仅允许预览 ~/.openclaw、应用资源以及内置技能目录中的文件。可在 Finder 中查看。',
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }
    if (state.status === 'error') {
      const errMsg = state.message;
      const hint =
        errMsg === 'notFound'
          ? t('filePreview.errors.notFound', '文件不存在')
          : t('filePreview.errors.loadFailed', { defaultValue: '加载失败：{{error}}', error: errMsg });
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{hint}</p>
          <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', '在 Finder 中显示')}
          </Button>
        </div>
      );
    }

    return (
      <Tabs value={tab} onValueChange={(next) => setTab(next as Tab)} className="flex h-full flex-col">
        {/* Hide the tab strip when there's only one tab — keeps the UI
            quiet for the common case (just preview / just source). */}
        {tabs.length > 1 && (
          <TabsList className="m-3 self-start">
            {tabs.map((id) => (
              <TabsTrigger key={id} value={id}>
                {id === 'source' && t('filePreview.tabs.source', '源码')}
                {id === 'preview' && t('filePreview.tabs.preview', '预览')}
                {id === 'diff' && t('filePreview.tabs.changes', '变更')}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        <div
          className={cn(
            'min-h-0 flex-1',
            tabs.length > 1 && 'border-t border-black/5 dark:border-white/10',
          )}
        >
          {tabs.includes('source') && (
            <TabsContent value="source" className="m-0 h-full">
              {file.contentType === 'snapshot' ? (
                <ImageViewer filePath={file.filePath} fileName={file.fileName} />
              ) : (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <LoadingSpinner />
                    </div>
                  }
                >
                  <MonacoViewerLazy
                    filePath={file.filePath}
                    value={draft ?? ''}
                    readOnly={effectiveReadOnly}
                    onChange={effectiveReadOnly ? undefined : (next) => setDraft(next)}
                  />
                </Suspense>
              )}
            </TabsContent>
          )}
          {tabs.includes('preview') && (
            <TabsContent value="preview" className="m-0 h-full overflow-auto">
              {file.contentType === 'snapshot' ? (
                <ImageViewer filePath={file.filePath} fileName={file.fileName} />
              ) : file.contentType === 'document' ? (
                <MarkdownPreview source={draft ?? state.content} />
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  {t('filePreview.errors.noPreview', '该文件没有预览')}
                </div>
              )}
            </TabsContent>
          )}
          {tabs.includes('diff') && (
            <TabsContent value="diff" className="m-0 h-full">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <LoadingSpinner />
                  </div>
                }
              >
                {(() => {
                  const pair = computeDiffPair(file);
                  if (pair.kind === 'unavailable') {
                    return (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                        <p className="max-w-md text-sm text-muted-foreground">
                          {t(
                            'filePreview.diff.unavailable',
                            '本会话没有抓到这个文件的精确变更基线，无法生成 diff。',
                          )}
                        </p>
                        <p className="max-w-md text-2xs text-muted-foreground/90">
                          {t(
                            'filePreview.diff.unavailableHint',
                            '可点击顶部「预览」查看当前文件内容；若需精确差异，请在 Git 等工具中对比版本。',
                          )}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <MonacoDiffViewerLazy
                      filePath={file.filePath}
                      original={pair.oldContent}
                      modified={pair.newContent}
                    />
                  );
                })()}
              </Suspense>
            </TabsContent>
          )}
        </div>
      </Tabs>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideHeader && (
      <header
        className={
          compact
            ? 'flex items-center justify-between gap-3 border-b border-black/5 px-4 py-2 dark:border-white/10'
            : 'flex items-center justify-between gap-3 border-b border-black/5 px-5 py-3 dark:border-white/10'
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          {leadingHeader}
          <FilePreviewIcon
            contentType={file.contentType}
            mimeType={file.mimeType}
            ext={file.ext}
            className="h-5 w-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{file.fileName}</h2>
            <p className="truncate text-2xs text-muted-foreground">{file.filePath}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!effectiveReadOnly && state.status === 'ready' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleRevert} disabled={!dirty || saving}>
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                {t('filePreview.actions.revert', '撤销')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? t('filePreview.actions.saving', '保存中...') : t('filePreview.actions.save', '保存')}
              </Button>
            </>
          )}
          {trailingHeader}
        </div>
      </header>
      )}
      <div className="min-h-0 flex-1">{renderBody()}</div>
    </div>
  );
}

export default FilePreviewBody;
