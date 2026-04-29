/**
 * Monaco-backed side-by-side diff for AI-generated file edits.
 *
 * Falls back to a placeholder when no `original` content is available
 * (i.e. a brand-new file written by `Write`).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DiffEditor, languageForPath } from '@/lib/monaco/loader';
import { useSettingsStore } from '@/stores/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export interface MonacoDiffViewerProps {
  filePath: string;
  original: string | null | undefined;
  modified: string | null | undefined;
  className?: string;
}

function resolveMonacoTheme(theme: string | undefined): string {
  if (theme === 'dark') return 'vs-dark';
  if (theme === 'light') return 'vs';
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'vs-dark' : 'vs';
}

export default function MonacoDiffViewer({
  filePath,
  original,
  modified,
  className,
}: MonacoDiffViewerProps) {
  const { t } = useTranslation('chat');
  const theme = useSettingsStore((s) => s.theme);
  const language = useMemo(() => languageForPath(filePath), [filePath]);
  const monacoTheme = resolveMonacoTheme(theme);

  if ((original == null || original === '') && (modified == null || modified === '')) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('filePreview.diff.noChanges', '没有可显示的变更')}
      </div>
    );
  }

  if (original == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('filePreview.diff.newFile', '这是新增文件，无对比内容')}
      </div>
    );
  }

  return (
    <div className={className ?? 'h-full w-full'}>
      <DiffEditor
        height="100%"
        original={original}
        modified={modified ?? ''}
        language={language}
        theme={monacoTheme}
        loading={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          wordWrap: 'on',
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
