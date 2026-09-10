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
import { useResolvedTheme } from '@/lib/use-resolved-theme';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

export interface MonacoViewerProps {
  filePath: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
}

export default function MonacoViewer({
  filePath,
  value,
  onChange,
  readOnly = false,
  className,
}: MonacoViewerProps) {
  const resolvedTheme = useResolvedTheme();
  const language = useMemo(() => languageForPath(filePath), [filePath]);
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs';

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
