import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { Root } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import {
  defaultRemarkPlugins,
  Streamdown,
  type Components,
  type StreamdownProps,
} from 'streamdown';
import { BrowserLink } from '@/components/common/BrowserLink';
import {
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from '@/components/markdown/streamdown-config';
import { cn } from '@/lib/utils';

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

/** Expose parser-recognized frontmatter as literal text, never as Markdown/HTML. */
function remarkPreviewFrontmatter() {
  return (tree: Root) => {
    tree.children = tree.children.map(node => {
      const format: string = node.type;
      if ((format !== 'yaml' && format !== 'toml') || !('value' in node)) return node;
      return {
        type: 'paragraph' as const,
        position: node.position,
        children: [],
        // Bypass paragraph text normalization, which would strip YAML indentation.
        data: { hName: 'details', hChildren: [{ type: 'text', value: node.value }] },
      };
    });
  };
}

const previewRemarkPlugins: NonNullable<StreamdownProps['remarkPlugins']> = [
  ...Object.values(defaultRemarkPlugins),
  [remarkFrontmatter, ['yaml', 'toml']],
  remarkPreviewFrontmatter,
];

function FrontmatterDetails({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation('common');
  return (
    <details open className="group mb-4 rounded-lg bg-surface-input px-3" data-testid="markdown-frontmatter">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        {t('markdown.metadata')}
      </summary>
      <pre className="whitespace-pre-wrap break-words pb-3 font-mono text-xs leading-relaxed text-muted-foreground" data-testid="markdown-frontmatter-content"><code>{children}</code></pre>
    </details>
  );
}

const previewComponents: Components = {
  details: ({ children }) => <FrontmatterDetails>{children}</FrontmatterDetails>,
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-2xl font-semibold text-foreground first:mt-0" data-streamdown="heading-1">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-xl font-semibold text-foreground first:mt-0" data-streamdown="heading-2">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-base font-semibold text-foreground first:mt-0" data-streamdown="heading-3">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0" data-streamdown="heading-4">
      {children}
    </h4>
  ),
  a: ({ children, href }) => href ? (
    <BrowserLink href={href} className="text-primary underline-offset-2 hover:underline">
      {children}
    </BrowserLink>
  ) : <>{children}</>,
  inlineCode: ({ children }) => (
    <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground dark:bg-white/10">
      {children}
    </code>
  ),
};

export default function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  const { t } = useTranslation('common');
  const translations = useMemo(() => ({
    copyCode: t('markdown.copyCode'),
  }), [t]);

  return (
    <Streamdown
      className={cn('clawx-markdown clawx-markdown-preview clawx-streamdown prose max-w-none px-6 py-4 text-sm leading-relaxed', className)}
      components={previewComponents}
      controls={streamdownControls}
      lineNumbers={false}
      linkSafety={streamdownLinkSafety}
      mode="static"
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      remarkPlugins={previewRemarkPlugins}
      translations={translations}
    >
      {source}
    </Streamdown>
  );
}
