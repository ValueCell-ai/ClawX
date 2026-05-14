/**
 * Chat State Store
 * Manages chat messages, sessions, and streaming state.
 * Communicates with OpenClaw Gateway via renderer WebSocket RPC.
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useGatewayStore } from './gateway';
import { useAgentsStore } from './agents';
import { buildBaselineRunKey, captureBaseline, clearBaselines } from './baseline-cache';
import { buildCronSessionHistoryPath, isCronSessionKey } from './chat/cron-session-utils';
import {
  CHAT_HISTORY_DISK_FALLBACK_TIMEOUT_MS,
  CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS,
  classifyHistoryStartupRetryError,
  getHistoryLoadingSafetyTimeout,
  getStartupHistoryTimeoutOverride,
  shouldRetryStartupHistoryLoad,
  sleep,
} from './chat/history-startup-retry';
import {
  LABEL_FETCH_RETRY_DELAYS_MS,
  abandonSessionLabelHydration,
  beginSessionLabelHydration,
  clearSessionLabelHydrationTracking,
  finishSessionLabelHydration,
  getSessionLabelHydrationCandidate,
} from './chat/session-label-hydration';
import {
  DEFAULT_CANONICAL_PREFIX,
  DEFAULT_SESSION_KEY,
  type AttachedFileMeta,
  type ChatSession,
  type ChatState,
  type ContentBlock,
  type RawMessage,
  type ToolStatus,
} from './chat/types';
import type { ChatGet, ChatSet } from './chat/store-api';

export type {
  AttachedFileMeta,
  ChatSession,
  ContentBlock,
  RawMessage,
  ToolStatus,
} from './chat/types';

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
let _loadSessionsInFlight: Promise<void> | null = null;
let _lastLoadSessionsAt = 0;
const _historyLoadInFlight = new Map<string, Promise<void>>();
const _lastHistoryLoadAtBySession = new Map<string, number>();
const _forceNextHistoryLoadBySession = new Set<string>();
const _foregroundHistoryLoadSeen = new Set<string>();
const _sessionHistoryCache = new Map<string, { messages: RawMessage[]; thinkingLevel: string | null }>();
const SESSION_LOAD_MIN_INTERVAL_MS = 1_200;
const HISTORY_LOAD_MIN_INTERVAL_MS = 800;
const HISTORY_POLL_SILENCE_WINDOW_MS = 2_500;
const CHAT_EVENT_DEDUPE_TTL_MS = 30_000;
const HISTORY_PAGE_SIZE = 200;
const HISTORY_MAX_RENDERED_MESSAGES = 1_000;
const _chatEventDedupe = new Map<string, number>();

type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
};

function getSessionBackendLabel(session: ChatSession): string {
  return toSessionLabel(session.label || session.derivedTitle || '');
}

function applySessionBackendLabels(set: ChatSet, sessions: ChatSession[]): void {
  const labels = Object.fromEntries(
    sessions
      .filter((session) => !session.key.endsWith(':main'))
      .map((session) => [session.key, getSessionBackendLabel(session)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (Object.keys(labels).length === 0) return;
  set((state) => ({
    sessionLabels: {
      ...state.sessionLabels,
      ...Object.fromEntries(
        Object.entries(labels).filter(([key]) => !state.sessionLabels[key]),
      ),
    },
  }));
}

async function fetchSessionLabelSummaries(sessionKeys: string[]): Promise<SessionLabelSummary[]> {
  if (sessionKeys.length === 0) return [];
  const response = await hostApiFetch<{
    success?: boolean;
    summaries?: SessionLabelSummary[];
  }>('/api/sessions/summaries', {
    method: 'POST',
    body: JSON.stringify({ sessionKeys }),
  });
  return Array.isArray(response?.summaries) ? response.summaries : [];
}

function applySessionLabelSummaries(
  set: ChatSet,
  summaries: SessionLabelSummary[],
): void {
  if (summaries.length === 0) return;
  set((state) => {
    let nextLabels = state.sessionLabels;
    let nextActivity = state.sessionLastActivity;
    let changed = false;

    for (const summary of summaries) {
      const labelText = toSessionLabel(summary.firstUserText || '');
      if (labelText) {
        if (nextLabels[summary.sessionKey] !== labelText) {
          if (nextLabels === state.sessionLabels) {
            nextLabels = { ...state.sessionLabels };
          }
          nextLabels[summary.sessionKey] = labelText;
          changed = true;
        }
      }

      if (typeof summary.lastTimestamp === 'number' && Number.isFinite(summary.lastTimestamp)) {
        if (nextActivity[summary.sessionKey] !== summary.lastTimestamp) {
          if (nextActivity === state.sessionLastActivity) {
            nextActivity = { ...state.sessionLastActivity };
          }
          nextActivity[summary.sessionKey] = summary.lastTimestamp;
          changed = true;
        }
      }
    }

    return changed
      ? {
        sessionLabels: nextLabels,
        sessionLastActivity: nextActivity,
      }
      : {};
  });
}

async function refreshVisibleSessionSummaries(
  set: ChatSet,
  get: ChatGet,
  sessionKeys?: string[],
): Promise<void> {
  const sessions = get().sessions;
  const currentSessionKey = get().currentSessionKey;
  const targetKeys = (sessionKeys && sessionKeys.length > 0
    ? sessionKeys
    : sessions.map((session) => session.key)
  )
    .filter((key) => key && !key.endsWith(':main') && key !== currentSessionKey);
  if (targetKeys.length === 0) return;

  try {
    const summaries = await fetchSessionLabelSummaries(targetKeys);
    applySessionLabelSummaries(set, summaries);
  } catch (error) {
    console.warn('[session summaries] refresh failed:', error);
  }
}

function cleanSessionLabelText(text: string): string {
  return text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
}

function toSessionLabel(text: string, maxLength = 50): string {
  const cleaned = cleanSessionLabelText(text).trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

async function loadSessionTranscriptFallback(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  try {
    const params = new URLSearchParams({ sessionKey, limit: String(limit) });
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      `/api/sessions/transcript?${params.toString()}`,
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('[chat.history] transcript fallback failed:', error);
    return [];
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadLocalHistoryFallback(
  sessionKey: string,
  limit = 200,
  options: { timeoutMs?: number; logTimeout?: boolean } = {},
): Promise<RawMessage[]> {
  const fallbackPromise = isCronSessionKey(sessionKey)
    ? loadCronFallbackMessages(sessionKey, limit)
    : loadSessionTranscriptFallback(sessionKey, limit);
  const timeoutMs = options.timeoutMs ?? CHAT_HISTORY_DISK_FALLBACK_TIMEOUT_MS;
  if (timeoutMs <= 0) {
    return [];
  }
  return withTimeout(fallbackPromise, timeoutMs).catch((error) => {
    if (options.logTimeout !== false) {
      console.warn('[chat.history] local fallback timed out:', error);
    }
    return [];
  });
}

function clearErrorRecoveryTimer(): void {
  if (_errorRecoveryTimer) {
    clearTimeout(_errorRecoveryTimer);
    _errorRecoveryTimer = null;
  }
}

function clearHistoryPoll(): void {
  if (_historyPollTimer) {
    clearTimeout(_historyPollTimer);
    _historyPollTimer = null;
  }
}

function forceNextHistoryLoad(sessionKey: string): void {
  _forceNextHistoryLoadBySession.add(sessionKey);
}

function cloneHistoryMessages(messages: RawMessage[]): RawMessage[] {
  return messages.map((message) => ({
    ...message,
    _attachedFiles: message._attachedFiles?.map((file) => ({ ...file })),
  }));
}

function cacheSessionHistory(sessionKey: string, messages: RawMessage[], thinkingLevel: string | null): void {
  _sessionHistoryCache.set(sessionKey, {
    messages: cloneHistoryMessages(messages),
    thinkingLevel,
  });
}

function getCachedSessionHistory(sessionKey: string): { messages: RawMessage[]; thinkingLevel: string | null } | null {
  const cached = _sessionHistoryCache.get(sessionKey);
  if (!cached) return null;
  return {
    messages: cloneHistoryMessages(cached.messages),
    thinkingLevel: cached.thinkingLevel,
  };
}

function clearCachedSessionHistory(sessionKey: string): void {
  _sessionHistoryCache.delete(sessionKey);
}

function getHistoryForegroundLoadKey(sessionKey: string): string {
  const gatewayState = useGatewayStore.getState?.() as { status?: { pid?: number; connectedAt?: number; port?: number } } | undefined;
  const gatewayStatus = gatewayState?.status;
  const gatewayRuntimeKey = `${gatewayStatus?.pid ?? 'none'}:${gatewayStatus?.connectedAt ?? 'none'}:${gatewayStatus?.port ?? 'none'}`;
  return `${gatewayRuntimeKey}|${sessionKey}`;
}

function pruneChatEventDedupe(now: number): void {
  for (const [key, ts] of _chatEventDedupe.entries()) {
    if (now - ts > CHAT_EVENT_DEDUPE_TTL_MS) {
      _chatEventDedupe.delete(key);
    }
  }
}

function buildChatEventDedupeKey(eventState: string, event: Record<string, unknown>): string | null {
  const runId = event.runId != null ? String(event.runId) : '';
  const sessionKey = event.sessionKey != null ? String(event.sessionKey) : '';
  const seq = event.seq != null ? String(event.seq) : '';
  // Some gateways emit multiple `delta` updates without a monotonically
  // increasing `seq`. Deduping those by just `runId + sessionKey + state`
  // collapses legitimate stream progression, so only seq-backed deltas are
  // safe to dedupe generically.
  if (eventState === 'delta' && !seq) {
    return null;
  }
  if (runId || sessionKey || seq || eventState) {
    return [runId, sessionKey, seq, eventState].join('|');
  }
  const msg = (event.message && typeof event.message === 'object')
    ? event.message as Record<string, unknown>
    : null;
  if (msg) {
    const messageId = msg.id != null ? String(msg.id) : '';
    const stopReason = msg.stopReason ?? msg.stop_reason;
    if (messageId || stopReason) {
      return `msg|${messageId}|${String(stopReason ?? '')}|${eventState}`;
    }
  }
  return null;
}

function getFinalMessageIdDedupeKey(eventState: string, event: Record<string, unknown>): string | null {
  if (eventState !== 'final') return null;
  const msg = (event.message && typeof event.message === 'object')
    ? event.message as Record<string, unknown>
    : null;
  if (msg?.id != null) return `final-msgid|${String(msg.id)}`;
  return null;
}

function isDuplicateChatEvent(eventState: string, event: Record<string, unknown>): boolean {
  const key = buildChatEventDedupeKey(eventState, event);
  const msgKey = getFinalMessageIdDedupeKey(eventState, event);
  if (!key && !msgKey) return false;
  const now = Date.now();
  pruneChatEventDedupe(now);
  if ((key && _chatEventDedupe.has(key)) || (msgKey && _chatEventDedupe.has(msgKey))) {
    return true;
  }
  if (key) _chatEventDedupe.set(key, now);
  if (msgKey) _chatEventDedupe.set(msgKey, now);
  return false;
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
 */
function stripGatewayUserMetadata(text: string): string {
  return text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^\s*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '');
}

function normalizeComparableUserText(content: unknown): string {
  return stripGatewayUserMetadata(getMessageText(content))
    .replace(/\s+/g, ' ')
    .trim();
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
    ? Math.abs(toMs(candidate.timestamp as number) - optimisticTimestampMs) < 5000
    : false;

  if (sameText && sameAttachments) return true;
  if (sameText && (!optimisticAttachments || !candidateAttachments) && (timestampMatches || !hasCandidateTimestamp)) return true;
  if (sameAttachments && (!optimisticText || !candidateText) && (timestampMatches || !hasCandidateTimestamp)) return true;
  return false;
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
    (message) => message.role === 'user' && (!message.timestamp || Math.abs(toMs(message.timestamp) - userTimestampMs) < 5000),
  );
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

const DIRECTORY_MIME_TYPE = 'application/x-directory';

function trimPathTerminators(filePath: string): string {
  return filePath.replace(/[，。；;,.!?]+$/u, '');
}

/**
 * Extract raw file paths from message text.
 * Detects absolute paths (Unix: / or ~/, Windows: C:\ etc.) ending with common file extensions.
 * Handles both image and non-image files, consistent with channel push message behavior.
 *
 * Also recognises the `MEDIA:` / `media:` prefix the OpenClaw runtime
 * emits for produced artifacts (e.g.
 * `MEDIA:/tmp/desktop_screenshot.png`) — without this the leading colon
 * trips the URL guard on the unix regex below and the artifact never
 * surfaces as an attachment. Mirrors `chat/helpers.ts::extractRawFilePaths`.
 */
function extractRawFilePaths(text: string): Array<{ filePath: string; mimeType: string }> {
  const refs: Array<{ filePath: string; mimeType: string }> = [];
  const seen = new Set<string>();
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  // Tagged media references (MEDIA:/path, media:~/path, ...). The agent
  // runtime uses this prefix as an explicit "this is an artifact" marker,
  // so we want them recognised even though the leading colon would
  // normally look like a URL scheme. After matching we punch the entire
  // `MEDIA:<path>` span out of the working text so the generic unix
  // regex below doesn't double-count the bare `/path` suffix.
  // The character class deliberately allows ASCII spaces inside the path so
  // that macOS' default screenshot filename ("截屏 2026-05-06 17.46.51.png")
  // and other space-containing paths the agent emits with the explicit
  // `MEDIA:` marker still resolve. Newline and quote characters remain
  // path terminators so we don't accidentally swallow trailing prose.
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
      // See `src/stores/chat/helpers.ts` for the canonical implementation.
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
function makeAttachedFile(ref: { filePath: string; mimeType: string }): AttachedFileMeta {
  const cached = _imageCache.get(ref.filePath);
  if (cached) return { ...cached, filePath: ref.filePath };
  const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
  return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath };
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
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') return fp;
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
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') return fp;
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
          const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
          if (typeof fp === 'string') paths.set(block.id, fp);
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
        const fp = args.file_path ?? args.filePath ?? args.path ?? args.file;
        if (typeof fp === 'string') paths.set(id, fp);
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
      // Resolve file path from the matching tool call
      const matchedPath = msg.toolCallId ? toolCallPaths.get(msg.toolCallId) : undefined;

      // 1. Image/file content blocks in the structured content array.
      //    Images embedded inside a tool result are the model's vision data
      //    (e.g. `read /tmp/foo.png` re-encoded as JPEG so the model can "see"
      //    the file) — they are NOT user-facing artifacts. The agent surfaces
      //    user-facing images through `MEDIA:/path` text + the Gateway's
      //    `assistant-media` injection. Surfacing the vision data here would
      //    duplicate every screenshot the agent inspects.
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
      // Tag all files from tool results so ChatMessage can suppress them
      // in segments that already have an ExecutionGraphCard.
      for (const f of imageFiles) f.source = 'tool-result';
      pending.push(...imageFiles);

      // 2. [media attached: ...] patterns in tool result text output
      const text = getMessageText(msg.content);
      if (text) {
        const mediaRefs = extractMediaRefs(text);
        const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
        for (const ref of mediaRefs) {
          pending.push({ ...makeAttachedFile(ref), source: 'tool-result' });
        }
        // 3. Raw NON-image file paths in tool result text (documents,
        //    audio, video, ...). Image paths are deliberately ignored:
        //    `ls -la /tmp/foo.png`, `sips ... && ls -la *.jpg`, etc.
        //    spam intermediate paths that the user does not want to see
        //    rendered as separate cards. The canonical user-facing image
        //    is whatever the agent later emits via `MEDIA:/path` (which
        //    the Gateway turns into a dedicated assistant-media bubble).
        for (const ref of extractRawFilePaths(text)) {
          if (mediaRefPaths.has(ref.filePath)) continue;
          if (ref.mimeType.startsWith('image/')) continue;
          pending.push({ ...makeAttachedFile(ref), source: 'tool-result' });
        }
      }

      return msg; // will be filtered later
    }

    if (msg.role === 'assistant' && pending.length > 0) {
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
  // refs on that prior message should be dropped here.
  const nextHasGatewayMediaBubble = messages.map((_, idx) => {
    const next = messages[idx + 1];
    if (!next || next.role !== 'assistant') return false;
    return extractImagesAsAttachedFiles(next.content).some(f => f.gatewayUrl);
  });

  return messages.map((msg, idx) => {
    // Only process user and assistant messages.
    if (msg.role !== 'user' && msg.role !== 'assistant') return msg;
    const text = getMessageText(msg.content);

    // Path 0: Gateway-injected outgoing media on this same message
    // (an `assistant-media` bubble — image block with flat `url`).
    const gatewayMediaFiles: AttachedFileMeta[] = msg.role === 'assistant'
      ? extractImagesAsAttachedFiles(msg.content).filter(file => file.gatewayUrl)
      : [];

    // Path 1: [media attached: path (mime) | path] — guaranteed format from attachment button
    const mediaRefs = extractMediaRefs(text);
    const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));

    // Path 2: Raw file paths.
    // For assistant messages: scan own text AND the nearest preceding user message text,
    // but only for non-tool-only assistant messages (i.e. the final answer turn).
    let rawRefs: Array<{ filePath: string; mimeType: string }> = [];
    if (msg.role === 'assistant' && !isToolOnlyMessage(msg)) {
      // Own text
      rawRefs = extractRawFilePaths(text).filter(r => !mediaRefPaths.has(r.filePath));

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

    // Dedup vs Gateway-injected bubble: if the very next assistant message
    // is a Gateway `assistant-media` bubble, drop image-typed raw refs on
    // *this* message — the bubble already covers them.
    if (msg.role === 'assistant' && nextHasGatewayMediaBubble[idx]) {
      rawRefs = rawRefs.filter(r => !r.mimeType.startsWith('image/'));
    }

    const allRefs = [...mediaRefs, ...rawRefs];
    if (allRefs.length === 0 && gatewayMediaFiles.length === 0) {
      // Preserve any previously-attached `_attachedFiles` (e.g. set by
      // `enrichWithToolResultFiles` for non-image artifacts). When nothing
      // new applies, returning `msg` unmodified keeps those attachments.
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
        if (cached) return { ...cached, filePath: ref.filePath, source: 'message-ref' as const };
        const fileName = ref.filePath.split(/[\\/]/).pop() || 'file';
        return { fileName, mimeType: ref.mimeType, fileSize: 0, preview: null, filePath: ref.filePath, source: 'message-ref' as const };
      });
    const dedupedGatewayMedia = gatewayMediaFiles.filter(
      file => file.gatewayUrl && !existingGatewayUrls.has(file.gatewayUrl),
    );
    if (files.length === 0 && dedupedGatewayMedia.length === 0) return msg;
    return { ...msg, _attachedFiles: [...existingFiles, ...files, ...dedupedGatewayMedia] };
  });
}

/**
 * Async: load missing previews from disk via IPC for messages that have
 * _attachedFiles with null previews. Updates messages in-place and triggers re-render.
 * Handles both [media attached: ...] patterns and raw filePath entries.
 */
async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  // See helpers.ts loadMissingPreviews for the canonical comment block —
  // this monolithic copy is kept in sync so legacy chat.ts callers also
  // resolve Gateway-injected outgoing media URLs into local previews.
  type PreviewRef = { filePath?: string; gatewayUrl?: string; mimeType: string };
  const needPreview: PreviewRef[] = [];
  const seenKeys = new Set<string>();

  for (const msg of messages) {
    if (!msg._attachedFiles) continue;

    // Path 1: files with explicit filePath OR gatewayUrl
    for (const file of msg._attachedFiles) {
      const key = file.filePath || file.gatewayUrl;
      if (!key || seenKeys.has(key)) continue;
      const needsLoad = file.mimeType.startsWith('image/')
        ? !file.preview
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
        const needsLoad = ref.mimeType.startsWith('image/') ? !file.preview : file.fileSize === 0;
        if (needsLoad) {
          seenKeys.add(ref.filePath);
          needPreview.push({ filePath: ref.filePath, mimeType: ref.mimeType });
        }
      }
    }
  }

  if (needPreview.length === 0) {
    return false;
  }

  try {
    const thumbnails = await hostApiFetch<Record<string, { preview: string | null; fileSize: number }>>(
      '/api/files/thumbnails',
      {
        method: 'POST',
        body: JSON.stringify({ paths: needPreview }),
      },
    );

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
            _imageCache.set(ref.filePath, { ...file });
            updated = true;
          }
        }
      }
    }
    if (updated) saveImageCache(_imageCache);
    return updated;
  } catch (err) {
    console.warn('[loadMissingPreviews] Failed:', err);
    return false;
  }
}

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const parts = sessionKey.split(':');
  return parts[1] || 'main';
}

function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

async function loadCronFallbackMessages(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  if (!isCronSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildCronSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load cron fallback history:', error);
    return [];
  }
}

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey, displayName: sessionKey }];
}

function clearSessionEntryFromMap<T extends Record<string, unknown>>(entries: T, sessionKey: string): T {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => key !== sessionKey)) as T;
}

function buildSessionSwitchPatch(
  state: Pick<
    ChatState,
    'currentSessionKey' | 'messages' | 'sessions' | 'sessionLabels' | 'sessionLastActivity' | 'thinkingLevel'
  >,
  nextSessionKey: string,
): Partial<ChatState> {
  // Only treat sessions with no history records and no activity timestamp as empty.
  // Relying solely on messages.length is unreliable because switchSession clears
  // the current messages before loadHistory runs, creating a race condition that
  // could cause sessions with real history to be incorrectly removed from the sidebar.
  const leavingEmpty = !state.currentSessionKey.endsWith(':main')
    && state.messages.length === 0
    && !state.sessionLastActivity[state.currentSessionKey]
    && !state.sessionLabels[state.currentSessionKey];

  const nextSessions = leavingEmpty
    ? state.sessions.filter((session) => session.key !== state.currentSessionKey)
    : state.sessions;
  const cachedNextSession = getCachedSessionHistory(nextSessionKey);

  return {
    currentSessionKey: nextSessionKey,
    currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
    sessions: ensureSessionEntry(nextSessions, nextSessionKey),
    sessionLabels: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLabels, state.currentSessionKey)
      : state.sessionLabels,
    sessionLastActivity: leavingEmpty
      ? clearSessionEntryFromMap(state.sessionLastActivity, state.currentSessionKey)
      : state.sessionLastActivity,
    messages: cachedNextSession?.messages ?? [],
    hasMoreHistory: cachedNextSession ? cachedNextSession.messages.length >= HISTORY_PAGE_SIZE : false,
    loadingMoreHistory: false,
    thinkingLevel: cachedNextSession?.thinkingLevel ?? state.thinkingLevel ?? null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    activeRunId: null,
    error: null,
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
  };
}

function getCanonicalPrefixFromSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
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

/** True for internal plumbing messages that should never be shown in the UI. */
function isInternalMessage(msg: { role?: unknown; content?: unknown; idempotencyKey?: unknown; model?: unknown }): boolean {
  if (msg.role === 'system') return true;
  const text = getMessageText(msg.content);
  if (msg.role === 'assistant') {
    if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/.test(text)) return true;
    // OpenClaw's gateway writes a fallback `assistant-media` transcript
    // message when its `createManagedOutgoingImageBlocks` pipeline fails
    // ("could not be prepared" warning in stderr). The fallback has:
    //   - model: 'gateway-injected'
    //   - idempotencyKey: '<runId>:assistant-media'
    //   - content: text-only `MEDIA:<staging path>` (NOT an image-url block)
    // The staging path lives in `~/.openclaw/media/outbound/` which has a
    // 120s TTL — the file is gone by the time the user reads the chat.
    // The original `MEDIA:/tmp/...` path is already on the previous
    // assistant message (the agent's actual reply), so the fallback is
    // pure duplicate noise. Hide it in the UI so it neither shows a
    // broken card nor competes with the real reply for layout space.
    const idempotencyKey = typeof msg.idempotencyKey === 'string' ? msg.idempotencyKey : '';
    const isGatewayInjectedFallback = msg.model === 'gateway-injected'
      && idempotencyKey.endsWith(':assistant-media');
    if (isGatewayInjectedFallback) {
      const hasImageUrlBlock = Array.isArray(msg.content)
        && (msg.content as ContentBlock[]).some(
          (block) => block.type === 'image' && typeof block.url === 'string' && !!block.url,
        );
      // Real gateway-media bubbles (with an image-url block) ARE the
      // canonical render — keep them. Only hide the text-only fallback.
      if (!hasImageUrlBlock) return true;
    }
  }
  // Runtime system injections: these arrive as user or assistant-role messages
  // but are internal plumbing (exec results, async-command notices, time pings, etc.)
  if ((msg.role === 'user' || msg.role === 'assistant') && isRuntimeSystemInjection(text)) return true;
  return false;
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
  if (/^\s*System\s*\(untrusted\)\s*:/i.test(normalized)) return true;
  if (
    /An async command you ran earlier has completed/i.test(normalized)
    && /Do not relay it to the user unless explicitly requested/i.test(normalized)
  ) {
    return true;
  }
  if (
    /^\s*Current time\s*:/i.test(normalized)
    && /^\s*Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

// ── Write tool_use baseline capture ─────────────────────────────
//
// Tool name sets mirror generated-files.ts so we detect the same tools.
const BASELINE_WRITE_TOOLS = new Set([
  'Write', 'write_file', 'create_file', 'WriteFile', 'createFile', 'write',
]);
const BASELINE_EDIT_TOOLS = new Set([
  'Edit', 'edit', 'edit_file', 'EditFile',
  'StrReplace', 'str_replace', 'str_replace_editor',
  'MultiEdit', 'multi_edit', 'multiEdit',
]);
const BASELINE_FILE_PATH_KEYS = ['file_path', 'filepath', 'path', 'fileName', 'file_name', 'target_path'];

function pickFilePathFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  for (const key of BASELINE_FILE_PATH_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Scan a streaming message for Write/Edit tool_use blocks and trigger
 * async baseline reads from disk for each target file.  Called on every
 * `delta` event; `captureBaseline` is idempotent — duplicate calls for
 * the same path are no-ops.
 */
function isBaselineRealUserMessage(message: RawMessage | undefined): boolean {
  if (!message || message.role !== 'user') return false;
  const content = message.content;
  if (!Array.isArray(content)) return true;
  const blocks = content as Array<{ type?: string }>;
  return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
}

function countBaselineRealUserMessages(messages: RawMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (isBaselineRealUserMessage(message)) count += 1;
  }
  return count;
}

function getBaselineRunKeyForMessages(sessionKey: string, messages: RawMessage[]): string | null {
  const userTurnOrdinal = countBaselineRealUserMessages(messages);
  return buildBaselineRunKey(sessionKey, userTurnOrdinal);
}

function captureBaselinesFromMessage(message: unknown, runKey: string | null): void {
  if (!runKey || !message || typeof message !== 'object') return;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return;
  for (const block of content as ContentBlock[]) {
    if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
    const name = typeof block.name === 'string' ? block.name : '';
    if (!name) continue;
    if (!BASELINE_WRITE_TOOLS.has(name) && !BASELINE_EDIT_TOOLS.has(name)) continue;
    const input = block.input ?? block.arguments;
    const filePath = pickFilePathFromInput(input);
    if (filePath) captureBaseline(runKey, filePath);
  }
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
  return parts.join('\n');
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

/**
 * Only treat an explicit chat.send ack timeout as recoverable.
 * Gateway stopped / Gateway not connected are hard failures that
 * should still terminate the send immediately.
 */
function isRecoverableChatSendTimeout(error: string): boolean {
  return error.includes('RPC timeout: chat.send');
}

function collectToolUpdates(message: unknown, eventState: string): ToolStatus[] {
  const updates: ToolStatus[] = [];
  const toolResultUpdate = extractToolResultUpdate(message, eventState);
  if (toolResultUpdate) updates.push(toolResultUpdate);
  updates.push(...extractToolResultBlocks(message, eventState));
  updates.push(...extractToolUseUpdates(message));
  return updates;
}

function hasNonToolAssistantContent(message: RawMessage | undefined): boolean {
  if (!message) return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;

  const content = message.content;
  if (Array.isArray(content)) {
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && block.text && block.text.trim()) return true;
      if (block.type === 'thinking' && block.thinking && block.thinking.trim()) return true;
      if (block.type === 'image') return true;
    }
  }

  const msg = message as unknown as Record<string, unknown>;
  if (typeof msg.text === 'string' && msg.text.trim()) return true;

  return false;
}

// ── Store ────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  loading: false,
  loadingMoreHistory: false,
  hasMoreHistory: false,
  error: null,
  runError: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},

  thinkingLevel: null,

  // ── Load sessions via sessions.list ──

  loadSessions: async () => {
    const now = Date.now();
    if (_loadSessionsInFlight) {
      await _loadSessionsInFlight;
      return;
    }
    if (now - _lastLoadSessionsAt < SESSION_LOAD_MIN_INTERVAL_MS) {
      return;
    }

    _loadSessionsInFlight = (async () => {
      try {
        const data = await useGatewayStore.getState().rpc<Record<string, unknown>>('sessions.list', {
          includeDerivedTitles: true,
          includeLastMessage: true,
        });
        if (data) {
          const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
          const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
            key: String(s.key || ''),
            label: s.label ? String(s.label) : undefined,
            displayName: s.displayName ? String(s.displayName) : undefined,
            derivedTitle: s.derivedTitle ? String(s.derivedTitle) : undefined,
            lastMessagePreview: s.lastMessagePreview ? String(s.lastMessagePreview) : undefined,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
            updatedAt: parseSessionUpdatedAtMs(s.updatedAt),
          })).filter((s: ChatSession) => s.key);

          const canonicalBySuffix = new Map<string, string>();
          for (const session of sessions) {
            if (!session.key.startsWith('agent:')) continue;
            const parts = session.key.split(':');
            if (parts.length < 3) continue;
            const suffix = parts.slice(2).join(':');
            if (suffix && !canonicalBySuffix.has(suffix)) {
              canonicalBySuffix.set(suffix, session.key);
            }
          }

          // Deduplicate: if both short and canonical existed, keep canonical only
          const seen = new Set<string>();
          const dedupedSessions = sessions.filter((s) => {
            if (!s.key.startsWith('agent:') && canonicalBySuffix.has(s.key)) return false;
            if (seen.has(s.key)) return false;
            seen.add(s.key);
            return true;
          });

          const { currentSessionKey, sessions: localSessions } = get();
          let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
          if (!nextSessionKey.startsWith('agent:')) {
            const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
            if (canonicalMatch) {
              nextSessionKey = canonicalMatch;
            }
          }
          if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
            // Preserve only locally-created pending sessions. On initial boot the
            // default ghost key (`agent:main:main`) should yield to real history.
            const hasLocalPendingSession = localSessions.some((session) => session.key === nextSessionKey);
            if (!hasLocalPendingSession) {
              nextSessionKey = dedupedSessions[0].key;
            }
          }

          const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
            ? [
              ...dedupedSessions,
              { key: nextSessionKey, displayName: nextSessionKey },
            ]
            : dedupedSessions;

          const discoveredActivity = Object.fromEntries(
            sessionsWithCurrent
              .filter((session) => typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt))
              .map((session) => [session.key, session.updatedAt!]),
          );

          set((state) => ({
            sessions: sessionsWithCurrent,
            currentSessionKey: nextSessionKey,
            currentAgentId: getAgentIdFromSessionKey(nextSessionKey),
            sessionLastActivity: {
              ...state.sessionLastActivity,
              ...discoveredActivity,
            },
          }));
          applySessionBackendLabels(set, sessionsWithCurrent);

          // Background: fetch first user message for every non-main session to populate labels upfront.
          // This uses the Host API local transcript summary route, not Gateway
          // chat.history, so it can run immediately without starving the
          // foreground history load during startup/restart.
          const existingSessionLabels = get().sessionLabels;
          const existingSessionActivity = get().sessionLastActivity;
          const sessionsToLabel = sessionsWithCurrent
            .map((session) => ({
              session,
              candidate: getSessionLabelHydrationCandidate(
                session,
                existingSessionLabels,
                existingSessionActivity,
              ),
            }))
            .filter((entry) => entry.candidate != null)
            .map((entry) => ({
              session: entry.session,
              version: entry.candidate!.version,
            }));
          if (sessionsToLabel.length > 0) {
            void (async () => {
              let pending = sessionsToLabel.filter(({ session, version }) => beginSessionLabelHydration(session.key, version));
              for (let attempt = 0; attempt <= LABEL_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
                try {
                  const summaries = await fetchSessionLabelSummaries(
                    pending.map(({ session }) => session.key),
                  );
                  applySessionLabelSummaries(set, summaries);
                  const summaryBySessionKey = new Map(
                    summaries.map((summary) => [summary.sessionKey, summary]),
                  );

                  for (const { session, version } of pending) {
                    const summary = summaryBySessionKey.get(session.key);
                    const labelText = toSessionLabel(summary?.firstUserText || '');
                    finishSessionLabelHydration(session.key, version, labelText ? 'labeled' : 'empty');
                  }
                  break;
                } catch (err) {
                  const retryableStartup = classifyHistoryStartupRetryError(err) === 'gateway_startup';
                  for (const { session, version } of pending) {
                    if (retryableStartup) {
                      abandonSessionLabelHydration(session.key, version);
                    } else {
                      finishSessionLabelHydration(session.key, version, 'error');
                    }
                  }
                  if (!retryableStartup || attempt >= LABEL_FETCH_RETRY_DELAYS_MS.length) {
                    break;
                  }
                  await sleep(LABEL_FETCH_RETRY_DELAYS_MS[attempt]!);
                  pending = pending.filter(({ session, version }) => beginSessionLabelHydration(session.key, version));
                  if (pending.length === 0) break;
                }
              }
            })();
          }

          if (currentSessionKey !== nextSessionKey) {
            void get().loadHistory();
          }
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
      } finally {
        _lastLoadSessionsAt = Date.now();
      }
    })();

    try {
      await _loadSessionsInFlight;
    } finally {
      _loadSessionsInFlight = null;
    }
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    if (key === get().currentSessionKey) return;
    // Stop any background polling for the old session before switching.
    // This prevents the poll timer from firing after the switch and loading
    // the wrong session's history into the new session's view.
    clearHistoryPoll();
    clearBaselines();
    set((s) => buildSessionSwitchPatch(s, key));
    get().loadHistory();
  },

  // ── Delete session ──
  //
  // NOTE: The OpenClaw Gateway does NOT expose a sessions.delete (or equivalent)
  // RPC — confirmed by inspecting client.ts, protocol.ts and the full codebase.
  // Deletion is therefore performed locally: the renderer drops the session
  // from the sidebar / labels / activity maps and the Main process hard-deletes
  // the on-disk transcript so it stops appearing in sessions.list and stops
  // contributing to the Dashboard token-usage history.

  deleteSession: async (key: string) => {
    clearCachedSessionHistory(key);
    clearSessionLabelHydrationTracking(key);
    // Hard-delete the session's JSONL transcript on disk.
    // The main process unlinks <id>.jsonl plus any leftover
    // <id>.deleted.jsonl and <id>.jsonl.reset.* siblings, then removes the
    // entry from sessions.json so sessions.list stops surfacing it.
    try {
      const result = await hostApiFetch<{
        success: boolean;
        error?: string;
      }>('/api/sessions/delete', {
        method: 'POST',
        body: JSON.stringify({ sessionKey: key }),
      });
      if (!result.success) {
        console.warn(`[deleteSession] IPC reported failure for ${key}:`, result.error);
      }
    } catch (err) {
      console.warn(`[deleteSession] IPC call failed for ${key}:`, err);
    }

    const { currentSessionKey, sessions } = get();
    const remaining = sessions.filter((s) => s.key !== key);

    if (currentSessionKey === key) {
      // Switched away from deleted session — pick the first remaining or create new
      const next = remaining[0];
      set((s) => ({
        sessions: remaining,
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
        messages: [],
        streamingText: '',
        streamingMessage: null,
        streamingTools: [],
        activeRunId: null,
        error: null,
        runError: null,
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
        currentSessionKey: next?.key ?? DEFAULT_SESSION_KEY,
        currentAgentId: getAgentIdFromSessionKey(next?.key ?? DEFAULT_SESSION_KEY),
      }));
      if (next) {
        get().loadHistory();
      }
    } else {
      set((s) => ({
        sessions: remaining,
        sessionLabels: Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== key)),
        sessionLastActivity: Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== key)),
      }));
    }
  },

  // ── New session ──

  newSession: () => {
    // Generate a new unique session key and switch to it.
    // NOTE: We intentionally do NOT call sessions.reset on the old session.
    // sessions.reset archives (renames) the session JSONL file, making old
    // conversation history inaccessible when the user switches back to it.
    const { currentSessionKey, messages, sessions, sessionLastActivity, sessionLabels } = get();
    // Only treat sessions with no history records and no activity timestamp as empty
    const leavingEmpty = !currentSessionKey.endsWith(':main')
      && messages.length === 0
      && !sessionLastActivity[currentSessionKey]
      && !sessionLabels[currentSessionKey];
    const prefix = getCanonicalPrefixFromSessionKey(currentSessionKey)
      ?? getCanonicalPrefixFromSessions(sessions)
      ?? DEFAULT_CANONICAL_PREFIX;
    const newKey = `${prefix}:session-${Date.now()}`;
    const newSessionEntry: ChatSession = { key: newKey, displayName: newKey };
    set((s) => ({
      currentSessionKey: newKey,
      currentAgentId: getAgentIdFromSessionKey(newKey),
      sessions: [
        ...(leavingEmpty ? s.sessions.filter((sess) => sess.key !== currentSessionKey) : s.sessions),
        newSessionEntry,
      ],
      sessionLabels: leavingEmpty
        ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey))
        : s.sessionLabels,
      sessionLastActivity: leavingEmpty
        ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey))
        : s.sessionLastActivity,
      messages: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      runError: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      pendingToolImages: [],
    }));
  },

  // ── Rename session ──

  renameSession: async (key: string, label: string) => {
    const normalized = label.trim();
    if (!normalized) {
      throw new Error('Session label cannot be empty');
    }

    try {
      const result = await hostApiFetch<{
        success: boolean;
        error?: string;
      }>('/api/sessions/rename', {
        method: 'POST',
        body: JSON.stringify({ sessionKey: key, label: normalized }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to rename session');
      }
    } catch (err) {
      console.error(`[renameSession] API call failed for ${key}:`, err);
      throw err;
    }

    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.key === key ? { ...session, label: normalized } : session,
      ),
      sessionLabels: { ...s.sessionLabels, [key]: normalized },
    }));
  },

  // ── Cleanup empty session on navigate away ──

  cleanupEmptySession: () => {
    const { currentSessionKey, messages, sessionLastActivity, sessionLabels } = get();
    // Only remove non-main sessions that were never used (no messages sent).
    // This mirrors the "leavingEmpty" logic in switchSession so that creating
    // a new session and immediately navigating away doesn't leave a ghost entry
    // in the sidebar.
    // Also check sessionLastActivity and sessionLabels comprehensively to prevent
    // falsely treating sessions with history as empty due to switchSession clearing messages early.
    const isEmptyNonMain = !currentSessionKey.endsWith(':main')
      && messages.length === 0
      && !sessionLastActivity[currentSessionKey]
      && !sessionLabels[currentSessionKey];
    if (!isEmptyNonMain) return;
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.key !== currentSessionKey),
      sessionLabels: Object.fromEntries(
        Object.entries(s.sessionLabels).filter(([k]) => k !== currentSessionKey),
      ),
      sessionLastActivity: Object.fromEntries(
        Object.entries(s.sessionLastActivity).filter(([k]) => k !== currentSessionKey),
      ),
    }));
  },

  // ── Load chat history ──

  loadHistory: async (quiet = false) => {
    const { currentSessionKey } = get();
    const foregroundLoadKey = getHistoryForegroundLoadKey(currentSessionKey);
    const isInitialForegroundLoad = !quiet && !_foregroundHistoryLoadSeen.has(foregroundLoadKey);
    const historyTimeoutOverride = getStartupHistoryTimeoutOverride(isInitialForegroundLoad);
    const forceLoad = _forceNextHistoryLoadBySession.delete(currentSessionKey);
    const existingLoad = _historyLoadInFlight.get(currentSessionKey);
    const shouldShowForegroundLoading = !quiet && get().messages.length === 0;
    if (existingLoad) {
      await existingLoad;
      if (!forceLoad) {
        return;
      }
      if (get().currentSessionKey !== currentSessionKey) {
        return;
      }
    }

    const lastLoadAt = _lastHistoryLoadAtBySession.get(currentSessionKey) || 0;
    if (!forceLoad && quiet && Date.now() - lastLoadAt < HISTORY_LOAD_MIN_INTERVAL_MS) {
      return;
    }

    if (shouldShowForegroundLoading) set({ loading: true, error: null, runError: null });

    // Safety guard: if history loading takes too long, force loading to false
    // to prevent the UI from being stuck in a spinner forever.
    let loadingTimedOut = false;
    const loadingSafetyTimer = shouldShowForegroundLoading ? setTimeout(() => {
      loadingTimedOut = true;
      set({ loading: false });
    }, getHistoryLoadingSafetyTimeout(isInitialForegroundLoad)) : null;

    const loadPromise = (async () => {
      const isCurrentSession = () => get().currentSessionKey === currentSessionKey;
      const getPreviewMergeKey = (message: RawMessage): string => (
        `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${getMessageText(message.content)}`
      );
      const mergeHydratedMessages = (
        currentMessages: RawMessage[],
        hydratedMessages: RawMessage[],
      ): RawMessage[] => {
        const hydratedFilesByKey = new Map(
          hydratedMessages
            .filter((message) => message._attachedFiles?.length)
            .map((message) => [
              getPreviewMergeKey(message),
              message._attachedFiles!.map((file) => ({ ...file })),
            ]),
        );

        return currentMessages.map((message) => {
          const attachedFiles = hydratedFilesByKey.get(getPreviewMergeKey(message));
          return attachedFiles
            ? { ...message, _attachedFiles: attachedFiles }
            : message;
        });
      };

      const applyLoadFailure = (errorMessage: string | null) => {
        if (!isCurrentSession()) return;
        set((state) => {
          const hasMessages = state.messages.length > 0;
          return {
            loading: false,
            error: shouldShowForegroundLoading && errorMessage ? errorMessage : state.error,
            ...(hasMessages ? {} : { messages: [] as RawMessage[] }),
          };
        });
      };

      const applyLoadedMessages = (rawMessages: RawMessage[], thinkingLevel: string | null) => {
      // Guard: if the user switched sessions while this async load was in
      // flight, discard the result to prevent overwriting the new session's
      // messages with stale data from the old session.
      if (!isCurrentSession()) return false;

      // Before filtering: attach images/files from tool_result messages to the next assistant message
      const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
      const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg));
      // Restore file attachments for user/assistant messages (from cache + text patterns)
      const enrichedMessages = enrichWithCachedImages(filteredMessages);

      // Preserve the optimistic user message during an active send.
      // The Gateway may not include the user's message in chat.history
      // until the run completes, causing it to flash out of the UI.
      let finalMessages = enrichedMessages;
      const userMsgAt = get().lastUserMessageAt;
      if (get().sending && userMsgAt) {
        const userMsMs = toMs(userMsgAt);
        const optimistic = getLatestOptimisticUserMessage(get().messages, userMsMs);
        const hasMatchingUser = optimistic
          ? enrichedMessages.some((message) => matchesOptimisticUserMessage(message, optimistic, userMsMs))
          : false;
        if (optimistic && !hasMatchingUser) {
          finalMessages = [...enrichedMessages, optimistic];
        }
      }

      const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();
      const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
      const isAfterUserMsg = (msg: RawMessage): boolean => {
        if (!userMsTs || !msg.timestamp) return true;
        return toMs(msg.timestamp) >= userMsTs;
      };
      const isRealUserBoundary = (msg: RawMessage): boolean => {
        if (msg.role !== 'user') return false;
        if (!Array.isArray(msg.content)) return true;
        const blocks = msg.content as Array<{ type?: string }>;
        return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
      };
      const postBoundaryMessages = userMsTs
        ? filteredMessages.filter((msg) => isAfterUserMsg(msg))
        : (() => {
            for (let i = filteredMessages.length - 1; i >= 0; i -= 1) {
              if (isRealUserBoundary(filteredMessages[i])) {
                return filteredMessages.slice(i + 1);
              }
            }
            return filteredMessages;
          })();
      const lastAssistantAfterBoundary = [...postBoundaryMessages].reverse().find((msg) => msg.role === 'assistant');
      const latestTerminalAssistantErrorMessage = lastAssistantAfterBoundary
        && getMessageStopReason(lastAssistantAfterBoundary) === 'error'
        ? getMessageErrorMessage(lastAssistantAfterBoundary)
        : null;

      set({
        messages: finalMessages,
        thinkingLevel,
        loading: false,
        runError: latestTerminalAssistantErrorMessage,
      });
      cacheSessionHistory(currentSessionKey, finalMessages, thinkingLevel);

      // Seed a missing label from immutable history only. Once a label exists
      // for a session, do not rewrite it during later history refreshes; users
      // perceive the sidebar title as a stable conversation identifier, not a
      // live summary of the latest turn.
      const isMainSession = currentSessionKey.endsWith(':main');
      if (!isMainSession && !get().sessionLabels[currentSessionKey]) {
        const firstUserMsg = finalMessages.find((m) => m.role === 'user');
        if (firstUserMsg) {
          const labelText = toSessionLabel(getMessageText(firstUserMsg.content));
          if (labelText) {
            set((s) => (
              s.sessionLabels[currentSessionKey]
                ? {}
                : { sessionLabels: { ...s.sessionLabels, [currentSessionKey]: labelText } }
            ));
          }
        }
      }

      // Record last activity time from the last message in history
      const lastMsg = finalMessages[finalMessages.length - 1];
      if (lastMsg?.timestamp) {
        const lastAt = toMs(lastMsg.timestamp);
        set((s) => ({
          sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: lastAt },
        }));
      }

      // Async: load missing image previews from disk (updates in background)
      loadMissingPreviews(finalMessages).then((updated) => {
        if (!isCurrentSession()) return;
        if (updated) {
          set((state) => ({
            messages: mergeHydratedMessages(state.messages, finalMessages),
          }));
        }
      });

      if (latestTerminalAssistantErrorMessage) {
        clearHistoryPoll();
        set({
          sending: false,
          activeRunId: null,
          pendingFinal: false,
          lastUserMessageAt: null,
        });
        return true;
      }

      if (isSendingNow && !pendingFinal) {
        const hasRecentAssistantActivity = [...filteredMessages].reverse().some((msg) => {
          if (msg.role !== 'assistant') return false;
          return isAfterUserMsg(msg);
        });
        if (hasRecentAssistantActivity) {
          set({ pendingFinal: true });
        }
      }

      // If pendingFinal, check whether the AI produced a final text response.
      if (pendingFinal || get().pendingFinal) {
        const recentAssistant = [...filteredMessages].reverse().find((msg) => {
          if (msg.role !== 'assistant') return false;
          if (!hasNonToolAssistantContent(msg)) return false;
          return isAfterUserMsg(msg);
        });
        if (recentAssistant) {
          clearHistoryPoll();
          set({ sending: false, activeRunId: null, pendingFinal: false });
        }
      }
      return true;
      };

      try {
        const fallbackMessages: RawMessage[] = [];

        let data: Record<string, unknown> | null = null;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
          if (!isCurrentSession()) {
            break;
          }

          try {
            data = await useGatewayStore.getState().rpc<Record<string, unknown>>(
              'chat.history',
              { sessionKey: currentSessionKey, limit: HISTORY_PAGE_SIZE },
              historyTimeoutOverride,
            );
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }

          if (!isCurrentSession()) {
            break;
          }

          const errorKind = classifyHistoryStartupRetryError(lastError);
          const shouldRetry = isInitialForegroundLoad
            && attempt < CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length
            && shouldRetryStartupHistoryLoad(useGatewayStore.getState().status, errorKind);

          if (!shouldRetry) {
            break;
          }

          console.warn('[chat.history] startup retry scheduled', {
            sessionKey: currentSessionKey,
            attempt: attempt + 1,
            gatewayState: useGatewayStore.getState().status.state,
            errorKind,
            error: String(lastError),
          });
          await sleep(CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS[attempt]!);
        }

        if (data) {
          let rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
          const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
          if (rawMessages.length === 0 && isCronSessionKey(currentSessionKey)) {
            rawMessages = fallbackMessages.length > 0
              ? fallbackMessages
              : await loadLocalHistoryFallback(currentSessionKey, 200);
          }

          const applied = applyLoadedMessages(rawMessages, thinkingLevel);
          if (applied) {
            set({ hasMoreHistory: rawMessages.length >= HISTORY_PAGE_SIZE });
          }
          if (applied && isInitialForegroundLoad) {
            _foregroundHistoryLoadSeen.add(foregroundLoadKey);
            void refreshVisibleSessionSummaries(set, get);
          }
        } else {
          const errorKind = classifyHistoryStartupRetryError(lastError);
          if (isCurrentSession() && isInitialForegroundLoad && errorKind) {
            console.warn('[chat.history] startup retry exhausted', {
              sessionKey: currentSessionKey,
              gatewayState: useGatewayStore.getState().status.state,
              error: String(lastError),
            });
          }

          const lateFallbackMessages = fallbackMessages.length > 0
            ? fallbackMessages
            : await loadLocalHistoryFallback(currentSessionKey, 200);
          if (lateFallbackMessages.length > 0) {
            const applied = applyLoadedMessages(lateFallbackMessages, null);
            if (applied) {
              set({ hasMoreHistory: lateFallbackMessages.length >= HISTORY_PAGE_SIZE });
            }
            if (applied && isInitialForegroundLoad) {
              _foregroundHistoryLoadSeen.add(foregroundLoadKey);
              void refreshVisibleSessionSummaries(set, get);
            }
          } else if (errorKind === 'timeout' && isInitialForegroundLoad) {
            // Keep startup usable while Gateway RPC routing catches up.  The
            // Sidebar/gateway event refreshes will retry quietly instead of
            // showing a transient "RPC timeout: chat.history" error.
            set({ loading: false });
          } else {
            applyLoadFailure(
              (lastError instanceof Error ? lastError.message : String(lastError))
              || 'Failed to load chat history',
            );
          }
        }
      } catch (err) {
        console.warn('Failed to load chat history:', err);
        const fallbackMessages = await loadLocalHistoryFallback(currentSessionKey, 200);
        if (fallbackMessages.length > 0) {
          const applied = applyLoadedMessages(fallbackMessages, null);
          if (applied) {
            set({ hasMoreHistory: fallbackMessages.length >= HISTORY_PAGE_SIZE });
          }
          if (applied && isInitialForegroundLoad) {
            _foregroundHistoryLoadSeen.add(foregroundLoadKey);
            void refreshVisibleSessionSummaries(set, get);
          }
        } else {
          applyLoadFailure(String(err));
        }
      }
    })();

    _historyLoadInFlight.set(currentSessionKey, loadPromise);
    try {
      await loadPromise;
    } finally {
      // Clear the safety timer on normal completion
      if (loadingSafetyTimer) clearTimeout(loadingSafetyTimer);
      if (!loadingTimedOut) {
        // Only update load time if we actually didn't time out and the
        // completed request still belongs to the selected session.  Stale
        // loads from a session switch must not debounce the next foreground
        // startup attempt for that same session.
        if (get().currentSessionKey === currentSessionKey) {
          _lastHistoryLoadAtBySession.set(currentSessionKey, Date.now());
        }
      }
      
      const active = _historyLoadInFlight.get(currentSessionKey);
      if (active === loadPromise) {
        _historyLoadInFlight.delete(currentSessionKey);
      }
    }
  },

  loadMoreHistory: async () => {
    const { currentSessionKey, messages, loadingMoreHistory, hasMoreHistory } = get();
    if (loadingMoreHistory || !hasMoreHistory || messages.length === 0) return;

    set({ loadingMoreHistory: true, error: null });
    try {
      const nextLimit = Math.min(messages.length + HISTORY_PAGE_SIZE, HISTORY_MAX_RENDERED_MESSAGES);
      const rawMessages = await loadLocalHistoryFallback(currentSessionKey, nextLimit);
      if (get().currentSessionKey !== currentSessionKey) return;
      if (rawMessages.length === 0) {
        set({ hasMoreHistory: false, loadingMoreHistory: false });
        return;
      }

      // Reuse the normal history application path by replacing the visible
      // window with a larger suffix from the transcript.  This keeps render
      // cost bounded while allowing long conversations to page backwards.
      const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
      const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg));
      const enrichedMessages = enrichWithCachedImages(filteredMessages);
      set({
        messages: enrichedMessages,
        loadingMoreHistory: false,
        hasMoreHistory: rawMessages.length >= nextLimit && nextLimit < HISTORY_MAX_RENDERED_MESSAGES,
      });
      cacheSessionHistory(currentSessionKey, enrichedMessages, get().thinkingLevel);
      void loadMissingPreviews(enrichedMessages).then((updated) => {
        if (!updated || get().currentSessionKey !== currentSessionKey) return;
        set((state) => ({
          messages: state.messages.map((message) => {
            const match = enrichedMessages.find((candidate) => (
              `${candidate.id ?? ''}|${candidate.role}|${candidate.timestamp ?? ''}|${getMessageText(candidate.content)}`
              === `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${getMessageText(message.content)}`
            ));
            return match?._attachedFiles?.length ? { ...message, _attachedFiles: match._attachedFiles } : message;
          }),
        }));
      });
    } catch (error) {
      console.warn('Failed to load more history:', error);
      set({ loadingMoreHistory: false, error: String(error) });
    } finally {
      if (get().currentSessionKey === currentSessionKey) {
        set({ loadingMoreHistory: false });
      }
    }
  },

  // ── Send message ──

  sendMessage: async (
    text: string,
    attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
    targetAgentId?: string | null,
  ) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;

    if (targetSessionKey !== get().currentSessionKey) {
      set((s) => buildSessionSwitchPatch(s, targetSessionKey));
      await get().loadHistory(true);
    }

    const currentSessionKey = targetSessionKey;

    // Add user message optimistically (with local file metadata for UI display)
    const nowMs = Date.now();
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: nowMs / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: attachments?.map(a => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
        filePath: a.stagedPath,
      })),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      runError: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: nowMs,
    }));

    // Update session label with first user message text as soon as it's sent
    const { sessionLabels, messages } = get();
    const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
    if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && trimmed) {
      const labelText = toSessionLabel(trimmed);
      if (labelText) {
        set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: labelText } }));
      }
    }

    // Mark this session as most recently active
    set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

    // Start the history poll and safety timeout IMMEDIATELY (before the
    // RPC await) because the gateway's chat.send RPC may block until the
    // entire agentic conversation finishes — the poll must run in parallel.
    _lastChatEventAt = Date.now();
    clearHistoryPoll();
    clearErrorRecoveryTimer();

    const POLL_START_DELAY = 3_000;
    const POLL_INTERVAL = 4_000;
    const pollHistory = () => {
      const state = get();
      if (!state.sending) { clearHistoryPoll(); return; }
      if (state.streamingMessage) {
        _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
        return;
      }
      if (Date.now() - _lastChatEventAt < HISTORY_POLL_SILENCE_WINDOW_MS) {
        _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
        return;
      }
      state.loadHistory(true);
      _historyPollTimer = setTimeout(pollHistory, POLL_INTERVAL);
    };
    _historyPollTimer = setTimeout(pollHistory, POLL_START_DELAY);

    const SAFETY_TIMEOUT_MS = 90_000;
    const checkStuck = () => {
      const state = get();
      if (!state.sending) return;
      if (state.streamingMessage || state.streamingText) return;
      if (state.pendingFinal) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      if (Date.now() - _lastChatEventAt < SAFETY_TIMEOUT_MS) {
        setTimeout(checkStuck, 10_000);
        return;
      }
      clearHistoryPoll();
      set({
        error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
        sending: false,
        activeRunId: null,
        lastUserMessageAt: null,
      });
    };
    setTimeout(checkStuck, 30_000);

    try {
      const idempotencyKey = crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;
      if (hasMedia) {
        console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
      }

      // Cache image attachments BEFORE the IPC call to avoid race condition:
      // history may reload (via Gateway event) before the RPC returns.
      // Keyed by staged file path which appears in [media attached: <path> ...].
      if (hasMedia && attachments) {
        for (const a of attachments) {
          _imageCache.set(a.stagedPath, {
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            preview: a.preview,
          });
        }
        saveImageCache(_imageCache);
      }

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
      const CHAT_SEND_TIMEOUT_MS = 120_000;

      if (hasMedia) {
        result = await hostApiFetch<{ success: boolean; result?: { runId?: string }; error?: string }>(
          '/api/chat/send-with-media',
          {
            method: 'POST',
            body: JSON.stringify({
              sessionKey: currentSessionKey,
              message: trimmed || 'Process the attached file(s).',
              deliver: false,
              idempotencyKey,
              media: attachments.map((a) => ({
                filePath: a.stagedPath,
                mimeType: a.mimeType,
                fileName: a.fileName,
              })),
            }),
          },
        );
      } else {
        const rpcResult = await useGatewayStore.getState().rpc<{ runId?: string }>(
          'chat.send',
          {
            sessionKey: currentSessionKey,
            message: trimmed,
            deliver: false,
            idempotencyKey,
          },
          CHAT_SEND_TIMEOUT_MS,
        );
        result = { success: true, result: rpcResult };
      }

      console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

      if (!result.success) {
        const errorMsg = result.error || 'Failed to send message';
        if (isRecoverableChatSendTimeout(errorMsg)) {
          console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errorMsg}`);
        } else {
          clearHistoryPoll();
          set({ error: errorMsg, sending: false });
        }
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      }
    } catch (err) {
      const errStr = String(err);
      if (isRecoverableChatSendTimeout(errStr)) {
        console.warn(`[sendMessage] Recoverable chat.send timeout, keeping poll alive: ${errStr}`);
      } else {
        clearHistoryPoll();
        set({ error: errStr, sending: false });
      }
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    clearHistoryPoll();
    clearErrorRecoveryTimer();
    const { currentSessionKey } = get();
    set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null, pendingToolImages: [] });
    set({ streamingTools: [] });

    try {
      await useGatewayStore.getState().rpc(
        'chat.abort',
        { sessionKey: currentSessionKey },
      );
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── Handle incoming chat events from Gateway ──

  handleChatEvent: (event: Record<string, unknown>) => {
    const runId = String(event.runId || '');
    const eventState = String(event.state || '');
    const eventSessionKey = event.sessionKey != null ? String(event.sessionKey) : null;
    const { activeRunId, currentSessionKey } = get();

    // Only process events for the current session (when sessionKey is present)
    if (eventSessionKey != null && eventSessionKey !== currentSessionKey) {
      return;
    }

    // Only process events for the active run (or if no active run set)
    if (activeRunId && runId && runId !== activeRunId) {
      return;
    }

    if (isDuplicateChatEvent(eventState, event)) {
      return;
    }

    _lastChatEventAt = Date.now();

    // Defensive: if state is missing but we have a message, try to infer state.
    let resolvedState = eventState;
    if (!resolvedState && event.message && typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>;
        const stopReason = getMessageStopReason(msg);
        if (stopReason === 'error') {
          resolvedState = 'error';
        } else if (stopReason) {
          resolvedState = 'final';
      } else if (msg.role || msg.content) {
        resolvedState = 'delta';
      }
    }

    // Only pause the history poll when we receive actual streaming data.
    // The gateway sends "agent" events with { phase, startedAt } that carry
    // no message — these must NOT kill the poll, since the poll is our only
    // way to track progress when the gateway doesn't stream intermediate turns.
    const hasUsefulData = resolvedState === 'delta' || resolvedState === 'final'
      || resolvedState === 'error' || resolvedState === 'aborted';
    if (hasUsefulData) {
      clearHistoryPoll();
      // Adopt run started from another client (e.g. console at 127.0.0.1:18789):
      // show loading/streaming in the app when this session has an active run.
      const { sending } = get();
      if (!sending && runId) {
          set({ sending: true, activeRunId: runId, error: null, runError: null });
      }
    }

    switch (resolvedState) {
      case 'started': {
        // Run just started (e.g. from console); show loading immediately.
        const { sending: currentSending } = get();
        if (!currentSending && runId) {
          set({ sending: true, activeRunId: runId, error: null, runError: null });
        }
        break;
      }
      case 'delta': {
        // Clear any stale error (including RPC timeout) when new data arrives.
        if (_errorRecoveryTimer) {
          clearErrorRecoveryTimer();
        }
        if (get().error || get().runError) {
          set({ error: null, runError: null });
        }
        const updates = collectToolUpdates(event.message, resolvedState);
        // Capture baseline file content from disk before the runtime
        // executes Write tool calls — enables proper before/after diff.
        captureBaselinesFromMessage(
          event.message,
          getBaselineRunKeyForMessages(currentSessionKey, get().messages),
        );
        set((s) => ({
          streamingMessage: (() => {
            if (event.message && typeof event.message === 'object') {
              const msgRole = (event.message as RawMessage).role;
              if (isToolResultRole(msgRole)) return s.streamingMessage;
            }
            return normalizeStreamingMessage(event.message ?? s.streamingMessage);
          })(),
          streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
        }));
        break;
      }
      case 'final': {
        clearErrorRecoveryTimer();
        if (get().error || get().runError) set({ error: null, runError: null });
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          const normalizedFinalMessage = normalizeStreamingMessage(finalMsg) as RawMessage;
          if (isTerminalAssistantErrorMessage(normalizedFinalMessage)) {
            get().handleChatEvent({
              ...event,
              state: 'error',
              errorMessage: getMessageErrorMessage(normalizedFinalMessage) ?? event.errorMessage,
              message: normalizedFinalMessage,
            });
            break;
          }
          const updates = collectToolUpdates(normalizedFinalMessage, resolvedState);
          // Filter out internal-only final responses (NO_REPLY, HEARTBEAT_OK, etc.)
          // before adding to messages. Without this guard, the internal token appears
          // briefly in the UI until loadHistory replaces the message list — and if the
          // quiet-mode reload is debounced away, the token can stay visible permanently.
          if (isInternalMessage(normalizedFinalMessage)) {
            const sessionKeyForReload = get().currentSessionKey;
            set({
              streamingText: '',
              streamingMessage: null,
              sending: false,
              activeRunId: null,
              pendingFinal: false,
              streamingTools: [],
              pendingToolImages: [],
            });
            clearHistoryPoll();
            forceNextHistoryLoad(sessionKeyForReload);
            void get().loadHistory(true);
            break;
          }
          if (isToolResultRole(normalizedFinalMessage.role)) {
            // Resolve file path from the streaming assistant message's matching tool call
            const currentStreamForPath = get().streamingMessage as RawMessage | null;
            const matchedPath = (currentStreamForPath && normalizedFinalMessage.toolCallId)
              ? getToolCallFilePath(currentStreamForPath, normalizedFinalMessage.toolCallId)
              : undefined;

            // Mirror `enrichWithToolResultFiles`: collect non-image artifacts
            // for the next assistant message. Images embedded inside a tool
            // result (read tool's vision data) and raw image paths in the
            // tool's stdout (sips / ls / file output) are NOT user-facing —
            // the canonical render is the Gateway-injected `assistant-media`
            // bubble that follows the agent's `MEDIA:` text. Surfacing those
            // intermediate images here would duplicate every screenshot the
            // agent inspects on its way to the final artifact.
            const toolFiles: AttachedFileMeta[] = extractImagesAsAttachedFiles(
              normalizedFinalMessage.content,
            ).filter(file => !file.mimeType.startsWith('image/'));
            if (matchedPath) {
              for (const f of toolFiles) {
                if (!f.filePath) {
                  f.filePath = matchedPath;
                  f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                }
              }
            }
            const text = getMessageText(normalizedFinalMessage.content);
            if (text) {
              const mediaRefs = extractMediaRefs(text);
              const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
              for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref));
              for (const ref of extractRawFilePaths(text)) {
                if (mediaRefPaths.has(ref.filePath)) continue;
                if (ref.mimeType.startsWith('image/')) continue;
                toolFiles.push(makeAttachedFile(ref));
              }
            }
            set((s) => {
              // Snapshot the current streaming assistant message (thinking + tool_use) into
              // messages[] before clearing it. The Gateway does NOT send separate 'final'
              // events for intermediate tool-use turns — it only sends deltas and then the
              // tool result. Without snapshotting here, the intermediate thinking+tool steps
              // would be overwritten by the next turn's deltas and never appear in the UI.
              const currentStream = s.streamingMessage as RawMessage | null;
              const snapshotMsgs = snapshotStreamingAssistantMessage(currentStream, s.messages, runId);
              return {
                messages: snapshotMsgs.length > 0 ? [...s.messages, ...snapshotMsgs] : s.messages,
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                pendingToolImages: toolFiles.length > 0
                  ? [...s.pendingToolImages, ...toolFiles]
                  : s.pendingToolImages,
                streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
              };
            });
            break;
          }
          const toolOnly = isToolOnlyMessage(normalizedFinalMessage);
          const hasOutput = hasNonToolAssistantContent(normalizedFinalMessage);
          const msgId = normalizedFinalMessage.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
            const streamingTools = hasOutput ? [] : nextTools;

            // Note: it would be tempting to also surface `MEDIA:/path`
            // markers from `normalizedFinalMessage.content`'s text here, so
            // the agent's reply could attach the original file directly
            // (`/tmp/...png`) without waiting for the post-final history
            // reload. However, OpenClaw's `splitTrailingDirective`
            // (selection-D8_ELZa7.js ~line 904) strips `MEDIA:/...` lines
            // out of the streaming text BEFORE it reaches the client, so
            // the `final` event we get here never contains the marker.
            // Image surfacing is fully handled by the post-final reload
            // below + `enrichWithCachedImages` (which dereferences the
            // assistant-media bubble's `block.url`).
            const pendingImgs = s.pendingToolImages;
            const msgWithImages: RawMessage = pendingImgs.length > 0
              ? {
                ...normalizedFinalMessage,
                role: (normalizedFinalMessage.role || 'assistant') as RawMessage['role'],
                id: msgId,
                _attachedFiles: [...(normalizedFinalMessage._attachedFiles || []), ...pendingImgs],
              }
              : { ...normalizedFinalMessage, role: (normalizedFinalMessage.role || 'assistant') as RawMessage['role'], id: msgId };
            const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some(m => m.id === msgId);
            if (alreadyExists) {
              return toolOnly ? {
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
                ...clearPendingImages,
              } : {
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                streamingTools,
                ...clearPendingImages,
              };
            }
            return toolOnly ? {
              messages: [...s.messages, msgWithImages],
              streamingText: '',
              streamingMessage: null,
              pendingFinal: true,
              streamingTools,
              ...clearPendingImages,
            } : {
              messages: [...s.messages, msgWithImages],
              streamingText: '',
              streamingMessage: null,
              sending: hasOutput ? false : s.sending,
              activeRunId: hasOutput ? null : s.activeRunId,
              pendingFinal: hasOutput ? false : true,
              streamingTools,
              ...clearPendingImages,
            };
          });
          // After the final response, quietly reload history to surface all intermediate
          // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
          if (hasOutput && !toolOnly) {
            clearHistoryPoll();
            void get().loadHistory(true);

            // OpenClaw's gateway processes `MEDIA:/path` markers in the
            // assistant reply asynchronously, in the `dispatch.deliver` of
            // the `final` payload (see openclaw/dist/chat-DM9hSaNV.js's
            // `appendWebchatAgentMediaTranscriptIfNeeded`):
            //   1. copy the original file under
            //      `~/.openclaw/media/outgoing/originals/<uuid>`
            //   2. write the record JSON under
            //      `~/.openclaw/media/outgoing/records/<id>.json`
            //   3. `appendAssistantTranscriptMessage` writes a follow-up
            //      `assistant-media` message to the session JSONL, with
            //      `idempotencyKey: "<runId>:assistant-media"`.
            // That follow-up message is **only persisted** — it is NOT
            // re-broadcast as a streaming event. The streaming `final`
            // we just consumed only contains the agent's text. The
            // assistant-media bubble can only be retrieved via
            // `chat.history`, and the persistence runs on the order of
            // ~400-500ms after the streaming final.
            //
            // The immediate `loadHistory(true)` above therefore races the
            // gateway's write and almost always misses the bubble.
            //
            // CRITICAL: we cannot detect from the streaming final alone
            // whether the agent emitted a `MEDIA:/path` marker — OpenClaw's
            // `splitTrailingDirective` (selection-D8_ELZa7.js line ~904)
            // strips `MEDIA:/...` lines from the broadcast text BEFORE it
            // reaches the client, so the streaming `final` text is always
            // the user-facing prose without the marker. The MEDIA: marker
            // only appears in the persisted JSONL transcript (msg N) and
            // its companion `assistant-media` bubble (msg N+1).
            //
            // We therefore unconditionally schedule ONE follow-up quiet
            // reload ~1500ms after every assistant `final`. The cost is
            // a single extra in-process RPC per assistant turn (cheap);
            // when there's no media the second reload returns the same
            // history snapshot and is a no-op for the UI.
            // `forceNextHistoryLoad` bypasses `HISTORY_LOAD_MIN_INTERVAL_MS`
            // so the call is not suppressed by the throttle.
            const sessionKeyAtFinal = get().currentSessionKey;
            setTimeout(() => {
              if (get().currentSessionKey !== sessionKeyAtFinal) {
                return;
              }
              forceNextHistoryLoad(sessionKeyAtFinal);
              void get().loadHistory(true);
            }, 1500);
          }
        } else {
          // No message in final event - reload history to get complete data
          set({ streamingText: '', streamingMessage: null, pendingFinal: true });
          get().loadHistory();
        }
        break;
      }
      case 'error': {
        const errorMsg = String(
          event.errorMessage
          || getMessageErrorMessage(event.message)
          || 'An error occurred',
        );
        const terminalAssistantError = isTerminalAssistantErrorMessage(event.message);
        const wasSending = get().sending;

        // Snapshot the current streaming message into messages[] so partial
        // content ("Let me get that written down...") is preserved in the UI
        // rather than being silently discarded.
        const currentStream = get().streamingMessage as RawMessage | null;
        const errorSnapshot = snapshotStreamingAssistantMessage(
          currentStream,
          get().messages,
          `error-${runId || Date.now()}`,
        );
        if (errorSnapshot.length > 0) {
          set((s) => ({
            messages: [...s.messages, ...errorSnapshot],
          }));
        }

        set({
          error: terminalAssistantError ? null : errorMsg,
          runError: terminalAssistantError ? errorMsg : null,
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
        });

        clearHistoryPoll();
        clearErrorRecoveryTimer();
        if (wasSending) {
          void get().loadHistory(true);
        }
        break;
      }
      case 'aborted': {
        clearHistoryPoll();
        clearErrorRecoveryTimer();
        set({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
        });
        break;
      }
      default: {
        // Unknown or empty state — if we're currently sending and receive an event
        // with a message, attempt to process it as streaming data. This handles
        // edge cases where the Gateway sends events without a state field.
        const { sending } = get();
        if (sending && event.message && typeof event.message === 'object') {
          console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
          const updates = collectToolUpdates(event.message, 'delta');
          set((s) => ({
            streamingMessage: event.message ?? s.streamingMessage,
            streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
        }
        break;
      }
    }
  },

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { loadHistory, loadSessions } = get();
    await Promise.all([loadHistory(), loadSessions()]);
  },

  clearError: () => set({ error: null, runError: null }),
}));
