export type AssistantPhase = 'commentary' | 'final_answer';

type AssistantTextBuckets = {
  finalAnswerTexts: string[];
  commentaryTexts: string[];
  legacyTexts: string[];
  thinkingTexts: string[];
  hasExplicitPhase: boolean;
};

const HIDDEN_ASSISTANT_TEXT_PATTERN = /^(?:HEARTBEAT_OK|NO_REPLY)\s*$/i;
const HIDDEN_ASSISTANT_LINE_PATTERN = /(^|\n)[ \t]*(?:HEARTBEAT_OK|NO_REPLY)[ \t]*(?=\n|$)/gi;
const LEGACY_THINK_TAG_PATTERN =
  /<thinking\b[^>]*>([\s\S]*?)<\/thinking>|<think\b[^>]*>([\s\S]*?)<\/think>/gi;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeKind(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[_-]/g, '').toLowerCase() : '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAssistantLike(message: Record<string, unknown>): boolean {
  return typeof message.role !== 'string' || message.role === 'assistant';
}

function isAssistantPhase(value: unknown): value is AssistantPhase {
  return value === 'commentary' || value === 'final_answer';
}

function parseTextSignaturePhase(textSignature: unknown): AssistantPhase | undefined {
  if (typeof textSignature !== 'string') return undefined;

  try {
    const parsed = JSON.parse(textSignature) as unknown;
    const record = asRecord(parsed);
    if (!record || record.v !== 1) return undefined;
    return isAssistantPhase(record.phase) ? record.phase : undefined;
  } catch {
    return undefined;
  }
}

function resolveAssistantPhase(
  textSignature: unknown,
  blockPhase: unknown,
  messagePhase: unknown,
): AssistantPhase | undefined {
  return parseTextSignaturePhase(textSignature)
    ?? (isAssistantPhase(blockPhase) ? blockPhase : undefined)
    ?? (isAssistantPhase(messagePhase) ? messagePhase : undefined);
}

function cleanupDisplayText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripLegacyThinking(raw: string): { text: string; thinkingTexts: string[] } {
  const thinkingTexts: string[] = [];
  const text = raw.replace(
    LEGACY_THINK_TAG_PATTERN,
    (_match: string, thinkingTagText: string | undefined, thinkTagText: string | undefined): string => {
      const thinkingText = (thinkingTagText ?? thinkTagText ?? '').trim();
      if (thinkingText) thinkingTexts.push(thinkingText);
      return '';
    },
  );

  return {
    text: cleanupDisplayText(text),
    thinkingTexts,
  };
}

function pushText(
  buckets: AssistantTextBuckets,
  rawText: string,
  phase: AssistantPhase | undefined,
): void {
  if (phase) buckets.hasExplicitPhase = true;

  const withoutThinking = stripLegacyThinking(rawText);
  buckets.thinkingTexts.push(...withoutThinking.thinkingTexts);

  const display = stripHeartbeatTokenForDisplay(withoutThinking.text);
  if (display.shouldSkip) return;

  if (phase === 'final_answer') {
    buckets.finalAnswerTexts.push(display.text);
    return;
  }

  if (phase === 'commentary') {
    buckets.commentaryTexts.push(display.text);
    return;
  }

  buckets.legacyTexts.push(display.text);
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstThinkingContent(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstThinkingContent(item);
      if (nested) return nested;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  return firstStringField(record, [
    'thinking',
    'reasoning',
    'reasoningText',
    'reasoning_text',
    'reasoningContent',
    'reasoning_content',
    'summary',
    'summaryText',
    'summary_text',
    'text',
    'content',
  ]);
}

function pushThinking(buckets: AssistantTextBuckets, thinking: unknown): void {
  const cleaned = firstThinkingContent(thinking)?.trim();
  if (cleaned) buckets.thinkingTexts.push(cleaned);
}

function isThinkingBlock(block: Record<string, unknown>): boolean {
  const kind = normalizeKind(block.type);
  return kind === 'thinking' || kind === 'reasoning' || kind === 'reasoningcontent';
}

function collectAssistantText(message: unknown): AssistantTextBuckets {
  const buckets: AssistantTextBuckets = {
    finalAnswerTexts: [],
    commentaryTexts: [],
    legacyTexts: [],
    thinkingTexts: [],
    hasExplicitPhase: false,
  };
  const record = asRecord(message);
  if (!record || !isAssistantLike(record)) return buckets;

  const content = record.content;
  const messagePhase = record.phase;
  let foundContentText = false;

  if (typeof content === 'string') {
    foundContentText = true;
    pushText(buckets, content, resolveAssistantPhase(undefined, undefined, messagePhase));
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') {
        foundContentText = true;
        pushText(buckets, part, resolveAssistantPhase(undefined, undefined, messagePhase));
        continue;
      }

      const block = asRecord(part);
      if (!block) continue;

      const thinkingBlock = isThinkingBlock(block);
      if (thinkingBlock) {
        pushThinking(buckets, block);
      }

      if (!thinkingBlock && typeof block.text === 'string') {
        foundContentText = true;
        pushText(buckets, block.text, resolveAssistantPhase(block.textSignature, block.phase, messagePhase));
      }
    }
  }

  if (!foundContentText && typeof record.text === 'string') {
    pushText(buckets, record.text, resolveAssistantPhase(undefined, undefined, messagePhase));
  }

  return buckets;
}

function joinDisplayText(parts: string[]): string | undefined {
  const text = cleanupDisplayText(parts.join('\n'));
  return text ? text : undefined;
}

function joinThinkingText(parts: string[]): string | undefined {
  const text = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  return text ? text : undefined;
}

const loggedReasoningTokenMessages = new WeakSet<Record<string, unknown>>();

function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function reasoningTokensForMessage(record: Record<string, unknown>): number | undefined {
  const usage = asRecord(record.usage);
  return firstNumberField(record, ['reasoningTokens', 'reasoning_tokens'])
    ?? (usage ? firstNumberField(usage, ['reasoningTokens', 'reasoning_tokens']) : undefined);
}

function debugMissingThinkingForReasoningTokens(message: unknown): void {
  const record = asRecord(message);
  if (!record || !isAssistantLike(record)) return;
  const reasoningTokens = reasoningTokensForMessage(record);
  if (!reasoningTokens) return;
  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  if (!env?.DEV) return;
  if (loggedReasoningTokenMessages.has(record)) return;
  loggedReasoningTokenMessages.add(record);
  console.debug('[ClawX Chat] assistant message has reasoning tokens but no displayable thinking', {
    id: typeof record.id === 'string' ? record.id : undefined,
    responseId: typeof record.responseId === 'string' ? record.responseId : undefined,
    reasoningTokens,
    contentTypes: Array.isArray(record.content)
      ? record.content.map((part) => asRecord(part)?.type).filter(Boolean)
      : typeof record.content,
  });
}

export function stripHeartbeatTokenForDisplay(raw: string): { shouldSkip: boolean; text: string } {
  const trimmed = raw.trim();
  if (!trimmed || HIDDEN_ASSISTANT_TEXT_PATTERN.test(trimmed)) {
    return { shouldSkip: true, text: '' };
  }

  const text = raw
    .replace(HIDDEN_ASSISTANT_LINE_PATTERN, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { shouldSkip: !text, text };
}

export function isHiddenStreamText(text: string): boolean {
  return stripHeartbeatTokenForDisplay(text).shouldSkip;
}

function hasStringInArray(value: unknown): boolean {
  return Array.isArray(value) && value.some(isNonEmptyString);
}

function hasRenderableMediaValue(record: Record<string, unknown>): boolean {
  if (
    isNonEmptyString(record.mediaUrl)
    || isNonEmptyString(record.gatewayUrl)
    || isNonEmptyString(record.filePath)
    || isNonEmptyString(record.path)
    || isNonEmptyString(record.url)
    || isNonEmptyString(record.data)
    || hasStringInArray(record.mediaUrls)
  ) {
    return true;
  }

  const source = asRecord(record.source);
  if (source && (isNonEmptyString(source.url) || isNonEmptyString(source.data))) return true;

  return false;
}

function hasRenderableMediaArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => {
    if (isNonEmptyString(entry)) return true;
    const record = asRecord(entry);
    return record ? hasRenderableMediaValue(record) : false;
  });
}

export function hasRenderableAssistantMedia(message: unknown): boolean {
  const record = asRecord(message);
  if (!record || !isAssistantLike(record)) return false;

  if (
    hasRenderableMediaValue(record)
    || hasRenderableMediaArray(record._attachedFiles)
    || hasRenderableMediaArray(record.attachments)
  ) {
    return true;
  }

  if (!Array.isArray(record.content)) return false;
  return record.content.some((part) => {
    const block = asRecord(part);
    if (!block) return false;
    if (block.type === 'image' && hasRenderableMediaValue(block)) return true;
    return hasRenderableMediaArray(block.attachments) || hasRenderableMediaValue(block);
  });
}

export function extractAssistantVisibleText(message: unknown): string | undefined {
  const buckets = collectAssistantText(message);
  if (buckets.finalAnswerTexts.length > 0) return joinDisplayText(buckets.finalAnswerTexts);
  if (buckets.hasExplicitPhase) return undefined;
  return joinDisplayText(buckets.legacyTexts);
}

export function extractAssistantCommentaryText(message: unknown): string | undefined {
  return joinDisplayText(collectAssistantText(message).commentaryTexts);
}

export function extractThinkingText(message: unknown): string | undefined {
  const text = joinThinkingText(collectAssistantText(message).thinkingTexts);
  if (!text) debugMissingThinkingForReasoningTokens(message);
  return text;
}

export function extractAssistantDisplayParts(message: unknown): {
  visibleText?: string;
  commentaryText?: string;
  thinkingText?: string;
} {
  const buckets = collectAssistantText(message);
  const visibleText = buckets.finalAnswerTexts.length > 0
    ? joinDisplayText(buckets.finalAnswerTexts)
    : buckets.hasExplicitPhase
      ? undefined
      : joinDisplayText(buckets.legacyTexts);
  const commentaryText = joinDisplayText(buckets.commentaryTexts);
  const thinkingText = joinThinkingText(buckets.thinkingTexts);

  return {
    ...(visibleText ? { visibleText } : {}),
    ...(commentaryText ? { commentaryText } : {}),
    ...(thinkingText ? { thinkingText } : {}),
  };
}

export function isHiddenAssistantMessage(message: unknown): boolean {
  const record = asRecord(message);
  if (!record || record.role !== 'assistant') return false;
  if (hasRenderableAssistantMedia(record)) return false;

  const parts = extractAssistantDisplayParts(record);
  return !parts.visibleText;
}
