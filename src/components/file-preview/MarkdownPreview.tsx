/**
 * Rendered Markdown preview, sharing remark/rehype config with ChatMessage
 * so prose / math / GFM tables behave identically.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

export default function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert',
        'prose-pre:bg-black/5 dark:prose-pre:bg-white/10',
        'prose-headings:scroll-mt-4',
        'px-6 py-4',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
