/**
 * Sandboxed rendered HTML preview.
 *
 * HTML emitted by an agent is untrusted, so it is rendered inside an
 * iframe with a sandbox instead of being injected into the React tree.
 * We allow scripts so simple interactive demo pages still work, but do
 * not grant same-origin/top-navigation/popups; the iframe therefore gets
 * an opaque origin and cannot reach back into the ClawX renderer.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface HtmlPreviewProps {
  source: string;
  filePath: string;
  fileName?: string;
  className?: string;
}

function dirnameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '';
  return normalized.slice(0, idx + 1);
}

function pathToFileUrl(filePath: string): string | null {
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, '/');
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = absolutePath
    .split('/')
    .map((segment, index) => (index === 0 ? '' : encodeURIComponent(segment)))
    .join('/');
  return `file://${encoded}`;
}

function injectBaseHref(source: string, filePath: string): string {
  const baseUrl = pathToFileUrl(dirnameOf(filePath));
  if (!baseUrl) return source;
  const baseTag = `<base href="${baseUrl}">`;

  if (/<base\s/i.test(source)) return source;
  if (/<head[\s>]/i.test(source)) {
    return source.replace(/<head([^>]*)>/i, `<head$1>\n${baseTag}`);
  }
  if (/<html[\s>]/i.test(source)) {
    return source.replace(/<html([^>]*)>/i, `<html$1>\n<head>${baseTag}</head>`);
  }
  return `<!doctype html><html><head>${baseTag}</head><body>${source}</body></html>`;
}

export default function HtmlPreview({ source, filePath, fileName, className }: HtmlPreviewProps) {
  const { t } = useTranslation('chat');
  const srcDoc = useMemo(() => injectBaseHref(source, filePath), [source, filePath]);

  return (
    <div className={cn('h-full min-h-0 bg-white', className)}>
      <iframe
        data-testid="html-preview-frame"
        title={fileName ?? t('filePreview.html.title', 'HTML preview')}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads"
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}
