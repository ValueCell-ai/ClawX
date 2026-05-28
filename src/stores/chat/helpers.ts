import { invokeIpc } from '@/lib/api-client';
import {
  isGeneratingStatusNarration,
  isInternalAssistantReplyText,
  isOpenClawRuntimeEventPrompt,
} from '@/pages/Chat/message-utils';
import type { AttachedFileMeta, ChatSession, ContentBlock, RawMessage, ToolStatus } from './types';

// Module-level timestamp tracking the last chat event received.
// Used by the safety timeout to avoid false-positive "no response" errors
// during tool-use conversations where streamingMessage is temporarily cleared
// between tool-result finals and the next delta.
let _lastChatEventAt = 0;

/** Normalize a timestamp to milliseconds. Handles both seconds and ms. */
function toMs(ts: number): number {
  // Timestamps < 1e12 are in seconds (before ~2033); >= 1e12 are milliseconds
  return ts < 1e12 ? ts * 1000 : ts;
}

// Timer for fallback history polling during active sends.
// If no streaming events arrive within a few seconds, we periodically
// poll chat.history to surface intermediate tool-call turns.
let _historyPollTimer: ReturnType<typeof setTimeout> | null = null;

// Timer for delayed error finalization. When the Gateway reports a mid-stream
// error (e.g. "terminated"), it may retry internally and recover. We wait
// before committing the error to give the recovery path a chance.
let _errorRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

// Track the last run ID that was explicitly aborted by the user.
// Prevents lingering Gateway events from the aborted run from re-arming
// the sending state after abortRun clears it.
let _lastAbortedRunId: string | null = null;
const _blockedRunEvents = new Map<string, Record<string, unknown>[]>();
const OPTIMISTIC_USER_MESSAGE_TTL_MS = 30 * 60 * 1000;
/** Max skew between the renderer optimistic send time and Gateway transcript timestamps. */
const OPTIMISTIC_USER_TIMESTAMP_MATCH_MS = 120_000;
/** Grace period before surfacing mid-run Gateway errors that often self-recover. */
const ERROR_RECOVERY_DELAY_MS = 12_000;

type PendingOptimisticUserMessage = {
  message: RawMessage;
  timestampMs: number;
  createdAtMs: number;
};

const _pendingOptimisticUserMessages = new Map<string, PendingOptimisticUserMessage[]>();

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

function isRecoverableRuntimeError(errorMessage: string): boolean {
  const normalized = errorMessage.trim().toLowerCase();
  if (!normalized) return false;
  return /\bterminated\b/.test(normalized)
    || /\baborted\b/.test(normalized)
    || normalized.includes('econnreset')
    || normalized.includes('connection reset');
}

function scheduleRecoverableRuntimeError(commit: () => void): void {
  clearErrorRecoveryTimer();
  _errorRecoveryTimer = setTimeout(() => {
    _errorRecoveryTimer = null;
    commit();
  }, ERROR_RECOVERY_DELAY_MS);
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

// ── Local image cache ─────────────────────────────────────────
// The Gateway doesn't store image attachments in session content blocks,
// so we cache them locally keyed by staged file path (which appears in the
// [media attached: <path> ...] reference in the Gateway's user message text).
// Keying by path avoids the race condition of keying by runId (which is only
// available after the RPC returns, but history may load before that).
const IMAGE_CACHE_KEY = 'clawx:image-cache';
const IMAGE_CACHE_MAX = 100; // max entries to prevent unbounded growth

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, AttachedFileMeta]>;
      return new Map(entries);
    }
  } catch { /* ignore parse errors */ }
  return new Map();
}

function saveImageCache(cache: Map<string, AttachedFileMeta>): void {
  try {
    // Evict oldest entries if over limit
    const entries = Array.from(cache.entries());
    const trimmed = entries.length > IMAGE_CACHE_MAX
      ? entries.slice(entries.length - IMAGE_CACHE_MAX)
      : entries;
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore quota errors */ }
}

const _imageCache = loadImageCache();

function normalizeBlockText(text: string | undefined): string {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
}

function compactProgressiveTextParts(parts: string[]): string[] {
  const compacted: string[] = [];

  for (const part of parts) {
    const current = normalizeBlockText(part);
    if (!current) continue;

    const previous = compacted.at(-1);
    if (!previous) {
      compacted.push(part);
      continue;
    }

    const normalizedPrevious = normalizeBlockText(previous);
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

function normalizeLiveContentBlocks(content: ContentBlock[]): ContentBlock[] {
  return content.map((block) => ({ ...block }));
}

function normalizeStreamingMessage(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message;

  const rawMessage = message as RawMessage;
  const rawContent = rawMessage.content;
  if (!Array.isArray(rawContent)) return rawMessage;

  const normalizedContent = normalizeLiveContentBlocks(rawContent as ContentBlock[]);
  const didChange = normalizedContent.some((block, index) => block !== rawContent[index])
    || normalizedContent.length !== rawContent.length;

  return didChange
    ? { ...rawMessage, content: normalizedContent }
    : rawMessage;
}

/**
 * Strip Gateway-injected metadata that does NOT exist on the renderer's
 * optimistic user message but is echoed back when the Gateway persists it:
 *   - leading sender metadata `Sender (untrusted metadata): ...`
 *   - leading timestamp `[Wed 2026-04-22 10:30 GMT+8] `
 *   - `[message_id: uuid]` tags sprinkled throughout the text
 *   - `[media attached: path (mime) | path]` references appended when the
 *     renderer sends attachments via `chat:sendWithMedia`
 *   - Gateway-injected "Conversation info (untrusted metadata): ..." blocks
 *
 * Keeping this aligned with `cleanUserText` in `pages/Chat/message-utils.ts`
 * is important: the user bubble renders the cleaned text, so the comparison
 * used to dedupe optimistic vs server echoes must operate on the same
 * cleaned form — otherwise the same visible message renders twice.
 *
 * Order matters: the `[media attached: ...]` lines are commonly emitted
 * BETWEEN the Sender block and the `[Mon ... GMT+8]` timestamp prefix.
 * If we strip the timestamp before the media-attached lines, the timestamp
 * regex (`^\s*\[(?:Mon|...)]`) can never match because the leading `[` is
 * `[media attached:` instead — leaving the timestamp in the normalized
 * comparison text and breaking optimistic-vs-echo dedupe.
 */
function stripInboundMediaVisionEnvelope(text: string): string {
  if (!/\[Image\]/i.test(text) && !/^User text:/im.test(text) && !/\nDescription:\s*\n/i.test(text)) {
    return text;
  }

  let result = text.replace(/^\s*\[Image\]\s*\n?/i, '');

  const userTextBlock = result.match(/^User text:\s*\n([\s\S]*?)(?:\n\s*Description:\s*\n[\s\S]*)?\s*$/i);
  if (userTextBlock) {
    const userText = userTextBlock[1].trim();
    return /^Process the attached file\(s\)\.\s*$/i.test(userText) ? '' : userText;
  }

  return result.replace(/\n\s*Description:\s*\n[\s\S]*$/i, '').trim();
}

function stripGatewayUserMetadata(text: string): string {
  return stripInboundMediaVisionEnvelope(
    text
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\s*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, ''),
  );
}

function normalizeComparableUserText(content: unknown): string {
  const text = stripGatewayUserMetadata(getMessageText(content))
    .replace(/\s+/g, ' ')
    .trim();
  if (/^\(file attached\)$/i.test(text)) return '';
  return text;
}

function getComparableAttachmentSignature(message: Pick<RawMessage, '_attachedFiles'>): string {
  const files = (message._attachedFiles || [])
    .map((file) => file.filePath || `${file.fileName}|${file.mimeType}|${file.fileSize}`)
    .filter(Boolean)
    .sort();
  return files.join('::');
}

function matchesOptimisticUserMessage(
  candidate: RawMessage,
  optimistic: RawMessage,
  optimisticTimestampMs: number,
): boolean {
  if (candidate.role !== 'user') return false;

  const optimisticText = normalizeComparableUserText(optimistic.content);
  const candidateText = normalizeComparableUserText(candidate.content);
  const sameText = optimisticText.length > 0 && optimisticText === candidateText;

  const optimisticAttachments = getComparableAttachmentSignature(optimistic);
  const candidateAttachments = getComparableAttachmentSignature(candidate);
  const sameAttachments = optimisticAttachments.length > 0 && optimisticAttachments === candidateAttachments;

  const hasOptimisticTimestamp = Number.isFinite(optimisticTimestampMs) && optimisticTimestampMs > 0;
  const hasCandidateTimestamp = candidate.timestamp != null;
  const timestampMatches = hasOptimisticTimestamp && hasCandidateTimestamp
    ? Math.abs(toMs(candidate.timestamp as number) - optimisticTimestampMs) < OPTIMISTIC_USER_TIMESTAMP_MATCH_MS
    : false;

  if (sameText && sameAttachments) return true;
  if (sameText && (!optimisticAttachments || !candidateAttachments) && (timestampMatches || !hasCandidateTimestamp)) return true;
  if (sameAttachments && (!optimisticText || !candidateText) && (timestampMatches || !hasCandidateTimestamp)) return true;

  const optimisticHadAttachmentsOnly = optimisticAttachments.length > 0 && !optimisticText;
  const candidateIsAttachmentEcho = !candidateText
    && /\[(?:media attached:|\s*Image\s*\])/i.test(getMessageText(candidate.content));
  if (optimisticHadAttachmentsOnly && candidateIsAttachmentEcho && (timestampMatches || !hasCandidateTimestamp)) {
    return true;
  }
  return false;
}

function rememberPendingOptimisticUserMessage(sessionKey: string, message: RawMessage, timestampMs: number): void {
  const now = Date.now();
  const existing = (_pendingOptimisticUserMessages.get(sessionKey) || [])
    .filter((entry) => now - entry.createdAtMs <= OPTIMISTIC_USER_MESSAGE_TTL_MS);
  existing.push({ message, timestampMs, createdAtMs: now });
  _pendingOptimisticUserMessages.set(sessionKey, existing);
}

function clearPendingOptimisticUserMessages(sessionKey: string): void {
  _pendingOptimisticUserMessages.delete(sessionKey);
}

function mergePendingOptimisticUserMessages(sessionKey: string, loadedMessages: RawMessage[]): RawMessage[] {
  const pending = _pendingOptimisticUserMessages.get(sessionKey);
  if (!pending || pending.length === 0) return loadedMessages;

  const now = Date.now();
  let merged = loadedMessages;
  const stillPending: PendingOptimisticUserMessage[] = [];

  for (const entry of pending) {
    if (now - entry.createdAtMs > OPTIMISTIC_USER_MESSAGE_TTL_MS) {
      continue;
    }

    const hasServerEcho = hasOptimisticServerEcho(loadedMessages, entry.message, entry.timestampMs);
    if (hasServerEcho) {
      continue;
    }

    const alreadyRendered = merged.some((message) =>
      message.id === entry.message.id || matchesOptimisticUserMessage(message, entry.message, entry.timestampMs),
    );
    if (!alreadyRendered) {
      const insertAt = merged.findIndex((message) =>
        typeof message.timestamp === 'number' && toMs(message.timestamp) > entry.timestampMs,
      );
      merged = insertAt === -1
        ? [...merged, entry.message]
        : [...merged.slice(0, insertAt), entry.message, ...merged.slice(insertAt)];
    }

    stillPending.push(entry);
  }

  if (stillPending.length > 0) {
    _pendingOptimisticUserMessages.set(sessionKey, stillPending);
  } else {
    _pendingOptimisticUserMessages.delete(sessionKey);
  }

  return merged;
}

function snapshotStreamingAssistantMessage(
  currentStream: RawMessage | null,
  existingMessages: RawMessage[],
  runId: string,
): RawMessage[] {
  if (!currentStream) return [];

  const normalizedStream = normalizeStreamingMessage(currentStream) as RawMessage;
  const streamRole = normalizedStream.role;
  if (streamRole !== 'assistant' && streamRole !== undefined) return [];

  const snapId = normalizedStream.id || `${runId || 'run'}-turn-${existingMessages.length}`;
  if (existingMessages.some((message) => message.id === snapId)) return [];

  return [{
    ...normalizedStream,
    role: 'assistant',
    id: snapId,
  }];
}

function getLatestOptimisticUserMessage(messages: RawMessage[], userTimestampMs: number): RawMessage | undefined {
  return [...messages].reverse().find(
    (message) => message.role === 'user'
      && (!message.timestamp || Math.abs(toMs(message.timestamp) - userTimestampMs) < OPTIMISTIC_USER_TIMESTAMP_MATCH_MS),
  );
}

function hasOptimisticServerEcho(
  loadedMessages: RawMessage[],
  optimistic: RawMessage,
  optimisticTimestampMs: number,
): boolean {
  if (loadedMessages.some((message) =>
    matchesOptimisticUserMessage(message, optimistic, optimisticTimestampMs),
  )) {
    return true;
  }

  const optimisticText = normalizeComparableUserText(optimistic.content);
  if (!optimisticText) return false;

  const matchingUsers = loadedMessages.filter(
    (message) => message.role === 'user'
      && normalizeComparableUserText(message.content) === optimisticText,
  );
  if (matchingUsers.length !== 1) return false;

  const candidate = matchingUsers[0]!;
  if (candidate.timestamp == null) return true;

  return Math.abs(toMs(candidate.timestamp as number) - optimisticTimestampMs) < OPTIMISTIC_USER_TIMESTAMP_MATCH_MS;
}

function dropRedundantOptimisticUserMessages(sessionKey: string, messages: RawMessage[]): RawMessage[] {
  const pending = _pendingOptimisticUserMessages.get(sessionKey);
  if (!pending?.length) return messages;

  const pendingIds = new Set(
    pending
      .map((entry) => entry.message.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  if (pendingIds.size === 0) return messages;

  return messages.filter((message) => {
    if (message.role !== 'user' || !message.id || !pendingIds.has(message.id)) {
      return true;
    }
    const entry = pending.find((candidate) => candidate.message.id === message.id);
    if (!entry) return true;
    return !hasOptimisticServerEcho(
      messages.filter((candidate) => candidate !== message),
      entry.message,
      entry.timestampMs,
    );
  });
}

function upsertImageCacheEntry(filePath: string, file: Omit<AttachedFileMeta, 'filePath'>): void {
  _imageCache.set(filePath, { ...file, filePath });
  saveImageCache(_imageCache);
}

function withAttachedFileSource(
  file: AttachedFileMeta,
  source: AttachedFileMeta['source'],
): AttachedFileMeta {
  return file.source ? file : { ...file, source };
}

/** Extract plain text from message content (string or content blocks) */
function getMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = (content as Array<{ type?: string; text?: string }>)
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!);
    return compactProgressiveTextParts(parts).join('\n');
  }
  return '';
}

function getMessageTextForFilter(msg: { content?: unknown; text?: unknown }): string {
  const fromContent = getMessageText(msg.content);
  if (fromContent.trim()) return fromContent;
  if (typeof msg.text === 'string') return msg.text;
  return '';
}

function getMessageStopReason(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const rawStopReason = msg.stopReason ?? msg.stop_reason;
  if (typeof rawStopReason !== 'string') return null;
  const normalized = rawStopReason.trim().toLowerCase();
  return normalized || null;
}

function getMessageErrorMessage(message: RawMessage | unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const rawError = msg.errorMessage ?? msg.error_message;
  if (typeof rawError !== 'string') return null;
  const normalized = rawError.trim();
  return normalized || null;
}

function isTerminalAssistantErrorMessage(message: RawMessage | unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const msg = message as Record<string, unknown>;
  return msg.role === 'assistant' && getMessageStopReason(message) === 'error';
}

/** Extract media file refs from [media attached: <path> (<mime>) | ...] patterns */
function extractMediaRefs(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const regex = /\[media attached:\s*([^\s(]+)\s*\(([^)]+)\)\s*\|[^\]]*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push({ filePath: match[1], mimeType: match[2] });
  }
  return refs;
}

/** Map common file extensions to MIME types */
function mimeFromExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'svg': 'image/svg+xml',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'html': 'text/html',
    'htm': 'text/html',
    'md': 'text/markdown',
    'rtf': 'application/rtf',
    'epub': 'application/epub+zip',
    // Archives
    'zip': 'application/zip',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    // Video
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    'm4v': 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

/** Extract local file paths declared in tool call arguments. */
function extractFilePathsFromToolArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const direct = args.file_path ?? args.filePath ?? args.path ?? args.file;
  if (typeof direct === 'string' && direct.trim()) paths.push(direct.trim());

  const attachments = args.attachments;
  if (Array.isArray(attachments)) {
    for (const item of attachments) {
      if (!item || typeof item !== 'object') continue;
      const att = item as Record<string, unknown>;
      const filePath = att.filePath ?? att.file_path ?? att.path ?? att.file;
      if (typeof filePath === 'string' && filePath.trim()) {
        paths.push(filePath.trim());
      }
    }
  }

  return paths;
}

/**
 * Surface user-facing attachments declared in assistant tool calls (e.g.
 * `message` tool `attachments: [{ filePath }]`) on the calling turn itself.
 */
function enrichWithToolCallAttachments(messages: RawMessage[]): RawMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;

    const attachmentPaths = new Set<string>();
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content as ContentBlock[]) {
        if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (!args) continue;
        for (const filePath of extractFilePathsFromToolArgs(args)) {
          attachmentPaths.add(filePath);
        }
      }
    }

    const msgAny = msg as unknown as Record<string, unknown>;
    const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        let args: Record<string, unknown> | undefined;
        try {
          args = typeof fn.arguments === 'string'
            ? JSON.parse(fn.arguments)
            : (fn.arguments ?? fn.input) as Record<string, unknown>;
        } catch { /* ignore */ }
        if (!args) continue;
        for (const filePath of extractFilePathsFromToolArgs(args)) {
          attachmentPaths.add(filePath);
        }
      }
    }

    if (attachmentPaths.size === 0) return msg;

    const existingPaths = new Set(
      (msg._attachedFiles || []).map((file) => file.filePath).filter(Boolean),
    );
    const newFiles = [...attachmentPaths]
      .filter((filePath) => !existingPaths.has(filePath))
      .map((filePath) => makeAttachedFile({ filePath, mimeType: mimeFromExtension(filePath) }, 'tool-result'));

    if (newFiles.length === 0) return msg;
    return {
      ...msg,
      _attachedFiles: [...(msg._attachedFiles || []), ...newFiles],
    };
  });
}

const DIRECTORY_MIME_TYPE = 'application/x-directory';

function trimPathTerminators(filePath: string): string {
  return filePath.replace(/[，。；;,.!?]+$/u, '');
}

type MarkdownImageRef =
  | { filePath: string; mimeType: string; fileName: string }
  | { gatewayUrl: string; mimeType: string; fileName: string; source: 'gateway-media' };

/** Extract image targets from markdown `![alt](target)` in assistant text. */
function extractMarkdownImageRefs(text: string): MarkdownImageRef[] {
  if (!text) return [];
  const refs: MarkdownImageRef[] = [];
  const seen = new Set<string>();
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownImageRegex.exec(text)) !== null) {
    const alt = match[1]?.trim() || 'image';
    let target = match[2]?.trim() ?? '';
    if (!target) continue;
    if (target.startsWith('file://')) {
      target = decodeURIComponent(target.replace(/^file:\/\//, ''));
    }
    if (target.startsWith('/api/chat/media/')) {
      if (seen.has(target)) continue;
      seen.add(target);
      refs.push({
        gatewayUrl: target,
        mimeType: 'image/png',
        fileName: alt,
        source: 'gateway-media',
      });
      continue;
    }
    const normalizedPath = trimPathTerminators(target);
    if (!normalizedPath.startsWith('/') && !normalizedPath.startsWith('~/')) continue;
    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    refs.push({
      filePath: normalizedPath,
      mimeType: mimeFromExtension(normalizedPath),
      fileName: alt,
    });
  }
  return refs;
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 *
 * Also recognises the `MEDIA:` / `media:` prefix the OpenClaw runtime
 * emits for produced artifacts (e.g.
 * `MEDIA:/Users/me/.openclaw/media/outbound/report.xlsx`) — without this
 * the leading colon trips the URL guard below and the file goes unsurfaced.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|html?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Tagged media references (MEDIA:/path, media:~/path, ...).  The agent
  // runtime uses this prefix as an explicit "this is an artifact" marker,
  // so we want them recognised even though the leading colon would
  // normally look like a URL scheme.  After matching we punch the entire
  // `MEDIA:<path>` span out of the working text so the generic unix
  // regex below doesn't double-count the bare `/path` suffix.
  // The character class deliberately allows ASCII spaces inside the path so
  // that macOS' default screenshot filename ("截屏 2026-05-06 17.46.51.png")
  // and other space-containing paths the agent emits with the explicit
  // `MEDIA:` marker still resolve. Newline and quote characters remain
  // path terminators so we don't accidentally swallow trailing prose.
  // The non-greedy `*?` anchored to `\.<ext>` keeps the match minimal so
  // multiple `MEDIA:` markers in one paragraph still match independently.
  const taggedRegex = new RegExp(`(?:^|[\\s(\\[{>])(?:MEDIA|media):((?:\\/|~\\/)[^\\n"'()\\[\\],<>` + '`' + `]*?\\.(?:${exts}))(?=$|[\\s\\n"'()\\[\\],<>` + '`' + `]|[，。；;,.!?])`, 'g');
  let workingText = text;
  let taggedMatch: RegExpExecArray | null;
  while ((taggedMatch = taggedRegex.exec(text)) !== null) {
    const p = taggedMatch[1];
    if (p && !seen.has(p)) {
      seen.add(p);
      refs.push({ filePath: p, mimeType: mimeFromExtension(p) });
    }
    // Mask the matched span so subsequent regexes can't re-discover the
    // same path (e.g. `/two.xlsx` from `MEDIA:~/two.xlsx`).
    const start = taggedMatch.index;
    const end = start + taggedMatch[0].length;
    workingText = workingText.slice(0, start) + ' '.repeat(end - start) + workingText.slice(end);
  }
  // Unix absolute paths (/... or ~/...) — lookbehind rejects mid-token slashes
  // (e.g. "path/to/file.mp4", "https://example.com/file.mp4")
  const unixRegex = new RegExp(`(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"'()\`\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  // Windows absolute paths (C:\... D:\...) — lookbehind rejects drive letter glued to a word
  const winRegex = new RegExp(`(?<![\\w])([A-Za-z]:\\\\[^\\s\\n"'()\`\\[\\],<>]*?\\.(?:${exts}))`, 'gi');
  // OpenClaw skill directories do not have file extensions, but they are
  // user-facing artifacts that should render as clickable folder cards.
  const skillPathBoundary = '(?=$|\\s|[\\x5b\\x5d"\'`(),<>，。；;,.!?])';
  const skillPathPart = '[^\\\\/\\s\\n"\'`()\\x5b\\x5d,<>]+';
  const skillPathTail = '[^\\s\\n"\'`()\\x5b\\x5d,<>]*?';
  const skillDirRegex = new RegExp(
    `(?<![\\w./:])((?:~[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathPart})|(?:(?:\\/|[A-Za-z]:\\\\)${skillPathTail}[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathPart}))${skillPathBoundary}`,
    'gi',
  );
  for (const regex of [unixRegex, winRegex, skillDirRegex]) {
    let match;
    while ((match = regex.exec(workingText)) !== null) {
      const p = trimPathTerminators(match[1]);
      if (p && !seen.has(p)) {
        seen.add(p);
        refs.push({
          filePath: p,
          mimeType: regex === skillDirRegex ? DIRECTORY_MIME_TYPE : mimeFromExtension(p),
        });
      }
    }
  }
  return refs;
}

/**
 * Extract images from a content array (including nested tool_result content).
 * Converts them to AttachedFileMeta entries with preview set to data URL or remote URL.
 */
function extractImagesAsAttachedFiles(content: unknown): AttachedFileMeta[] {
  if (!Array.isArray(content)) return [];
  const files: AttachedFileMeta[] = [];

  for (const block of content as ContentBlock[]) {
    if (block.type === 'image') {
      // Path 1: Anthropic source-wrapped format {source: {type, media_type, data}}
      if (block.source) {
        const src = block.source;
        const mimeType = src.media_type || 'image/jpeg';

        if (src.type === 'base64' && src.data) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: `data:${mimeType};base64,${src.data}`,
          });
        } else if (src.type === 'url' && src.url) {
          files.push({
            fileName: 'image',
            mimeType,
            fileSize: 0,
            preview: src.url,
          });
        }
      }
      // Path 2: Flat format from Gateway tool results {data, mimeType}
      else if (block.data) {
        const mimeType = block.mimeType || 'image/jpeg';
        files.push({
          fileName: 'image',
          mimeType,
          fileSize: 0,
          preview: `data:${mimeType};base64,${block.data}`,
        });
      }
      // Path 3: Flat URL form from Gateway-injected assistant-media messages.
      // Shape: `{ type:'image', url:'/api/chat/media/outgoing/<sessionKey>/<id>/full',
      //          mimeType, width, height, alt, openUrl }`. The URL is relative
      // to the Gateway HTTP server which the renderer cannot reach directly
      // (CORS / env drift). We surface it as an `_attachedFiles` entry whose
      // preview is filled in later by `loadMissingPreviews` -> Main proxy.
      else if (block.url) {
        const mimeType = block.mimeType || 'image/jpeg';
        const fileName = typeof block.alt === 'string' && block.alt
          ? block.alt
          : 'image';
        files.push({
          fileName,
          mimeType,
          fileSize: 0,
          preview: null,
          gatewayUrl: block.url,
          source: 'gateway-media',
        });
      }
    }
    // Recurse into tool_result content blocks
    if ((block.type === 'tool_result' || block.type === 'toolResult') && block.content) {
      files.push(...extractImagesAsAttachedFiles(block.content));
    }
  }
  return files;
}

/**
 * Build an AttachedFileMeta entry for a file ref, using cache if available.
 */
function makeAttachedFile(
  ref: { filePath: string; mimeType: string },
  source: AttachedFileMeta['source'] = 'message-ref',
): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath, source };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath, source };
}

/**
 * Extract file path from a tool call's arguments by toolCallId.
 * Searches common argument names: file_path, filePath, path, file.
 */
function getToolCallFilePath(msg: RawMessage, toolCallId: string): string | undefined {
  if (!toolCallId) return undefined;

  // Anthropic/normalized format — toolCall blocks in content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id === toolCallId) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const paths = extractFilePathsFromToolArgs(args);
          if (paths[0]) return paths[0];
        }
      }
    }
  }

  // OpenAI format — tool_calls array on the message itself
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      if (tc.id !== toolCallId) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const paths = extractFilePathsFromToolArgs(args);
        if (paths[0]) return paths[0];
      }
    }
  }

  return undefined;
}

/**
 * Collect all tool call file paths from a message into a Map<toolCallId, filePath>.
 */
function collectToolCallPaths(msg: RawMessage, paths: Map<string, string>): void {
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id) {
        const args = (block.input ?? block.arguments) as Record<string, unknown> | undefined;
        if (args) {
          const filePaths = extractFilePathsFromToolArgs(args);
          if (filePaths[0]) paths.set(block.id, filePaths[0]);
        }
      }
    }
  }
  const msgAny = msg as unknown as Record<string, unknown>;
  const toolCalls = msgAny.tool_calls ?? msgAny.toolCalls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls as Array<Record<string, unknown>>) {
      const id = typeof tc.id === 'string' ? tc.id : '';
      if (!id) continue;
      const fn = (tc.function ?? tc) as Record<string, unknown>;
      let args: Record<string, unknown> | undefined;
      try {
        args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments ?? fn.input) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (args) {
        const filePaths = extractFilePathsFromToolArgs(args);
        if (filePaths[0]) paths.set(id, filePaths[0]);
      }
    }
  }
}

/**
 * Before filtering tool_result messages from history, scan them for any file/image
 * content and attach those to the immediately following assistant message.
 * This mirrors channel push message behavior where tool outputs surface files to the UI.
 * Handles:
 *   - Image content blocks (base64 / url)
 *   - [media attached: path (mime) | path] text patterns in tool result output
 *   - Raw file paths in tool result text
 */
function enrichWithToolResultFiles(messages: RawMessage[]): RawMessage[] {
  const pending: AttachedFileMeta[] = [];
  const toolCallPaths = new Map<string, string>();

  return messages.map((msg) => {
    // Track file paths from assistant tool call arguments for later matching
    if (msg.role === 'assistant') {
      collectToolCallPaths(msg, toolCallPaths);
    }

    if (isToolResultRole(msg.role)) {
      const matchedPath = msg.toolCallId ? toolCallPaths.get(msg.toolCallId) : undefined;

      // 1. Image/file content blocks in the structured content array.
      //    Images embedded inside a tool result are the model's vision data
      //    (e.g. `read /tmp/foo.png` re-encoded as JPEG so the model can
      //    "see" the file) — they are NOT user-facing artifacts. The agent
      //    surfaces user-facing images through `MEDIA:/path` text + the
      //    Gateway's `assistant-media` injection.
      const imageFiles = extractImagesAsAttachedFiles(msg.content)
        .filter(file => !file.mimeType.startsWith('image/'));
      if (matchedPath) {
        for (const f of imageFiles) {
          if (!f.filePath) {
            f.filePath = matchedPath;
            f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
          }
        }
      }
      pending.push(...imageFiles.map((file) => withAttachedFileSource(file, 'tool-result')));

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          pending.push(makeAttachedFile(ref, 'tool-result'));
        }
        // 3. Raw NON-image file paths in tool result text (documents,
        //    audio, video, ...). Image paths from intermediate tool stdout
        //    (`ls -la *.png`, `sips ... && ls`, `file /tmp/x.png`, etc.)
        //    are deliberately ignored — see comment on Path 1.
        for (const ref of extractRawFilePaths(text)) {
          if (mediaRefPaths.has(ref.filePath)) continue;
          if (ref.mimeType.startsWith('image/')) continue;
          pending.push(makeAttachedFile(ref, 'tool-result'));
        }
      }

      return msg; // will be filtered later
    }

    if (msg.role === 'assistant' && pending.length > 0) {
      // Internal-only turns (NO_REPLY, interim narration, ...) must not consume
      // pending attachments — the next visible assistant reply should get them.
      if (isInternalMessage(msg) && !messageHasToolUse(msg)) {
        return msg;
      }
      const toAttach = pending.splice(0);
      // Deduplicate against files already on the assistant message
      const existingPaths = new Set(
        (msg._attachedFiles || []).map(f => f.filePath).filter(Boolean),
      );
      const newFiles = toAttach.filter(f => !f.filePath || !existingPaths.has(f.filePath));
      if (newFiles.length === 0) return msg;
      return {
        ...msg,
        _attachedFiles: [...(msg._attachedFiles || []), ...newFiles],
      };
    }

    return msg;
  });
}

/**
 * Restore _attachedFiles for messages loaded from history.
 * Handles:
 *   1. [media attached: path (mime) | path] patterns (attachment-button flow)
 *   2. Raw image file paths typed in message text (e.g. /Users/.../image.png)
 * Uses local cache for previews when available; missing previews are loaded async.
 */
function enrichWithCachedImages(messages: RawMessage[]): RawMessage[] {
  // Pre-compute, per index, whether the *next* assistant message is a
  // Gateway-injected `assistant-media` bubble (i.e. has at least one
  // `image` content block carrying a flat URL). When that bubble exists,
  // the canonical user-facing rendering of the artifact is the bubble
  // itself — anything the agent emitted via `MEDIA:/path` in its prior
  // text turn would just duplicate the same image, so image-typed raw
  // refs on that prior message are dropped here.
  const nextHasGatewayMediaBubble = messages.map((_, idx) => {
    const next = messages[idx + 1];
    if (!next || next.role !== 'assistant') return false;
    return extractImagesAsAttachedFiles(next.content).some(f => f.gatewayUrl);
  });

  return messages.map((msg, idx) => {
    // Only process user and assistant messages. Messages may already carry
    // attachments from tool-result enrichment; still merge in raw paths from
    // the visible assistant text so `/path/to/report.xlsx` becomes a card.
    if (msg.role !== 'user' && msg.role !== 'assistant') return msg;
    const text = getMessageText(msg.content);

    // Path 0: Gateway-injected outgoing media — `image` content blocks with
    // a flat `url` field (e.g. `/api/chat/media/outgoing/<sessionKey>/<id>/full`).
    // The renderer cannot fetch the URL directly, so we surface it as an
    // `_attachedFiles` entry whose preview is filled in later by
    // `loadMissingPreviews` -> Main `media:getThumbnails` (which dereferences
    // the URL to the original file in `~/.openclaw/media/outgoing/`).
    const gatewayMediaFiles: AttachedFileMeta[] = msg.role === 'assistant'
      ? extractImagesAsAttachedFiles(msg.content).filter(file => file.gatewayUrl)
      : [];

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    // Tool-only messages (thinking + tool calls) should not show file previews — those
    // belong to the final answer message that comes after the tool results.
    // User messages never get raw-path previews so the image is not shown twice.
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => !mediaRefPaths.has(r.filePath));
      const rawPathSet = new Set(rawRefs.map((ref) => ref.filePath));
      for (const ref of extractMarkdownImageRefs(text)) {
        if ('filePath' in ref && !mediaRefPaths.has(ref.filePath) && !rawPathSet.has(ref.filePath)) {
          rawPathSet.add(ref.filePath);
          rawRefs.push({ filePath: ref.filePath, mimeType: ref.mimeType });
        }
      }

      // Nearest preceding user message text (look back up to 5 messages)
      const seenPaths = new Set(rawRefs.map(r => r.filePath));
      for (let i = idx - 1; i >= Math.max(0, idx - 5); i--) {
        const prev = messages[i];
        if (!prev) break;
        if (prev.role === 'user') {
          const prevText = getMessageText(prev.content);
          for (const ref of extractRawFilePaths(prevText)) {
            if (!mediaRefPaths.has(ref.filePath) && !seenPaths.has(ref.filePath)) {
              seenPaths.add(ref.filePath);
              rawRefs.push(ref);
            }
          }
          break; // only use the nearest user message
        }
      }
    }

    // Dedup vs Gateway-injected bubble: when the very next assistant
    // message is an `assistant-media` bubble, drop image-typed raw refs
    // on *this* message — the bubble already covers the artifact.
    if (msg.role === 'assistant' && nextHasGatewayMediaBubble[idx]) {
      rawRefs = rawRefs.filter(r => !r.mimeType.startsWith('image/'));
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    const markdownImageRefs = msg.role === 'assistant' && !isToolOnlyMessage(msg)
      ? extractMarkdownImageRefs(text)
      : [];
    if (
      allRefs.length === 0
      && gatewayMediaFiles.length === 0
      && markdownImageRefs.length === 0
    ) {
      return msg;
    }

    const existingFiles = msg._attachedFiles || [];
    const existingPaths = new Set(existingFiles.map(file => file.filePath).filter(Boolean));
    const existingGatewayUrls = new Set(
      existingFiles.map(file => file.gatewayUrl).filter(Boolean) as string[],
    );
    const files: AttachedFileMeta[] = allRefs
      .filter(ref => !existingPaths.has(ref.filePath))
      .map(ref => {
      const cached = _imageCache.get(ref.filePath);
      if (cached) return { ...cached, filePath: ref.filePath, source: 'message-ref' };
      const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
      return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath, source: 'message-ref' };
    });
    const dedupedGatewayMedia = gatewayMediaFiles.filter(
      file => file.gatewayUrl && !existingGatewayUrls.has(file.gatewayUrl),
    );
    const markdownGatewayMedia: AttachedFileMeta[] = markdownImageRefs
      .filter((ref): ref is Extract<MarkdownImageRef, { gatewayUrl: string }> => 'gatewayUrl' in ref)
      .filter((ref) => ref.gatewayUrl && !existingGatewayUrls.has(ref.gatewayUrl))
      .map((ref) => ({
        fileName: ref.fileName,
        mimeType: ref.mimeType,
        fileSize: 0,
        preview: null,
        gatewayUrl: ref.gatewayUrl,
        source: 'gateway-media' as const,
      }));
    if (files.length === 0 && dedupedGatewayMedia.length === 0 && markdownGatewayMedia.length === 0) return msg;
    return { ...msg, _attachedFiles: [...existingFiles, ...files, ...dedupedGatewayMedia, ...markdownGatewayMedia] };
  });
}

type PreviewRef = { filePath?: string; gatewayUrl?: string; mimeType: string };

const IMAGE_PREVIEW_RETRY_DELAYS_MS = [300, 900, 1800];

function waitForPreviewRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Collect all image refs that need previews. The IPC handler accepts:
//   - { filePath, mimeType }   — local on-disk files
//   - { gatewayUrl, mimeType } — Gateway-injected outgoing media; the
//                                handler resolves the URL to a local file
//                                via `~/.openclaw/media/outgoing/records/`.
// We use `filePath || gatewayUrl` as the dedupe / lookup key on the way
// back; a file always carries at most one of the two.
function collectMissingPreviewRefs(messages: RawMessage[]): PreviewRef[] {
  const needPreview: PreviewRef[] = [];
  const seenKeys = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath OR gatewayUrl
    for (const file of msg._attachedFiles) {
      const key = file.filePath || file.gatewayUrl;
      if (!key || seenKeys.has(key)) continue;
      // Images: need preview. Non-images: need file size (for FileCard display).
      const needsLoad = file.mimeType.startsWith('image/')
        ? !file.preview && file.previewStatus !== 'unavailable'
        : file.fileSize === 0;
      if (!needsLoad) continue;
      seenKeys.add(key);
      if (file.filePath) {
        needPreview.push({ filePath: file.filePath, mimeType: file.mimeType });
      } else if (file.gatewayUrl) {
        needPreview.push({ gatewayUrl: file.gatewayUrl, mimeType: file.mimeType });
      }
    }

    // Path 2: [media attached: ...] patterns (legacy — in case filePath wasn't stored)
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || seenKeys.has(ref.filePath)) continue;
        const needsLoad = ref.mimeType.startsWith('image/')
          ? !file.preview && file.previewStatus !== 'unavailable'
          : file.fileSize === 0;
        if (needsLoad) {
          seenKeys.add(ref.filePath);
          needPreview.push({ filePath: ref.filePath, mimeType: ref.mimeType });
        }
      }
    }
  }

  return needPreview;
}

function applyPreviewResults(
  messages: RawMessage[],
  thumbnails: Record<string, { preview: string | null; fileSize: number }>,
): boolean {
  let updated = false;

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Update files that have filePath OR gatewayUrl
    for (const file of msg._attachedFiles) {
      const key = file.filePath || file.gatewayUrl;
      if (!key) continue;
      const thumb = thumbnails[key];
      if (thumb && (thumb.preview || thumb.fileSize)) {
        if (thumb.preview) file.preview = thumb.preview;
        if (thumb.fileSize) file.fileSize = thumb.fileSize;
        delete file.previewStatus;
        // Only persist local-path entries to the localStorage cache.
        // Gateway outgoing URLs are tied to a specific session/attachment
        // id and can be stale across runs, so caching is harmful.
        if (file.filePath) {
          _imageCache.set(file.filePath, { ...file });
        }
        updated = true;
      }
    }

    // Legacy: update by index for [media attached: ...] refs
    if (msg.role === 'user') {
      const text = getMessageText(msg.content);
      const refs = extractMediaRefs(text);
      for (let i = 0; i < refs.length; i++) {
        const file = msg._attachedFiles[i];
        const ref = refs[i];
        if (!file || !ref || file.filePath) continue; // skip if already handled via filePath
        const thumb = thumbnails[ref.filePath];
        if (thumb && (thumb.preview || thumb.fileSize)) {
          if (thumb.preview) file.preview = thumb.preview;
          if (thumb.fileSize) file.fileSize = thumb.fileSize;
          delete file.previewStatus;
          _imageCache.set(ref.filePath, { ...file });
          updated = true;
        }
      }
    }
  }

  if (updated) saveImageCache(_imageCache);
  return updated;
}

function markMissingImagePreviewsUnavailable(messages: RawMessage[]): boolean {
  let updated = false;
  for (const msg of messages) {
    if (!msg._attachedFiles) continue;
    for (const file of msg._attachedFiles) {
      if (!file.mimeType.startsWith('image/')) continue;
      if (file.preview || file.previewStatus === 'unavailable') continue;
      if (!file.filePath && !file.gatewayUrl) continue;
      file.previewStatus = 'unavailable';
      updated = true;
    }
  }
  return updated;
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  let updatedAny = false;
  let attempt = 0;

  while (true) {
    const needPreview = collectMissingPreviewRefs(messages);
    if (needPreview.length === 0) return updatedAny;
    if (attempt > 0) {
      const delayMs = IMAGE_PREVIEW_RETRY_DELAYS_MS[attempt - 1];
      if (delayMs) await waitForPreviewRetry(delayMs);
    }

    try {
      const thumbnails = await invokeIpc(
        'media:getThumbnails',
        needPreview,
      ) as Record<string, { preview: string | null; fileSize: number }>;
      if (applyPreviewResults(messages, thumbnails)) {
        updatedAny = true;
      }
    } catch (err) {
      console.warn('[loadMissingPreviews] Failed:', err);
      return updatedAny;
    }

    if (!collectMissingPreviewRefs(messages).some((ref) => ref.mimeType.startsWith('image/'))) {
      return updatedAny;
    }
    if (attempt >= IMAGE_PREVIEW_RETRY_DELAYS_MS.length) {
      return markMissingImagePreviewsUnavailable(messages) || updatedAny;
    }
    attempt += 1;
  }
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function isToolOnlyMessage(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (isToolResultRole(message.role)) return true;

  const msg = message as unknown as Record<string, unknown>;
  const content = message.content;

  // Check OpenAI-format tool_calls field (real-time streaming from OpenAI-compatible models)
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  const hasOpenAITools = Array.isArray(toolCalls) && toolCalls.length > 0;

  if (!Array.isArray(content)) {
    // Content is not an array — check if there's OpenAI-format tool_calls
    if (hasOpenAITools) {
      // Has tool calls but content might be empty/string — treat as tool-only
      // if there's no meaningful text content
      const textContent = typeof content === 'string' ? content.trim() : '';
      return textContent.length === 0;
    }
    return false;
  }

  let hasTool = hasOpenAITools;
  let hasText = false;
  let hasNonToolContent = false;

  for (const block of content as ContentBlock[]) {
    if (block.type === 'tool_use' || block.type === 'tool_result' || block.type === 'toolCall' || block.type === 'toolResult') {
      hasTool = true;
      continue;
    }
    if (block.type === 'text' && block.text && block.text.trim()) {
      hasText = true;
      continue;
    }
    // Only actual image output disqualifies a tool-only message.
    // Thinking blocks are internal reasoning that can accompany tool_use — they
    // should NOT prevent the message from being treated as an intermediate tool step.
    if (block.type === 'image') {
      hasNonToolContent = true;
    }
  }

  return hasTool && !hasText && !hasNonToolContent;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function messageHasToolUse(msg: { role?: unknown; content?: unknown; tool_calls?: unknown; toolCalls?: unknown }): boolean {
  if (msg.role !== 'assistant') return false;
  if (Array.isArray(msg.content)) {
    const blocks = msg.content as ContentBlock[];
    if (blocks.some((block) => block.type === 'tool_use' || block.type === 'toolCall')) {
      return true;
    }
  }
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/** True for internal plumbing messages that should never be shown in the UI. */
function isInternalMessage(msg: { role?: unknown; content?: unknown; text?: unknown }): boolean {
  if (msg.role === 'system') return true;
  const text = getMessageTextForFilter(msg);
  if (msg.role === 'assistant') {
    if (isInternalAssistantReplyText(text)) return true;
    if (isGeneratingStatusNarration(text)) return true;
    if (!text.trim() && Array.isArray(msg.content)) {
      const blocks = msg.content as ContentBlock[];
      const hasThinking = blocks.some((block) => block.type === 'thinking' && block.thinking?.trim());
      const hasVisibleText = blocks.some((block) => block.type === 'text' && block.text?.trim());
      if (hasThinking && !hasVisibleText) return true;
    }
  }
  if (msg.role === 'user' && /^\[OpenClaw heartbeat poll\]\s*$/i.test(text.trim())) return true;
  // Runtime system injections: these arrive as user or assistant-role messages
  // but are internal plumbing (exec results, async-command notices, time pings, etc.)
  if ((msg.role === 'user' || msg.role === 'assistant') && isRuntimeSystemInjection(text)) return true;
  return false;
}

/**
 * History filtering must keep assistant tool-call turns even when their visible
 * text is internal narration (e.g. "生成中，稍等" + `image_generate`). Those
 * turns power the execution graph and run lifecycle detection.
 */
function shouldDropMessageFromHistory(msg: { role?: unknown; content?: unknown; text?: unknown; tool_calls?: unknown; toolCalls?: unknown }): boolean {
  if (isToolResultRole(msg.role)) return true;
  if (messageHasToolUse(msg)) return false;
  return isInternalMessage(msg);
}

/**
 * Detect runtime-injected system messages that should be hidden from the chat UI.
 * These are injected by the OpenClaw runtime as user-role messages and include:
 *   - "System (untrusted): ..." — exec results, tool output, etc.
 *   - "An async command you ran earlier has completed" — async completion notices
 *   - "Current time: ..." followed by nothing else — periodic heartbeat time pings
 *   - "Handle the result internally. Do not relay it to the user" — internal directives
 */
function isRuntimeSystemInjection(text: string): boolean {
  if (!text) return false;
  const normalized = text.trim();
  // "System (untrusted): ..." at the start (with optional leading whitespace)
  if (/^\s*System\s*\(untrusted\)\s*:/i.test(normalized)) return true;

  // Async command completion notice + internal relay directive commonly arrive together.
  // Require both markers to avoid hiding normal conversational text that quotes one phrase.
  if (
    /An async command you ran earlier has completed/i.test(normalized)
    && /Do not relay it to the user unless explicitly requested/i.test(normalized)
  ) {
    return true;
  }

  if (/^\[Inter-session message\]/i.test(normalized)) return true;

  if (isOpenClawRuntimeEventPrompt(normalized)) return true;

  // Standalone time injection
  if (
    /^\s*Current time\s*:/i.test(normalized)
    && /^\s*Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return compactProgressiveTextParts(parts).join('\n');
}

function summarizeToolOutput(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const summaryLines = lines.slice(0, 2);
  let summary = summaryLines.join(' / ');
  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }
  return summary;
}

function normalizeToolStatus(rawStatus: unknown, fallback: 'running' | 'completed'): ToolStatus['status'] {
  const status = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'completed' || status === 'success' || status === 'done') return 'completed';
  return fallback;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractToolUseUpdates(message: unknown): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const updates: ToolStatus[] = [];

  // Path 1: Anthropic/normalized format — tool blocks inside content array
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if ((block.type !== 'tool_use' && block.type !== 'toolCall') || !block.name) continue;
      updates.push({
        id: block.id || block.name,
        toolCallId: block.id,
        name: block.name,
        status: 'running',
        updatedAt: Date.now(),
      });
    }
  }

  // Path 2: OpenAI format — tool_calls array on the message itself
  if (updates.length === 0) {
    const toolCalls = msg.tool_calls ?? msg.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls as Array<Record<string, unknown>>) {
        const fn = (tc.function ?? tc) as Record<string, unknown>;
        const name = typeof fn.name === 'string' ? fn.name : '';
        if (!name) continue;
        const id = typeof tc.id === 'string' ? tc.id : name;
        updates.push({
          id,
          toolCallId: typeof tc.id === 'string' ? tc.id : undefined,
          name,
          status: 'running',
          updatedAt: Date.now(),
        });
      }
    }
  }

  return updates;
}

function extractToolResultBlocks(message: unknown, eventState: string): ToolStatus[] {
  if (!message || typeof message !== 'object') return [];
  const msg = message as Record<string, unknown>;
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_result' && block.type !== 'toolResult') continue;
    const outputText = extractTextFromContent(block.content ?? block.text ?? '');
    const summary = summarizeToolOutput(outputText);
    updates.push({
      id: block.id || block.name || 'tool',
      toolCallId: block.id,
      name: block.name || block.id || 'tool',
      status: normalizeToolStatus(undefined, eventState === 'delta' ? 'running' : 'completed'),
      summary,
      updatedAt: Date.now(),
    });
  }

  return updates;
}

function extractToolResultUpdate(message: unknown, eventState: string): ToolStatus | null {
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : '';
  if (!isToolResultRole(role)) return null;

  const toolName = typeof msg.toolName === 'string' ? msg.toolName : (typeof msg.name === 'string' ? msg.name : '');
  const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined;
  const details = (msg.details && typeof msg.details === 'object') ? msg.details as Record<string, unknown> : undefined;
  const rawStatus = (msg.status ?? details?.status);
  const fallback = eventState === 'delta' ? 'running' : 'completed';
  const status = normalizeToolStatus(rawStatus, fallback);
  const durationMs = parseDurationMs(details?.durationMs ?? details?.duration ?? (msg as Record<string, unknown>).durationMs);

  const outputText = (details && typeof details.aggregated === 'string')
    ? details.aggregated
    : extractTextFromContent(msg.content);
  const summary = summarizeToolOutput(outputText) ?? summarizeToolOutput(String(details?.error ?? msg.error ?? ''));

  const name = toolName || toolCallId || 'tool';
  const id = toolCallId || name;

  return {
    id,
    toolCallId,
    name,
    status,
    durationMs,
    summary,
    updatedAt: Date.now(),
  };
}

function mergeToolStatus(existing: ToolStatus['status'], incoming: ToolStatus['status']): ToolStatus['status'] {
  const order: Record<ToolStatus['status'], number> = { running: 0, completed: 1, error: 2 };
  return order[incoming] >= order[existing] ? incoming : existing;
}

function upsertToolStatuses(current: ToolStatus[], updates: ToolStatus[]): ToolStatus[] {
  if (updates.length === 0) return current;
  const next = [...current];
  for (const update of updates) {
    const key = update.toolCallId || update.id || update.name;
    if (!key) continue;
    const index = next.findIndex((tool) => (tool.toolCallId || tool.id || tool.name) === key);
    if (index === -1) {
      next.push(update);
      continue;
    }
    const existing = next[index];
    next[index] = {
      ...existing,
      ...update,
      name: update.name || existing.name,
      status: mergeToolStatus(existing.status, update.status),
      durationMs: update.durationMs ?? existing.durationMs,
      summary: update.summary ?? existing.summary,
      updatedAt: update.updatedAt || existing.updatedAt,
    };
  }
  return next;
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

/**
 * True when an assistant message carries user-visible final output (text or
 * image). NOTE: `thinking` blocks are intentionally excluded — they are the
 * model's internal monologue and frequently precede tool calls in models like
 * MiniMax-M2.7 and gpt-5.5. Treating thinking as "final content" causes the
 * history-poll closer in applyLoadedMessages and the runtime final handler to
 * misclassify intermediate `[thinking, toolCall]` turns as completed replies,
 * which prematurely tears down the `sending` / `activeRunId` / `pendingFinal`
 * lifecycle flags and makes the Thinking… indicator vanish mid-tool-chain.
 */
function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

/**
 * True when an assistant message is still waiting on a tool result, i.e. it
 * represents an intermediate tool-use turn rather than a finished reply.
 * Detected via:
 *   - explicit stop_reason = "tool_use" / "toolUse"
 *   - any tool_use / toolCall block in `content`
 *   - OpenAI-format `tool_calls` array
 * Used by applyLoadedMessages and the runtime `final` handler to keep the
 * `sending` / `activeRunId` / `pendingFinal` flags armed across tool rounds.
 */
function hasPendingToolUse(message: RawMessage | undefined): boolean {
  if (!message) return false;
  const reason = getMessageStopReason(message);
  if (reason === 'tool_use' || reason === 'tooluse') return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'tool_use' || block.type === 'toolCall') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  const toolCalls = msg.tool_calls ?? msg.toolCalls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) return true;

  return false;
}

function setHistoryPollTimer(timer: ReturnType<typeof setTimeout> | null): void {
  _historyPollTimer = timer;
}

function hasErrorRecoveryTimer(): boolean {
  return _errorRecoveryTimer != null;
}

function setLastChatEventAt(value: number): void {
  _lastChatEventAt = value;
}

function getLastChatEventAt(): number {
  return _lastChatEventAt;
}

function setLastAbortedRunId(id: string | null): void {
  _lastAbortedRunId = id;
}

function getLastAbortedRunId(): string | null {
  return _lastAbortedRunId;
}

function queueBlockedRunEvent(runId: string, event: Record<string, unknown>): void {
  const events = _blockedRunEvents.get(runId) ?? [];
  events.push({ ...event });
  if (events.length > 100) events.shift();
  _blockedRunEvents.set(runId, events);
}

function isRealUserBoundaryMessage(msg: RawMessage): boolean {
  if (msg.role !== 'user') return false;
  if (!Array.isArray(msg.content)) return true;
  const blocks = msg.content as ContentBlock[];
  return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
}

function hasAssistantAfterLastRealUser(messages: RawMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isRealUserBoundaryMessage(messages[i])) {
      return messages.slice(i + 1).some((m) => m.role === 'assistant');
    }
  }
  return false;
}

function hasAssistantProgressSinceSend(messages: RawMessage[], lastUserMessageAt: number | null): boolean {
  if (!lastUserMessageAt) return false;
  const normalized = [...messages];
  while (normalized.length > 0) {
    const last = normalized[normalized.length - 1];
    if (last.role === 'user' && !last.timestamp) {
      normalized.pop();
      continue;
    }
    break;
  }
  return hasAssistantAfterLastRealUser(normalized);
}

function takeBlockedRunEvents(runId: string): Record<string, unknown>[] {
  const events = _blockedRunEvents.get(runId) ?? [];
  _blockedRunEvents.delete(runId);
  return events;
}

export {
  toMs,
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  extractImagesAsAttachedFiles,
  getMessageText,
  getMessageStopReason,
  getMessageErrorMessage,
  isTerminalAssistantErrorMessage,
  extractMediaRefs,
  extractRawFilePaths,
  makeAttachedFile,
  enrichWithToolResultFiles,
  enrichWithToolCallAttachments,
  isInternalMessage,
  shouldDropMessageFromHistory,
  isToolResultRole,
  enrichWithCachedImages,
  loadMissingPreviews,
  upsertImageCacheEntry,
  getCanonicalPrefixFromSessions,
  getToolCallFilePath,
  collectToolUpdates,
  upsertToolStatuses,
  hasNonToolAssistantContent,
  hasPendingToolUse,
  hasAssistantAfterLastRealUser,
  hasAssistantProgressSinceSend,
  isToolOnlyMessage,
  normalizeStreamingMessage,
  matchesOptimisticUserMessage,
  rememberPendingOptimisticUserMessage,
  clearPendingOptimisticUserMessages,
  mergePendingOptimisticUserMessages,
  snapshotStreamingAssistantMessage,
  getLatestOptimisticUserMessage,
  hasOptimisticServerEcho,
  dropRedundantOptimisticUserMessages,
  setHistoryPollTimer,
  hasErrorRecoveryTimer,
  scheduleRecoverableRuntimeError,
  isRecoverableRuntimeError,
  setLastChatEventAt,
  getLastChatEventAt,
  setLastAbortedRunId,
  getLastAbortedRunId,
  queueBlockedRunEvent,
  takeBlockedRunEvents,
};
