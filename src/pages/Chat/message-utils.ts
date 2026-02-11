/**
 * Message content extraction helpers
 * Ported from OpenClaw's message-extract.ts to handle the various
 * message content formats returned by the Gateway.
 */
import type { RawMessage, ContentBlock } from '@/stores/chat';

/**
 * Extract displayable text from a message's content field.
 * Handles both string content and array-of-blocks content.
 */
export function extractText(message: RawMessage | unknown): string {
  if (!message || typeof message !== 'object') return '';
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (role === 'toolresult' || role === 'tool_result') {
    return '';
  }

  if (typeof content === 'string') {
    return content.trim().length > 0 ? content : '';
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text);
      }
    }
    const combined = parts.join('\n\n');
    return combined.trim().length > 0 ? combined : '';
  }

  // Fallback: try .text field
  if (typeof msg.text === 'string') {
    return msg.text;
  }

  return '';
}

/**
 * Extract thinking/reasoning content from a message.
 * Returns null if no thinking content found.
 */
export function extractThinking(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  if (typeof msg.thinking === 'string' && msg.thinking.trim()) {
    return msg.thinking;
  }
  const content = msg.content;

  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'thinking' || block.type === 'analysis' || block.type === 'reasoning') {
      if (block.thinking && block.thinking.trim()) {
        parts.push(block.thinking);
        continue;
      }
      if (block.text && block.text.trim()) {
        parts.push(block.text);
        continue;
      }
      if (typeof block.content === 'string' && block.content.trim()) {
        parts.push(block.content);
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Extract image attachments from a message.
 * Returns array of { mimeType, data } for base64 images.
 */
export function extractImages(message: RawMessage | unknown): Array<{ mimeType: string; data: string }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const images: Array<{ mimeType: string; data: string }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'image' && block.source) {
      const src = block.source;
      if (src.type === 'base64' && src.media_type && src.data) {
        images.push({ mimeType: src.media_type, data: src.data });
      }
    }
  }

  return images;
}

/**
 * Extract tool use blocks from a message.
 */
export function extractToolUse(message: RawMessage | unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;

  if (!Array.isArray(content)) return [];

  const tools: Array<{ id: string; name: string; input: unknown }> = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' && block.name) {
      tools.push({
        id: block.id || '',
        name: block.name,
        input: block.input,
      });
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
