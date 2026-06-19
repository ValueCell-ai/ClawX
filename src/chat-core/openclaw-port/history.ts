import type { ChatQueueItem, RawOpenClawMessage } from './types';
import {
  extractAssistantVisibleText,
  isHiddenAssistantMessage,
} from './message-extraction';
import { extractToolCards } from './tool-cards';

export function extractMessageText(message: RawOpenClawMessage): string {
  if (message.role === 'assistant') return extractAssistantVisibleText(message) ?? '';
  if (typeof message.text === 'string') return message.text;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return [];
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? [text] : [];
      })
      .join('');
  }
  return '';
}

const INLINE_DISPLAY_DIRECTIVE_PATTERN =
  /\[\[\s*(?:audio_as_voice|reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]/gi;

export function stripInlineDirectiveTagsForDisplay(text: string): string {
  if (!text) return text;
  return text
    .replace(INLINE_DISPLAY_DIRECTIVE_PATTERN, (match, offset: number, source: string) => {
      const before = source[offset - 1];
      const after = source[offset + match.length];
      if (before && after && !/\s/u.test(before) && !/\s/u.test(after)) return ' ';
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractDisplayMessageText(message: RawOpenClawMessage): string {
  return stripInlineDirectiveTagsForDisplay(extractMessageText(message));
}

export function shouldHideHistoryMessage(message: RawOpenClawMessage): boolean {
  if (extractToolCards(message).length > 0) return false;
  return isHiddenAssistantMessage(message);
}

const MEDIA_ATTACHMENT_PATTERN = /\s*\[media attached:[^\]]*\]/gi;
const QUEUE_HISTORY_EARLY_ECHO_SKEW_MS = 250;

export function stripMediaAttachmentReferences(text: string): string {
  return text.replace(MEDIA_ATTACHMENT_PATTERN, '').replace(/\s+/g, ' ').trim();
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function queueItemCanMatchHistoryTimestamp(
  item: ChatQueueItem,
  message: RawOpenClawMessage,
): boolean {
  const createdAt = timestampMs(item.createdAt);
  if (createdAt === null) return true;

  const historyTimestamp = timestampMs(message.timestamp);
  if (historyTimestamp === null) return false;
  return historyTimestamp >= createdAt - QUEUE_HISTORY_EARLY_ECHO_SKEW_MS;
}

export function queueItemHasMatchingHistoryMessage(
  item: ChatQueueItem,
  messages: RawOpenClawMessage[],
): boolean {
  const expected = stripMediaAttachmentReferences(item.message);
  if (!expected) return false;
  const candidates = typeof item.historyMessageCountAtEnqueue === 'number'
    ? messages.slice(Math.max(0, item.historyMessageCountAtEnqueue))
    : messages;
  return candidates.some((message) => {
    if (message.role !== 'user') return false;
    if (!queueItemCanMatchHistoryTimestamp(item, message)) return false;
    return stripMediaAttachmentReferences(extractMessageText(message)) === expected;
  });
}
