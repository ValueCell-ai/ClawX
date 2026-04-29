/**
 * Inline file preview body.
 *
 * Renders the icon header (file name / path / save / revert) and a tabbed
 * source / preview / diff / info view for a single file.  Used by:
 *
 *   - `FilePreviewOverlay` for the Skills detail Sheet (read-only).
 *   - `ArtifactPanel`'s ChangesTab in detail view (editable).
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
import { invokeIpc, readTextFile, writeTextFile } from '@/lib/api-client';
import type { FilePreviewTarget } from './types';
import { FilePreviewIcon } from './file-card-utils';
import { formatFileSize } from './format';
import MarkdownPreview from './MarkdownPreview';
import ImageViewer from './ImageViewer';

const MonacoViewerLazy = lazy(() => import('./MonacoViewer'));
const SplitDiffViewerLazy = lazy(() => import('./SplitDiffViewer'));

export interface FilePreviewBodyProps {
  file: FilePreviewTarget;
  readOnly?: boolean;
  /** Compact mode reduces padding/font for use inside the side panel. */
  compact?: boolean;
  /** Optional slot rendered to the LEFT of the header info (e.g. back button). */
  leadingHeader?: React.ReactNode;
  /** Optional slot rendered to the RIGHT of the header (extra actions). */
  trailingHeader?: React.ReactNode;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content: string; size?: number; readOnly: boolean }
  | { status: 'tooLarge'; size?: number }
  | { status: 'binary' }
  | { status: 'outsideSandbox' }
  | { status: 'error'; message: string };

type Tab = 'source' | 'preview' | 'diff' | 'info';

function tabsForFile(file: FilePreviewTarget, readOnly: boolean): Tab[] {
  const tabs: Tab[] = [];
  if (file.contentType === 'document') {
    tabs.push('source', 'preview');
  } else if (file.contentType === 'snapshot') {
    tabs.push('preview');
  } else if (file.contentType === 'video' || file.contentType === 'audio') {
    tabs.push('preview');
  } else if (file.contentType === 'code') {
    tabs.push('source');
  } else {
    tabs.push('source');
  }
  if (!readOnly && (file.fullContent != null || (file.edits != null && file.edits.length > 0))) {
    tabs.push('diff');
  }
  tabs.push('info');
  return tabs;
}

function pickInitialTab(tabs: Tab[], file: FilePreviewTarget): Tab {
  if (file.contentType === 'document' && tabs.includes('preview')) return 'preview';
  // For changes view (edited code without document tab), prefer the diff
  // tab if present so the user sees the change immediately on click.
  if (tabs.includes('diff') && file.contentType !== 'document') return 'diff';
  return tabs[0];
}

function normaliseEol(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

function computeDiffPair(
  file: FilePreviewTarget,
  diskContent: string,
): { oldContent: string | null; newContent: string } {
  const diskLF = normaliseEol(diskContent);
  if (file.fullContent != null) {
    return { oldContent: null, newContent: normaliseEol(file.fullContent) };
  }
  if (file.edits && file.edits.length > 0) {
    let reconstructed = diskLF;
    for (let i = file.edits.length - 1; i >= 0; i -= 1) {
      const op = file.edits[i];
      const oldLF = normaliseEol(op.old);
      const newLF = normaliseEol(op.new);
      if (!newLF) continue;
      const idx = reconstructed.indexOf(newLF);
      if (idx < 0) {
        return { oldContent: diskLF, newContent: diskLF };
      }
      reconstructed = reconstructed.slice(0, idx) + oldLF + reconstructed.slice(idx + newLF.length);
    }
    return { oldContent: reconstructed, newContent: diskLF };
  }
  return { oldContent: diskLF, newContent: diskLF };
}

export function FilePreviewBody({
  file,
  readOnly = false,
  compact = false,
  leadingHeader,
  trailingHeader,
}: FilePreviewBodyProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('source');
  const [size, setSize] = useState<number | undefined>(undefined);

  const tabs = useMemo(() => tabsForFile(file, readOnly), [file, readOnly]);

  useEffect(() => {
    setTab(pickInitialTab(tabs, file));

    if (file.contentType === 'snapshot' || file.contentType === 'video' || file.contentType === 'audio') {
      setState({ status: 'ready', content: '', readOnly });
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
          readOnly: readOnly || !!res.readOnly,
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
  }, [file, readOnly, tabs]);

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

  const renderBody = () => {
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
        <TabsList className="m-3 self-start">
          {tabs.map((id) => (
            <TabsTrigger key={id} value={id}>
              {id === 'source' && t('filePreview.tabs.source', '源码')}
              {id === 'preview' && t('filePreview.tabs.preview', '预览')}
              {id === 'diff' && t('filePreview.tabs.changes', '变更')}
              {id === 'info' && t('filePreview.tabs.info', '信息')}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="min-h-0 flex-1 border-t border-black/5 dark:border-white/10">
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
                  const { oldContent, newContent } = computeDiffPair(file, state.content);
                  return (
                    <SplitDiffViewerLazy
                      filePath={file.filePath}
                      fileName={file.fileName}
                      original={oldContent}
                      modified={newContent}
                    />
                  );
                })()}
              </Suspense>
            </TabsContent>
          )}
          {tabs.includes('info') && (
            <TabsContent value="info" className="m-0 h-full overflow-auto p-6">
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-xs">
                <dt className="text-muted-foreground">{t('filePreview.info.path', '路径')}</dt>
                <dd className="break-all font-mono">{file.filePath}</dd>
                <dt className="text-muted-foreground">{t('filePreview.info.size', '大小')}</dt>
                <dd>{formatFileSize(state.size ?? size ?? 0) || '—'}</dd>
                <dt className="text-muted-foreground">{t('filePreview.info.type', '类型')}</dt>
                <dd>{file.mimeType || file.ext || file.contentType}</dd>
              </dl>
            </TabsContent>
          )}
        </div>
      </Tabs>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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
      <div className="min-h-0 flex-1">{renderBody()}</div>
    </div>
  );
}

export default FilePreviewBody;
