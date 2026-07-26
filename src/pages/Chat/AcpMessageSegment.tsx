import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { AlertCircle, Check, Copy, FileText, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MessageSegmentItem, RenderPart } from '@/lib/acp/timeline-types';
import { cn } from '@/lib/utils';
import { AcpImagePart, isSafeAcpImageSource } from './AcpImagePart';

type RenderTone = 'assistant' | 'user' | 'process';

function normalizeLatexDelimiters(input: string): string {
  if (!input || (input.indexOf('\\(') === -1 && input.indexOf('\\[') === -1)) return input;

  const parts = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part || part.startsWith('```') || part.startsWith('`')) continue;
    let next = part.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`);
    next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`);
    parts[i] = next;
  }
  return parts.join('');
}

function AcpMarkdownPart({ text, tone }: { text: string; tone: RenderTone }) {
  const { t } = useTranslation('chat');
  const isUser = tone === 'user';

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none break-words',
        isUser ? 'prose-invert text-white [&_*]:text-inherit' : 'dark:prose-invert text-foreground',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: 'html' }]]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !className;
            if (isInline) {
              return (
                <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-sm break-all dark:bg-white/10" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={cn('font-mono text-sm', className)} {...props}>
                {children}
              </code>
            );
          },
          pre({ children, ...props }) {
            return (
              <pre
                className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-4 dark:bg-white/10"
                {...props}
              >
                {children}
              </pre>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            const imageSource = typeof src === 'string' ? src : '';
            if (!imageSource || !isSafeAcpImageSource(imageSource)) return null;
            return (
              <img
                src={imageSource}
                alt={typeof alt === 'string' ? alt : t('acp.image')}
                className="max-w-full rounded-lg"
              />
            );
          },
        }}
      >
        {normalizeLatexDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}

function AcpFilePart({ part }: { part: Extract<RenderPart, { kind: 'file' }> }) {
  const { t } = useTranslation('chat');
  const label = part.name || part.path || t('acp.unsupportedContent');

  return (
    <div className="flex max-w-full items-center gap-2 rounded-xl border border-black/10 bg-surface-input px-3 py-2 text-sm text-muted-foreground dark:border-white/10">
      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      {part.mimeType && <span className="shrink-0 text-2xs text-muted-foreground/70">{part.mimeType}</span>}
    </div>
  );
}

function AcpErrorPart({ message }: { message: string }) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-surface-input px-3 py-2 text-sm text-red-700 dark:text-red-400">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{t('acp.unsupportedContent')}</p>
        <p className="break-words text-xs opacity-80">{message}</p>
      </div>
    </div>
  );
}

function clipboardTextForPart(part: RenderPart): string {
  return part.kind === 'markdown' ? part.text : '';
}

export function clipboardTextForParts(parts: RenderPart[]): string {
  return parts
    .map(clipboardTextForPart)
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

export function AcpAssistantHoverBar({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  const label = copied ? t('acp.copied') : t('acp.copy');

  return (
    <div className="flex w-full justify-end px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        data-testid="acp-assistant-copy"
        aria-label={label}
        title={label}
        onClick={() => void copyContent()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function AcpRenderPart({ part, tone = 'assistant' }: { part: RenderPart; tone?: RenderTone }) {
  if (part.kind === 'markdown') {
    if (tone === 'user') {
      return (
        <div className="rounded-2xl bg-brand px-4 py-3 text-white shadow-sm">
          <AcpMarkdownPart text={part.text} tone={tone} />
        </div>
      );
    }
    return <AcpMarkdownPart text={part.text} tone={tone} />;
  }

  if (part.kind === 'image') return <AcpImagePart part={part} />;
  if (part.kind === 'file') return <AcpFilePart part={part} />;
  return <AcpErrorPart message={part.message} />;
}

export function AcpMessageSegment({ item }: { item: MessageSegmentItem }) {
  const isUser = item.role === 'user';
  const clipboardText = useMemo(() => clipboardTextForParts(item.parts), [item.parts]);

  return (
    <div
      data-testid={isUser ? 'acp-user-message' : 'acp-assistant-message'}
      className={cn('group flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>
      )}
      <div className={cn('flex min-w-0 flex-col gap-2', isUser ? 'max-w-[80%] items-end' : 'w-full items-start')}>
        {item.parts.map((part, index) => (
          <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone={item.role} />
        ))}
        {!isUser && clipboardText.trim().length > 0 && <AcpAssistantHoverBar text={clipboardText} />}
      </div>
    </div>
  );
}
