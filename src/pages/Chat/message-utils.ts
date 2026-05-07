/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import type { RawMessage, ContentBlock } from '@/stores/chat';

/**
 * Clean Gateway metadata from user message text for display.
 * Strips: [media attached: ... | ...], [message_id: ...],
 * and the timestamp prefix [Day Date Time Timezone].
 */
function cleanUserText(text: string): string {
  return text
    // Remove [media attached: path (mime) | path] references
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    // Remove [message_id: uuid]
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    // Remove Gateway-injected "Conversation info (untrusted metadata): ```json...```" block
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    // Fallback: remove "Conversation info (...): {...}" without code block wrapper
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    // Remove Gateway timestamp prefix like [Fri 2026-02-13 22:39 GMT+8]
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
}

/**
 * Strip `MEDIA:/path/to/file.ext` artifact markers from assistant text so
 * the chat bubble doesn't duplicate the file already surfaced as a card.
 *
 * Mirrors the regex in `chat/helpers.ts::extractRawFilePaths` (tagged
 * variant) so anything we promote to `_attachedFiles` is also removed
 * from the visible bubble.  Whitespace around the marker is normalised
 * so the bubble doesn't end with a dangling blank line.
 */
function stripAssistantMediaTags(text: string): string {
  if (!text) return text;
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Mirror the relaxed character class in `chat/helpers.ts::extractRawFilePaths`
  // so paths with ASCII spaces (e.g. macOS' "截屏 2026-05-06 17.46.51.png")
  // are also stripped from the visible bubble. Without this, the bubble
  // would still leak the literal `MEDIA:/.../截屏 2026-05-06 17.46.51.png`
  // to the user when the underlying path detection succeeds.
  const tagged = new RegExp(`(^|[\\s(\\[{>])(?:MEDIA|media):(?:\\/|~\\/)[^\\n"'()\\[\\],<>]*?\\.(?:${exts})(?=$|[\\s\\n"'()\\[\\],<>]|[，。；;,.!?])`, 'g');
  return text
    .replace(tagged, (_, lead: string) => lead)
    // Collapse the empty lines / orphan whitespace the strip leaves behind.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeProgressiveText(text: string | undefined): string {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
}

function compactProgressiveParts(parts: string[]): string[] {
  const compacted: string[] = [];

  for (const part of parts) {
    const current = normalizeProgressiveText(part);
    if (!current) continue;

    const previous = compacted.at(-1);
    if (!previous) {
      compacted.push(part);
      continue;
    }

    const normalizedPrevious = normalizeProgressiveText(previous);
    if (!normalizedPrevious) {
      compacted[compacted.length - 1] = part;
      continue;
    }

    if (current === normalizedPrevious || normalizedPrevious.startsWith(current)) {
      continue;
    }

    if (current.startsWith(normalizedPrevious)) {
      compacted[compacted.length - 1] = part;
      continue;
    }

    compacted.push(part);
  }

  return compacted;
}

function splitProgressiveParts(parts: string[]): string[] {
  const segments: string[] = [];
  let previous = '';

  for (const part of parts) {
    const current = normalizeProgressiveText(part);
    if (!current) continue;

    if (!previous) {
      segments.push(current);
      previous = current;
      continue;
    }

    if (current === previous || previous.startsWith(current)) {
      continue;
    }

    if (current.startsWith(previous)) {
      const incremental = current.slice(previous.length).trim();
      if (incremental) {
        segments.push(incremental);
      }
      previous = current;
      continue;
    }

    segments.push(current);
    previous = current;
  }

  return segments;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function consumeLeadingSegment(text: string, segment: string): number {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const pattern = new RegExp(`^\\s*${tokens.map(escapeRegExp).join('\\s+')}\\s*`, 'u');
  const match = text.match(pattern);
  return match ? match[0].length : 0;
}

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 * For user messages, strips Gateway-injected metadata.
 */
export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const isUser = msg.role === 'user';

  let result = '';

  if (typeof content === 'string') {
    result = content.trim().length > 0 ? content : '';
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text) {
        if (block.text.trim().length > 0) {
          parts.push(block.text);
        }
      }
    }
    const combined = compactProgressiveParts(parts).join('\n\n');
    result = combined.trim().length > 0 ? combined : '';
  } else if (typeof msg.text === 'string') {
    // Fallback: try .text field
    result = msg.text.trim().length > 0 ? msg.text : '';
  }

  // Strip Gateway metadata from user messages for clean display
  if (isUser && result) {
    result = cleanUserText(result);
  } else if (!isUser && result) {
    // Assistant-side cleanup: keep the bubble free of `MEDIA:/path` tags
    // that the runtime emits to point at produced artifacts.  The same
    // path is surfaced as a clickable file card via `_attachedFiles`,
    // so leaving it inline would duplicate the artifact.
    result = stripAssistantMediaTags(result);
  }

  return result;
}

export function extractTextSegments(message: RawMessage | unknown): string[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const isUser = msg.role === 'user';

  let segments: string[] = [];

  if (typeof content === 'string') {
    const cleaned = content.trim();
    segments = cleaned ? [cleaned] : [];
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        parts.push(block.text);
      }
    }
    segments = splitProgressiveParts(parts);
  } else if (typeof msg.text === 'string') {
    const cleaned = msg.text.trim();
    segments = cleaned ? [cleaned] : [];
  }

  if (!isUser) {
    return segments
      .map((segment) => stripAssistantMediaTags(segment))
      .filter((segment) => segment.length > 0);
  }

  return segments
    .map((segment) => cleanUserText(segment))
    .filter((segment) => segment.length > 0);
}

/**
 * Extract thinking/reasoning content from a message.
 * Returns null if no thinking content found.
 */
export function extractThinking(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      const cleaned = block.thinking.trim();
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }

  const combined = compactProgressiveParts(parts).join('\n\n').trim();
  return combined.length > 0 ? combined : null;
}

export function extractThinkingSegments(message: RawMessage | unknown): string[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      const cleaned = block.thinking.trim();
      if (cleaned) {
        parts.push(cleaned);
      }
    }
  }

  return splitProgressiveParts(parts);
}

export function stripProcessMessagePrefix(text: string, processSegments: string[]): string {
  let remaining = text;
  let strippedAny = false;

  for (const segment of processSegments) {
    const normalizedSegment = normalizeProgressiveText(segment);
    if (!normalizedSegment) continue;
    const consumed = consumeLeadingSegment(remaining, normalizedSegment);
    if (consumed === 0) break;
    remaining = remaining.slice(consumed);
    strippedAny = true;
  }

  const trimmed = remaining.trimStart();
  return strippedAny && trimmed ? trimmed : text;
}

/**
 * Extract media file references from Gateway-formatted user message text.
 * Returns array of { filePath, mimeType } from [media attached: path (mime) | path] patterns.
 */
export function extractMediaRefs(message: RawMessage | unknown): Array<{ filePath: string; mimeType: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  if (msg.role !== 'user') return [];
  const content = msg.content;

  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = (content as ContentBlock[])
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n');
  }

  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/**
 * Extract inline image attachments from a message.
 *
 * Returns either:
 *   - `{ mimeType, data }`   — base64 bytes inline (Anthropic / Gateway tool-result)
 *   - `{ mimeType, url }`    — Anthropic source-wrapped remote URL form
 *
 * Note: the Gateway-injected `assistant-media` shape — flat
 * `{ type:'image', url:'/api/chat/media/outgoing/...', mimeType, ... }` —
 * is intentionally NOT extracted here because the URL is a Gateway-relative
 * path the renderer cannot fetch directly (CORS / env drift). That shape
 * is surfaced through `_attachedFiles` instead (see
 * `extractImagesAsAttachedFiles` and `enrichWithGatewayMediaBlocks` in
 * `src/stores/chat/helpers.ts`), and resolved to a local preview by
 * `loadMissingPreviews` -> Main `media:getThumbnails`.
 */
export function extractImages(
  message: RawMessage | unknown,
): Array<{ mimeType: string; data?: string; url?: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const images: Array<{ mimeType: string; data?: string; url?: string }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'image') continue;

    // Path 1: Anthropic source-wrapped format
    if (block.source) {
      const src = block.source;
      if (src.type === 'base64' && src.media_type && src.data) {
        images.push({ mimeType: src.media_type, data: src.data });
      } else if (src.type === 'url' && src.url) {
        images.push({ mimeType: src.media_type || 'image/jpeg', url: src.url });
      }
      continue;
    }

    // Path 2: Flat format from Gateway tool results {data, mimeType}
    if (block.data) {
      images.push({ mimeType: block.mimeType || 'image/jpeg', data: block.data });
    }
    // Flat `block.url` is intentionally NOT handled here; see comment above.
  }

  return images;
}

/**
 * Extract tool use blocks from a message.
 * Handles both Anthropic format (tool_use in content array) and
 * OpenAI format (tool_calls array on the message object).
 */
export function extractToolUse(message: RawMessage | unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const tools: Array<{ id: string; name: string; input: unknown }> = [];

  // Path 1: Anthropic/normalized format — tool_use / toolCall blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
        tools.push({
          id: block.id || '',
          name: block.name,
          input: block.input ?? block.arguments,
        });
      }
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  // Real-time streaming events from OpenAI-compatible models (DeepSeek, etc.)
  // use this format; the Gateway normalizes to Path 1 when storing history.
  if (tools.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        let input: unknown;
        try {
          input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments ?? fn.input;
        } catch {
          input = fn.arguments;
        }
        tools.push({
          id: typeof tc.id === 'string' ? tc.id : '',
          name,
          input,
        });
      }
    }
  }

  return tools;
}

/**
 * Format a Unix timestamp (seconds) to relative time string.
 */
export function formatTimestamp(timestamp: unknown): string {
  if (!timestamp) return '';
  const ts = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!ts || isNaN(ts)) return '';

  // OpenClaw timestamps can be in seconds or milliseconds
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
