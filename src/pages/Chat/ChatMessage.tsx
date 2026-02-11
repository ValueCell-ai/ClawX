/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown, thinking sections, images, and tool cards.
 */
import { useState, useCallback, memo } from 'react';
import { User, Sparkles, Copy, Check, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RawMessage } from '@/stores/chat';
import { extractText, extractThinking, extractImages, extractToolUse, formatTimestamp } from './message-utils';

interface ChatMessageProps {
  message: RawMessage;
  showThinking: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  showThinking,
  isStreaming = false,
  streamingTools = [],
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const text = extractText(message);
  const hasText = text.trim().length > 0;
  const thinking = extractThinking(message);
  const images = extractImages(message);
  const tools = extractToolUse(message);
  const visibleThinking = showThinking ? thinking : null;
  const visibleTools = showThinking ? tools : [];

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  // Don't render empty messages
  if (!hasText && !visibleThinking && images.length === 0 && visibleTools.length === 0) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white',
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full max-w-[80%] space-y-2',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {showThinking && isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {/* Thinking section */}
        {visibleThinking && (
          <ThinkingBlock content={visibleThinking} />
        )}

        {/* Tool use cards */}
        {visibleTools.length > 0 && (
          <div className="space-y-1">
            {visibleTools.map((tool, i) => (
              <ToolCard key={tool.id || i} name={tool.name} input={tool.input} />
            ))}
          </div>
        )}

        {/* Main text bubble */}
        {hasText && (
          <MessageBubble
            text={text}
            isUser={isUser}
            isStreaming={isStreaming}
            timestamp={message.timestamp}
          />
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="attachment"
                className="max-w-xs rounded-lg border"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <div className="space-y-1">
        {tools.map((tool) => {
          const duration = formatDuration(tool.durationMs);
          const statusLabel = tool.status === 'running' ? 'running' : (tool.status === 'error' ? 'error' : 'done');
          return (
            <div key={tool.toolCallId || tool.id || tool.name} className="flex flex-wrap items-center gap-2">
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                tool.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-foreground/5 text-muted-foreground',
              )}>
                <span className="font-mono">{tool.name}</span>
                <span className="opacity-70">{statusLabel}</span>
              </span>
              {duration && <span className="text-[11px] opacity-70">{duration}</span>}
              {tool.summary && (
                <span className="truncate text-[11px]">{tool.summary}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────

function MessageBubble({
  text,
  isUser,
  isStreaming,
  timestamp,
}: {
  text: string;
  isUser: boolean;
  isStreaming: boolean;
  timestamp?: number;
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <div
      className={cn(
        'relative rounded-2xl px-4 py-3',
        !isUser && 'w-full',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted',
      )}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const isInline = !match && !className;
                if (isInline) {
                  return (
                    <code className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <pre className="bg-background/50 rounded-lg p-4 overflow-x-auto">
                    <code className={cn('text-sm font-mono', className)} {...props}>
                      {children}
                    </code>
                  </pre>
                );
              },
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {children}
                  </a>
                );
              },
            }}
          >
            {text}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
          )}
        </div>
      )}

      {/* Footer: timestamp + copy */}
      <div className={cn(
        'flex items-center gap-2 mt-2',
        isUser ? 'justify-end' : 'justify-between',
      )}>
        {timestamp && (
          <span className={cn(
            'text-xs',
            isUser ? 'text-primary-foreground/60' : 'text-muted-foreground',
          )}>
            {formatTimestamp(timestamp)}
          </span>
        )}
        {!isUser && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={copyContent}
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Thinking Block ──────────────────────────────────────────────

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="w-full rounded-lg border border-border/50 bg-muted/30 text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="font-medium">Thinking</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-muted-foreground">
          <div className="prose prose-sm dark:prose-invert max-w-none opacity-75">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tool Card ───────────────────────────────────────────────────

function ToolCard({ name, input }: { name: string; input: unknown }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 text-sm">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-mono text-xs">{name}</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && input != null && (
        <pre className="px-3 pb-2 text-xs text-muted-foreground overflow-x-auto">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2) as string}
        </pre>
      )}
    </div>
  );
}
