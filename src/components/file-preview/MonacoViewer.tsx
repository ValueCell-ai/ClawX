/**
 * Monaco-backed text/code viewer.
 *
 * Lazily loads Monaco on first render (the parent overlay wraps this in
 * `<Suspense>`), and resolves the language from the file extension so
 * highlighting works for the dozens of file types the editor ships with
 * out of the box.
 */
import { useMemo } from 'react';
import { Editor, languageForPath } from '@/lib/monaco/loader';
import { useSettingsStore } from '@/stores/settings';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export interface MonacoViewerProps {
  filePath: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
}

function resolveMonacoTheme(theme: string | undefined): string {
  if (theme === 'dark') return 'vs-dark';
  if (theme === 'light') return 'vs';
  // 'system' — derive from media query at the moment of mount
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'vs-dark' : 'vs';
}

export default function MonacoViewer({
  filePath,
  value,
  onChange,
  readOnly = false,
  className,
}: MonacoViewerProps) {
  const theme = useSettingsStore((s) => s.theme);
  const language = useMemo(() => languageForPath(filePath), [filePath]);
  const monacoTheme = resolveMonacoTheme(theme);

  return (
    <div className={className ?? 'h-full w-full'}>
      <Editor
        height="100%"
        path={filePath}
        defaultLanguage={language}
        language={language}
        value={value}
        onChange={(next) => onChange?.(next ?? '')}
        theme={monacoTheme}
        loading={
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        }
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          wordWrap: 'on',
          automaticLayout: true,
          renderLineHighlight: readOnly ? 'none' : 'line',
          padding: { top: 12, bottom: 12 },
          stickyScroll: { enabled: false },
          guides: { indentation: false },
        }}
      />
    </div>
  );
}
