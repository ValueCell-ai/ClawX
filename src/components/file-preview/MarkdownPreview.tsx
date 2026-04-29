/**
 * Rendered Markdown preview.
 *
 * Two important deltas from a vanilla ReactMarkdown setup:
 *
 *   1. `remark-frontmatter` is enabled with the `yaml`/`toml` flavours so a
 *      file like `SKILL.md` doesn't render its `---\nname: …\n---` block as
 *      a giant paragraph between two horizontal rules. The frontmatter is
 *      extracted into a side-rendered metadata card above the body so users
 *      can still see it without the noise.
 *
 *   2. We render heading / inline-code / fenced-code with explicit Tailwind
 *      classes instead of relying solely on `.prose`, because the project
 *      doesn't ship `@tailwindcss/typography` — only the small subset of
 *      `.prose` rules from `globals.css` exists.
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

export interface MarkdownPreviewProps {
  source: string;
  className?: string;
}

interface FrontmatterSplit {
  body: string;
  yaml: string | null;
}

function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) {
    return { body: source, yaml: null };
  }
  // Match opening fence + YAML body + closing fence on its own line.
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: source, yaml: null };
  const yaml = match[1].trim();
  const body = source.slice(match[0].length);
  return { body, yaml: yaml.length > 0 ? yaml : null };
}

export default function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  const { body, yaml } = useMemo(() => splitFrontmatter(source), [source]);

  return (
    <div className={cn('prose max-w-none px-6 py-4 text-sm leading-relaxed', className)}>
      {yaml && (
        <pre className="mb-4 rounded-lg border border-black/5 bg-black/[.03] px-3 py-2 text-2xs leading-relaxed text-foreground/70 dark:border-white/10 dark:bg-white/5">
          <code className="font-mono">{yaml}</code>
        </pre>
      )}
      <ReactMarkdown
        remarkPlugins={[[remarkFrontmatter, ['yaml', 'toml']], remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="mb-3 mt-4 text-2xl font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="mb-2 mt-4 text-xl font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="mb-2 mt-3 text-base font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold text-foreground first:mt-0" {...props}>
              {children}
            </h4>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const match = /language-(\w+)/.exec(codeClass || '');
            const isInline = !match && !codeClass;
            if (isInline) {
              return (
                <code
                  className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground dark:bg-white/10"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('font-mono text-[0.9em]', codeClass)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-black/5 p-3 text-xs leading-relaxed dark:bg-white/10">
              {children}
            </pre>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
