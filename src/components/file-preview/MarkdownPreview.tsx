import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

const previewRemarkPlugins: NonNullable<StreamdownProps['remarkPlugins']> = [
  ...Object.values(defaultRemarkPlugins),
  [remarkFrontmatter, ['yaml', 'toml']],
];

const previewComponents: Components = {
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
