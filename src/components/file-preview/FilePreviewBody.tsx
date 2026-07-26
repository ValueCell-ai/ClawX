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
 * fixed view (e.g. the artifact panel's preview tab forces `preview`, and
 * the changes tab's right pane forces `diff`).
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
import {
  readTextFile,
  readAttachmentText,
  readWorkspaceText,
  statFile,
  statWorkspaceFile,
  writeTextFile,
} from '@/lib/file-preview-client';
import { getFilePreviewTargetIdentity, type FilePreviewTarget } from './types';
import { previewDisplayPath } from './build-preview-target';
import {
  isHtmlPreviewExt,
  supportsInlineDiff,
} from '@/lib/generated-files';
import {
  filePreviewKind,
  isFilePreviewWithinSizeLimit,
  richFilePreviewKind,
} from '@/lib/file-preview-capabilities';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';
import {
  confirmAndOpenFile,
  revealFile,
  shouldOfferDirectOpenFallback,
} from './open-file-utils';
import MarkdownPreview from './MarkdownPreview';
import HtmlPreview from './HtmlPreview';
import ImageViewer from './ImageViewer';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));
const MonacoDiffViewerLazy = lazy(() => import('./MonacoDiffViewer'));
const PdfViewerLazy = lazy(() => import('./PdfViewer'));
const SheetViewerLazy = lazy(() => import('./SheetViewer'));
const DocxViewerLazy = lazy(() => import('./DocxViewer'));
const PptxViewerLazy = lazy(() => import('./PptxViewer'));

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
  /** Whether this preview surface is visible and may own the PPTX parser. */
  active?: boolean;
  initialPptxSlideIndex?: number;
  onPptxSlideIndexChange?: (index: number) => void;
}

type LoadState =
  | { identity: string; status: 'loading' }
  | { identity: string; status: 'ready'; content: string; size?: number; readOnly: boolean }
  | { identity: string; status: 'tooLarge'; size?: number }
  | { identity: string; status: 'binary' }
  | { identity: string; status: 'outsideSandbox' }
  | { identity: string; status: 'error'; message: string };

type Tab = 'source' | 'preview' | 'diff';

function tabsForFile(file: FilePreviewTarget, mode: FilePreviewBodyMode): Tab[] {
  // Diff-only mode short-circuits. Callers (e.g. the changes tab's right
  // pane) want a pure git-style diff with no tab strip — but only for
  // formats where inline diff is actually supported.
  if (mode === 'diff') return supportsInlineDiff(file) ? ['diff'] : [];

  const previewKind = filePreviewKind(file);
  if (!previewKind) return [];
  const richPreview = richFilePreviewKind(file);
  const tabs: Tab[] = [];
  if (richPreview) {
    tabs.push('preview');
  } else if (file.contentType === 'document') {
    // Markdown / HTML / rich documents: rendered preview first.
    tabs.push('preview');
    if (isHtmlPreviewExt(file.ext)) {
      tabs.push('source');
    }
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
  active = true,
  initialPptxSlideIndex,
  onPptxSlideIndexChange,
}: FilePreviewBodyProps) {
  const { t } = useTranslation('chat');
  const loadIdentity = getFilePreviewTargetIdentity(file);
  const [storedState, setState] = useState<LoadState>({ identity: loadIdentity, status: 'loading' });
  const state: LoadState = storedState.identity === loadIdentity
    ? storedState
    : { identity: loadIdentity, status: 'loading' };
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('source');
  const [size, setSize] = useState<number | undefined>(file.size);

  // Preview / diff modes are read-only by definition — those views are
  // for inspecting content, not editing it.
  const enforcedReadOnly = readOnly || !!file.attachmentFileRef || !!file.workspaceFileRef || mode === 'preview' || mode === 'diff';
  const tabs = useMemo(() => tabsForFile(file, mode), [file, mode]);
  const unsupportedPreviewFormat = mode !== 'diff' && filePreviewKind(file) == null;
  const unsupportedDiffFormat = mode === 'diff' && !supportsInlineDiff(file);
  const richPreview = richFilePreviewKind(file);
  // Binary document previews own their own loading
  // pipeline — we must not pipe them through `readTextFile` (which would
  // reject them as binary) and the diff tab is intentionally hidden.
  const isRichDocumentPreview = richPreview === 'pdf'
    || richPreview === 'sheet'
    || richPreview === 'docx'
    || richPreview === 'pptx';
  const richPreviewLimitTarget = useMemo(() => (
    isRichDocumentPreview && richPreview
      ? { kind: 'rich' as const, richKind: richPreview }
      : null
  ), [isRichDocumentPreview, richPreview]);
  const handleOfficeTooLarge = useCallback((nextSize?: number) => {
    setSize(nextSize);
    setState({ identity: loadIdentity, status: 'tooLarge', size: nextSize });
  }, [loadIdentity]);

  useEffect(() => {
    let cancelled = false;
    setTab(pickInitialTab(tabs, file));
    setSize(file.size);

    // Diff-only mode renders entirely from the captured tool payload —
    // no disk read needed, so we can mark the body "ready" immediately.
    if (mode === 'diff') {
      setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      return () => {
        cancelled = true;
      };
    }

    if (unsupportedPreviewFormat) {
      setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      if (file.attachmentFileRef) {
        return () => {
          cancelled = true;
        };
      }
      void (file.workspaceFileRef
        ? statWorkspaceFile(file.workspaceFileRef)
        : statFile(file.filePath))
        .then((res) => {
          if (cancelled || !res.ok) return;
          setSize(res.size);
        })
        .catch(() => {
          // Ignore stat failures — unsupported preview still renders.
        });
      return () => {
        cancelled = true;
      };
    }

    if (isRichDocumentPreview) {
      // Binary rich viewers load bytes themselves through their authorized
      // Host API route; the body just needs to hand off control. For files
      // beyond the inline-preview ceiling we keep the existing
      // "direct open" fallback so users still have a way out.
      if (
        richPreviewLimitTarget
        && typeof file.size === 'number'
        && !isFilePreviewWithinSizeLimit(richPreviewLimitTarget, file.size)
      ) {
        setSize(file.size);
        setState({ identity: loadIdentity, status: 'tooLarge', size: file.size });
        setDraft(null);
        return () => {
          cancelled = true;
        };
      }
      setState({ identity: loadIdentity, status: 'loading' });
      setDraft(null);
      if (file.attachmentFileRef) {
        setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: true });
        return () => {
          cancelled = true;
        };
      }
      void (file.workspaceFileRef
        ? statWorkspaceFile(file.workspaceFileRef)
        : statFile(file.filePath))
        .then((res) => {
          if (cancelled) return;
          if (
            res.ok
            && richPreviewLimitTarget
            && typeof res.size === 'number'
            && !isFilePreviewWithinSizeLimit(richPreviewLimitTarget, res.size)
          ) {
            setSize(res.size);
            setState({ identity: loadIdentity, status: 'tooLarge', size: res.size });
            return;
          }
          if (res.ok) setSize(res.size);
          setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: enforcedReadOnly });
        })
        .catch(() => {
          if (cancelled) return;
          setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: enforcedReadOnly });
        });
      return () => {
        cancelled = true;
      };
    }

    if (richPreview === 'image' || file.contentType === 'video' || file.contentType === 'audio') {
      setState({ identity: loadIdentity, status: 'ready', content: '', readOnly: enforcedReadOnly });
      setDraft(null);
      return () => {
        cancelled = true;
      };
    }

    setState({ identity: loadIdentity, status: 'loading' });
    (file.attachmentFileRef
      ? readAttachmentText(file.attachmentFileRef)
      : file.workspaceFileRef
      ? readWorkspaceText(file.workspaceFileRef)
      : readTextFile(file.filePath))
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.error === 'tooLarge') {
            setState({ identity: loadIdentity, status: 'tooLarge', size: res.size });
            return;
          }
          if (res.error === 'binary') {
            setState({ identity: loadIdentity, status: 'binary' });
            return;
          }
          if (res.error === 'outsideSandbox') {
            setState({ identity: loadIdentity, status: 'outsideSandbox' });
            return;
          }
          setState({ identity: loadIdentity, status: 'error', message: String(res.error ?? 'unknown') });
          return;
        }
        setState({
          identity: loadIdentity,
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
        setState({
          identity: loadIdentity,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [file, loadIdentity, enforcedReadOnly, mode, tabs, unsupportedPreviewFormat, isRichDocumentPreview, richPreview, richPreviewLimitTarget]);

  const effectiveReadOnly = state.status === 'ready' ? state.readOnly : true;
  const allowSystemActions = !file.attachmentFileRef && !file.workspaceFileRef;
  const dirty =
    state.status === 'ready' && !state.readOnly && draft != null && draft !== state.content;

  const handleSave = useCallback(async () => {
    if (!dirty || draft == null) return;
    setSaving(true);
    try {
      const res = await writeTextFile(file.filePath, draft);
      if (!res.ok) throw new Error(res.error ?? 'unknown');
      setState({ identity: loadIdentity, status: 'ready', content: draft, size, readOnly: false });
      toast.success(t('filePreview.toast.saved', 'Saved to disk'));
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      const localized =
        code === 'outsideSandbox'
          ? t('filePreview.errors.outsideSandbox', 'Path is outside the workspace; write denied')
          : code === 'readOnlyRoot'
            ? t('filePreview.errors.readOnlyRoot', 'This file is in a read-only location (such as a built-in skill) and cannot be edited')
            : t('filePreview.toast.saveFailed', { defaultValue: 'Save failed: {{error}}', error: code });
      toast.error(localized);
    } finally {
      setSaving(false);
    }
  }, [file, loadIdentity, dirty, draft, size, t]);

  const handleRevert = useCallback(() => {
    if (storedState.identity !== loadIdentity || storedState.status !== 'ready') return;
    setDraft(storedState.content);
  }, [storedState, loadIdentity]);

  const handleOpenInFinder = useCallback(() => {
    revealFile(file).catch(() => {
      toast.error(t('filePreview.errors.openInFinderFailed', 'Could not reveal in file manager'));
    });
  }, [file, t]);

  const handleOpenDirectly = useCallback(async () => {
    try {
      await confirmAndOpenFile({
        filePath: file.filePath,
        fileName: file.fileName,
        size,
        t,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('filePreview.errors.openFailed', { defaultValue: 'Open failed: {{error}}', error: message }));
    }
  }, [file, size, t]);

  const renderUnsupportedFormat = () => {
    const directOpen = allowSystemActions && shouldOfferDirectOpenFallback(file.ext, size);
    return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          {directOpen
            ? t('filePreview.errors.largeBinaryOpenTitle', 'This file is too large for inline preview')
            : t('filePreview.errors.unsupportedFormatTitle', 'This file format is not supported for inline preview or diff')}
        </p>
        {allowSystemActions && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {directOpen
            ? t('filePreview.errors.largeBinaryOpenHint', {
              defaultValue: 'This file is {{size}}. ClawX does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
              size: formatFileSize(size ?? 0) || '> 2MB',
            })
            : t(
              'filePreview.errors.unsupportedFormatHint',
              'Only directly readable files such as text and Markdown support inline preview and diff. Please open this file in your file manager.',
            )}
        </p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {directOpen && (
          <Button size="sm" onClick={handleOpenDirectly}>
            {t('filePreview.actions.openDirectly', 'Open directly')}
          </Button>
        )}
        {allowSystemActions && <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
          <FolderOpen className="mr-2 h-4 w-4" />
          {t('filePreview.actions.openInFinder', 'Show in file manager')}
        </Button>}
      </div>
    </div>
  );
  };

  const renderBody = () => {
    if (unsupportedPreviewFormat || unsupportedDiffFormat) {
      return renderUnsupportedFormat();
    }
    if (state.status === 'loading') {
      return (
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner />
        </div>
      );
    }
    if (state.status === 'tooLarge') {
      const directOpen = allowSystemActions && shouldOfferDirectOpenFallback(file.ext, state.size ?? size);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>
            {directOpen
              ? t('filePreview.errors.largeBinaryOpenHint', {
                defaultValue: 'This file is {{size}}. ClawX does not provide an inline preview for it. You can confirm to open it directly in your system default app.',
                size: formatFileSize(state.size ?? size ?? 0) || '> 2MB',
              })
              : t('filePreview.errors.tooLarge', {
                defaultValue: 'File is too large ({{size}}); preview disabled',
                size: formatFileSize(state.size ?? 0) || '> 2MB',
              })}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {directOpen && (
              <Button size="sm" onClick={handleOpenDirectly}>
                {t('filePreview.actions.openDirectly', 'Open directly')}
              </Button>
            )}
            {allowSystemActions && <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('filePreview.actions.openInFinder', 'Show in file manager')}
            </Button>}
          </div>
        </div>
      );
    }
    if (state.status === 'binary') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{t('filePreview.errors.binary', 'Binary files do not support text preview')}</p>
          {allowSystemActions && <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', 'Show in file manager')}
          </Button>}
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
              {t('filePreview.errors.outsideSandboxTitle', 'Unable to read this file')}
            </p>
            {allowSystemActions && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              {t(
                'filePreview.errors.outsideSandboxHint',
                'ClawX cannot read this path. The file may have been moved, deleted, or may not be accessible to the current account. You can inspect it in your file manager.',
              )}
            </p>}
          </div>
          {allowSystemActions && <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', 'Show in file manager')}
          </Button>}
        </div>
      );
    }
    if (state.status === 'error') {
      const errMsg = state.message;
      const hint =
        errMsg === 'notFound'
          ? t('filePreview.errors.notFound', 'File not found')
          : t('filePreview.errors.loadFailed', { defaultValue: 'Load failed: {{error}}', error: errMsg });
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <p>{hint}</p>
          {allowSystemActions && <Button variant="outline" size="sm" onClick={handleOpenInFinder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('filePreview.actions.openInFinder', 'Show in file manager')}
          </Button>}
        </div>
      );
    }

    return (
      <div className="h-full min-h-0">
          {tabs.includes('source') && (
            <TabsContent value="source" className="m-0 h-full">
              {richPreview === 'image' ? (
                <ImageViewer
                  filePath={file.filePath}
                  fileName={file.fileName}
                  attachmentFileRef={file.attachmentFileRef}
                  workspaceFileRef={file.workspaceFileRef}
                />
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
              {richPreview === 'image' ? (
                <ImageViewer
                  filePath={file.filePath}
                  fileName={file.fileName}
                  attachmentFileRef={file.attachmentFileRef}
                  workspaceFileRef={file.workspaceFileRef}
                />
              ) : richPreview === 'pdf' ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <LoadingSpinner />
                    </div>
                  }
                >
                  <PdfViewerLazy
                    filePath={file.filePath}
                    fileName={file.fileName}
                    attachmentFileRef={file.attachmentFileRef}
                    workspaceFileRef={file.workspaceFileRef}
                  />
                </Suspense>
              ) : richPreview === 'sheet' ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <LoadingSpinner />
                    </div>
                  }
                >
                  <SheetViewerLazy
                    filePath={file.filePath}
                    fileName={file.fileName}
                    attachmentFileRef={file.attachmentFileRef}
                    workspaceFileRef={file.workspaceFileRef}
                  />
                </Suspense>
              ) : richPreview === 'docx' ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <LoadingSpinner />
                    </div>
                  }
                >
                  <DocxViewerLazy
                    filePath={file.filePath}
                    fileName={file.fileName}
                    attachmentFileRef={file.attachmentFileRef}
                    workspaceFileRef={file.workspaceFileRef}
                    onTooLarge={handleOfficeTooLarge}
                  />
                </Suspense>
              ) : richPreview === 'pptx' ? (
                // CSS hidden is insufficient: pptxviewjs@1.1.9 shares Renderer-global processor/ZIP state.
                // See harness/reference/office-document-preview.md#single-pptx-instance.
                active ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <LoadingSpinner />
                      </div>
                    }
                  >
                    <PptxViewerLazy
                      filePath={file.filePath}
                      fileName={file.fileName}
                      attachmentFileRef={file.attachmentFileRef}
                      workspaceFileRef={file.workspaceFileRef}
                      onTooLarge={handleOfficeTooLarge}
                      initialSlideIndex={initialPptxSlideIndex}
                      onSlideIndexChange={onPptxSlideIndexChange}
                    />
                  </Suspense>
                ) : null
              ) : file.contentType === 'document' ? (
                isHtmlPreviewExt(file.ext) ? (
                  <HtmlPreview
                    source={draft ?? state.content}
                    filePath={file.filePath}
                    fileName={file.fileName}
                    attachmentFileRef={file.attachmentFileRef}
                    workspaceFileRef={file.workspaceFileRef}
                  />
                ) : (
                  <MarkdownPreview source={draft ?? state.content} />
                )
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  {t('filePreview.errors.noPreview', 'No preview available for this file')}
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
                            'This session did not capture an exact baseline for this file, so a diff cannot be generated.',
                          )}
                        </p>
                        <p className="max-w-md text-2xs text-muted-foreground/90">
                          {t(
                            'filePreview.diff.unavailableHint',
                            'Use the Preview tab above to view the current file contents. For an exact diff, compare versions in Git or another external tool.',
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
    );
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => setTab(next as Tab)}
      className="flex h-full min-h-0 flex-col"
    >
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
            <p className="truncate text-2xs text-muted-foreground" title={previewDisplayPath(file)}>{previewDisplayPath(file)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state.status === 'ready' && tabs.length > 1 && (
            <TabsList className="h-8 shrink-0" data-testid="file-preview-view-tabs">
              {tabs.map((id) => (
                <TabsTrigger key={id} value={id} className="px-2.5 py-1 text-xs">
                  {id === 'source' && t('filePreview.tabs.source', 'Source')}
                  {id === 'preview' && t('filePreview.tabs.preview', 'Preview')}
                  {id === 'diff' && t('filePreview.tabs.changes', 'Changes')}
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          {!effectiveReadOnly && state.status === 'ready' && (
            <>
              <Button variant="ghost" size="sm" onClick={handleRevert} disabled={!dirty || saving}>
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                {t('filePreview.actions.revert', 'Revert')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? t('filePreview.actions.saving', 'Saving...') : t('filePreview.actions.save', 'Save')}
              </Button>
            </>
          )}
          {trailingHeader}
        </div>
      </header>
      )}
      <div className="min-h-0 flex-1">{renderBody()}</div>
    </Tabs>
  );
}

export default FilePreviewBody;
