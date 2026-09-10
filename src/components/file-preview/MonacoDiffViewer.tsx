/**
 * Monaco split diff editor (VS Code–style).  Replaces the custom table-based
 * `SplitDiffViewer`: same Monaco bundle as `MonacoViewer`, with syntax
 * highlighting, scroll sync, and virtualisation for large files.
 */
import { useMemo } from 'react';
import { DiffEditor, languageForPath } from '@/lib/monaco/loader';
import { useResolvedTheme } from '@/lib/use-resolved-theme';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';

export interface MonacoDiffViewerProps {
  filePath: string;
  /** Left pane; `null`/`undefined` treated as empty (e.g. new file → all additions). */
  original: string | null | undefined;
  modified: string;
  className?: string;
}

function diffModelPath(filePath: string, side: 'orig' | 'mod'): string {
  const key = encodeURIComponent(filePath.replace(/\\/g, '/'));
  return `inmemory://clawx-diff/${side}/${key}`;
}

export default function MonacoDiffViewer({
  filePath,
  original,
  modified,
  className,
}: MonacoDiffViewerProps) {
  const resolvedTheme = useResolvedTheme();
  const language = useMemo(() => languageForPath(filePath), [filePath]);
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs';
  const originalPath = useMemo(() => diffModelPath(filePath, 'orig'), [filePath]);
  const modifiedPath = useMemo(() => diffModelPath(filePath, 'mod'), [filePath]);
  const left = original ?? '';

  return (
    <div
      data-testid="monaco-diff-viewer"
      className={cn('clawx-diff-editor h-full w-full min-h-0', className)}
    >
      <DiffEditor
        height="100%"
        language={language}
        original={left}
        modified={modified}
        originalModelPath={originalPath}
        modifiedModelPath={modifiedPath}
        theme={monacoTheme}
        loading={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
        options={{
          readOnly: true,
          domReadOnly: true,
          originalEditable: false,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: false,
          renderIndicators: true,
          renderOverviewRuler: true,
          renderMarginRevertIcon: false,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          wordWrap: 'on',
          diffWordWrap: 'on',
          automaticLayout: true,
          guides: { indentation: false },
          stickyScroll: { enabled: false },
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
