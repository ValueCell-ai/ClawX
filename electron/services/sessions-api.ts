import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { stripAcpWorkingDirectoryPrefix } from '@shared/chat/session-title';
import { isOpenClawHeartbeatPollText } from '@shared/chat/openclaw-internal';
import type { RawMessage } from '@shared/chat/types';
import type { SessionTurnTimingCandidate } from '@shared/host-api/contract';
import { resolveOpenClawStateDir } from '../utils/paths';
import { logger } from '../utils/logger';
import {
  removeSessionEntry,
  resolveSessionTranscriptPath,
  sweepSessionArtefacts,
} from '../utils/session-files';
import { isRecord } from './payload-utils';

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RECENT_TRANSCRIPT_INITIAL_READ_BYTES = 256 * 1024;
const RECENT_TRANSCRIPT_MAX_READ_BYTES = 8 * 1024 * 1024;
const RECENT_TRANSCRIPT_MAX_SCAN_LINES = 5_000;

type SessionSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  workspacePath: string | null;
  heartbeatOnly?: boolean;
};

type TranscriptMessage = RawMessage;

type ParsedTranscriptLine = {
  type?: string;
  id?: unknown;
  timestamp?: unknown;
  message?: TranscriptMessage;
};

type TranscriptMessageRecord = {
  id?: string;
  timestamp?: unknown;
  message: TranscriptMessage;
};

type SessionPayload = {
  id?: unknown;
  sessionKey?: unknown;
  label?: unknown;
  title?: unknown;
  agentId?: unknown;
  sessionId?: unknown;
  limit?: unknown;
  sessionKeys?: unknown;
};

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Array<{ type?: unknown; text?: unknown }>)
    .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim())
    .map((block) => String(block.text))
    .join('\n')
    .trim();
}

function cleanSummaryUserText(text: string): string {
  const textAfterInitialPrefix = stripAcpWorkingDirectoryPrefix(text);
  const cleaned = textAfterInitialPrefix
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
  const stripCwdExposedByCleanup = !textAfterInitialPrefix.startsWith('[Working directory: ')
    && cleaned.startsWith('[Working directory: ');
  return (stripCwdExposedByCleanup ? stripAcpWorkingDirectoryPrefix(cleaned) : cleaned).trim();
}

function isInternalSummaryText(text: string): boolean {
  if (!text) return true;
  if (isOpenClawHeartbeatPollText(text)) return true;
  if (/^\s*System\s*\(untrusted\)\s*:/i.test(text)) return true;
  if (
    /An async command you ran earlier has completed/i.test(text)
    && /Do not relay it to the user unless explicitly requested/i.test(text)
  ) {
    return true;
  }
  if (
    /^\s*Current time\s*:/i.test(text)
    && /^\s*Current time\s*:[^\n]*\/\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+UTC\s*$/i.test(text)
  ) {
    return true;
  }
  return false;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 1e12 ? value * 1000 : value;
}

function normalizeTranscriptTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return normalizeTimestamp(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function transcriptRecordTimestamp(record: TranscriptMessageRecord): number | null {
  return normalizeTranscriptTimestamp(record.timestamp)
    ?? normalizeTranscriptTimestamp(record.message.timestamp);
}

function normalizeTurnUserText(message: TranscriptMessage): string {
  return stripAcpWorkingDirectoryPrefix(extractMessageText(message.content))
    .replace(/\r\n/g, '\n')
    .trim();
}

function isInternalInterSessionUser(message: TranscriptMessage): boolean {
  const provenance = (message as TranscriptMessage & { provenance?: unknown }).provenance;
  if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
    const kind = (provenance as Record<string, unknown>).kind;
    if (typeof kind === 'string' && kind.toLowerCase() === 'inter_session') return true;
  }
  return /^\[Inter-session message\]\s/.test(extractMessageText(message.content));
}

function extractTranscriptTurnTimings(records: TranscriptMessageRecord[]): SessionTurnTimingCandidate[] {
  const turns: Array<{
    normalizedUserText: string;
    startedAt: number | null;
    completedAt: number | null;
  }> = [];
  let current: (typeof turns)[number] | null = null;

  for (const record of records) {
    const role = typeof record.message.role === 'string' ? record.message.role.toLowerCase() : '';
    if (role === 'user') {
      if (isInternalInterSessionUser(record.message)) continue;
      current = {
        normalizedUserText: normalizeTurnUserText(record.message),
        startedAt: transcriptRecordTimestamp(record),
        completedAt: null,
      };
      turns.push(current);
      continue;
    }

    if (!current || (role !== 'assistant' && role !== 'toolresult' && role !== 'tool_result')) continue;
    const timestamp = transcriptRecordTimestamp(record);
    if (timestamp != null && (current.completedAt == null || timestamp > current.completedAt)) {
      current.completedAt = timestamp;
    }
  }

  const occurrences = new Map<string, number>();
  const candidates = new Array<SessionTurnTimingCandidate | null>(turns.length).fill(null);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const userOccurrenceFromTail = (occurrences.get(turn.normalizedUserText) ?? 0) + 1;
    occurrences.set(turn.normalizedUserText, userOccurrenceFromTail);
    if (turn.startedAt == null || turn.completedAt == null || turn.completedAt < turn.startedAt) continue;
    candidates[index] = {
      normalizedUserText: turn.normalizedUserText,
      userOccurrenceFromTail,
      durationMs: turn.completedAt - turn.startedAt,
    };
  }
  return candidates.filter((candidate): candidate is SessionTurnTimingCandidate => candidate != null);
}

type SqliteDatabaseLike = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
  };
};

function normalizeCwdValue(value: unknown): string | null {
  const cwd = typeof value === 'string' ? value.trim() : '';
  return cwd || null;
}

function parseRuntimeOptionsCwd(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeCwdValue((parsed as Record<string, unknown>).cwd);
  } catch {
    return null;
  }
}

function readAcpReplayCwd(db: SqliteDatabaseLike, sessionKey: string): string | null {
  try {
    const row = db.prepare(
      'SELECT cwd FROM acp_replay_sessions WHERE session_key = ? ORDER BY updated_at DESC, session_id ASC LIMIT 1',
    ).get(sessionKey) as { cwd?: unknown } | undefined;
    return normalizeCwdValue(row?.cwd);
  } catch {
    return null;
  }
}

function readAcpRuntimeMetaCwd(db: SqliteDatabaseLike, sessionKey: string): string | null {
  try {
    const row = db.prepare('SELECT * FROM acp_sessions WHERE session_key = ?').get(sessionKey) as {
      runtime_options_json?: unknown;
      cwd?: unknown;
    } | undefined;
    return parseRuntimeOptionsCwd(row?.runtime_options_json) ?? normalizeCwdValue(row?.cwd);
  } catch {
    return null;
  }
}

async function readOpenClawAcpSessionCwds(sessionKeys: string[]): Promise<Map<string, string>> {
  const normalizedKeys = Array.from(new Set(sessionKeys.map((sessionKey) => sessionKey.trim()).filter(Boolean)));
  const workspaceByKey = new Map<string, string>();
  if (normalizedKeys.length === 0) return workspaceByKey;

  const databasePath = join(resolveOpenClawStateDir(), 'state', 'openclaw.sqlite');
  try {
    await access(databasePath);
    const sqliteSpecifier = 'node:sqlite';
    const { DatabaseSync } = await import(/* @vite-ignore */ sqliteSpecifier);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const sessionKey of normalizedKeys) {
        const cwd = readAcpReplayCwd(db, sessionKey) ?? readAcpRuntimeMetaCwd(db, sessionKey);
        if (cwd) workspaceByKey.set(sessionKey, cwd);
      }
      return workspaceByKey;
    } finally {
      db.close();
    }
  } catch {
    return new Map();
  }
}

function parseMessageRecordLine(line: string): TranscriptMessageRecord | null {
  try {
    const entry = JSON.parse(line) as ParsedTranscriptLine;
    if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') {
      return null;
    }
    return {
      ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
      timestamp: entry.timestamp,
      message: entry.message,
    };
  } catch {
    return null;
  }
}

function parseMessageLine(line: string): TranscriptMessage | null {
  return parseMessageRecordLine(line)?.message ?? null;
}

function parseRecentRecordsFromTailChunk(chunk: string, readStart: number, limit: number): TranscriptMessageRecord[] {
  const lines = chunk.split(/\r?\n/);
  if (readStart > 0) lines.shift();

  const collected: TranscriptMessageRecord[] = [];
  let scanned = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.trim()) continue;
    scanned += 1;
    if (scanned > RECENT_TRANSCRIPT_MAX_SCAN_LINES) break;
    const record = parseMessageRecordLine(line);
    if (record) {
      collected.push(record);
      if (collected.length >= limit) break;
    }
  }
  return collected.reverse();
}

function readRecentTranscriptRecords(transcriptPath: string, limit: number): TranscriptMessageRecord[] {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
  let fd: number | null = null;
  try {
    fd = openSync(transcriptPath, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return [];

    let readBytes = Math.min(size, Math.max(RECENT_TRANSCRIPT_INITIAL_READ_BYTES, boundedLimit * 2048));
    while (readBytes <= size) {
      const readStart = Math.max(0, size - readBytes);
      const readLen = size - readStart;
      const buffer = Buffer.allocUnsafe(readLen);
      readSync(fd, buffer, 0, readLen, readStart);
      const records = parseRecentRecordsFromTailChunk(buffer.toString('utf8'), readStart, boundedLimit);
      if (
        records.length >= boundedLimit
        || readStart === 0
        || readBytes >= RECENT_TRANSCRIPT_MAX_READ_BYTES
      ) {
        return records;
      }
      readBytes = Math.min(size, readBytes * 2);
    }
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function readRecentTranscriptMessages(transcriptPath: string, limit: number): TranscriptMessage[] {
  return readRecentTranscriptRecords(transcriptPath, limit).map((record) => record.message);
}

async function readAllTranscriptMessages(transcriptPath: string): Promise<TranscriptMessage[]> {
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(transcriptPath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const message = parseMessageLine(line);
    return message ? [message] : [];
  });
}

function summarizeTranscriptMessages(
  sessionKey: string,
  messages: TranscriptMessage[],
  workspacePath: string | null,
): SessionSummary {
  let firstUserText: string | null = null;
  let lastTimestamp: number | null = null;
  let sawHeartbeatPollText = false;

  for (const message of messages) {
    const normalizedTs = normalizeTimestamp(message.timestamp);
    if (normalizedTs != null) {
      lastTimestamp = normalizedTs;
    }
    if (firstUserText == null && message.role === 'user') {
      const text = cleanSummaryUserText(extractMessageText(message.content));
      if (text && isInternalSummaryText(text)) {
        if (isOpenClawHeartbeatPollText(text)) {
          sawHeartbeatPollText = true;
        }
      } else if (text) {
        firstUserText = text;
      }
    }
  }

  const heartbeatOnly = firstUserText == null && sawHeartbeatPollText;
  return {
    sessionKey,
    firstUserText,
    lastTimestamp,
    workspacePath,
    ...(heartbeatOnly ? { heartbeatOnly: true } : {}),
  };
}

function parseSessionKey(sessionKey: string): { agentId: string; suffix: string } | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1] || '';
  const suffix = parts.slice(2).join(':');
  if (!SAFE_SESSION_SEGMENT.test(agentId) || !suffix) return null;
  return { agentId, suffix };
}

function getSessionKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SessionPayload : {};
  const value = body.sessionKey ?? body.id ?? payload;
  if (typeof value !== 'string' || !value.startsWith('agent:')) {
    throw new Error(`Invalid sessionKey: ${String(value)}`);
  }
  return value;
}

function getLimit(payload: unknown, fallback = 200): number {
  const value = isRecord(payload) ? (payload as SessionPayload).limit : undefined;
  const limitRaw = typeof value === 'number' ? value : fallback;
  return Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : fallback;
}

async function readSessionsJson(agentId: string): Promise<Record<string, unknown>> {
  const fsP = await import('node:fs/promises');
  const sessionsJsonPath = join(resolveOpenClawStateDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function resolveSessionTranscriptPathByKey(
  sessionKey: string,
  sessionsDir: string,
  sessionsJson: Record<string, unknown>,
): string | null {
  let resolvedSrcPath: string | undefined;
  let fileName: string | undefined;

  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((session) => session.key === sessionKey || session.sessionKey === sessionKey);
    if (entry) {
      fileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (!fileName && typeof entry.id === 'string') {
        fileName = `${entry.id}.jsonl`;
      }
      const absFile = (entry.sessionFile ?? entry.absolutePath) as string | undefined;
      if (absFile && (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/))) {
        resolvedSrcPath = absFile;
      }
    }
  }

  if (!fileName && !resolvedSrcPath && sessionsJson[sessionKey] != null) {
    const value = sessionsJson[sessionKey];
    if (typeof value === 'string') {
      fileName = value;
    } else if (typeof value === 'object' && value !== null) {
      const entry = value as Record<string, unknown>;
      const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (absFile) {
        if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
          resolvedSrcPath = absFile;
        } else {
          fileName = absFile;
        }
      } else {
        const id = (entry.id ?? entry.sessionId) as string | undefined;
        if (id) fileName = id.endsWith('.jsonl') ? id : `${id}.jsonl`;
      }
    }
  }

  if (!resolvedSrcPath && fileName) {
    resolvedSrcPath = join(sessionsDir, fileName.endsWith('.jsonl') ? fileName : `${fileName}.jsonl`);
  }

  return resolvedSrcPath ?? null;
}

async function loadSessionSummary(sessionKey: string, workspacePath: string | null): Promise<SessionSummary> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
  }

  try {
    const sessionsDir = join(resolveOpenClawStateDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
    }

    const messages = await readAllTranscriptMessages(transcriptPath);
    return summarizeTranscriptMessages(sessionKey, messages, workspacePath);
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null, workspacePath };
  }
}

async function loadSessionTranscriptByKey(sessionKey: string, limit: number): Promise<RawMessage[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  try {
    const sessionsDir = join(resolveOpenClawStateDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) return null;

    return readRecentTranscriptMessages(transcriptPath, limit);
  } catch {
    return null;
  }
}

async function loadSessionTurnTimingsByKey(
  sessionKey: string,
  limit: number,
): Promise<SessionTurnTimingCandidate[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  try {
    const sessionsDir = join(resolveOpenClawStateDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) return null;

    // ACP session/load is authoritative for history content, but its updates omit the
    // original timestamps needed to calculate a whole-turn duration. Read only bounded
    // transcript timing metadata here; this must never become a second history source.
    return extractTranscriptTurnTimings(readRecentTranscriptRecords(transcriptPath, limit));
  } catch {
    return null;
  }
}

async function deleteSession(sessionKey: string): Promise<{ success: boolean; error?: string }> {
  if (!sessionKey || !sessionKey.startsWith('agent:')) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  const parts = sessionKey.split(':');
  if (parts.length < 3) {
    return { success: false, error: `sessionKey has too few parts: ${sessionKey}` };
  }
  const agentId = parts[1];
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid agentId: ${agentId}` };
  }

  const sessionsDir = join(resolveOpenClawStateDir(), 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');
  logger.info(`[session:delete] key=${sessionKey} agentId=${agentId}`);
  logger.info(`[session:delete] sessionsJson=${sessionsJsonPath}`);

  const fsP = await import('node:fs/promises');
  let sessionsJson: Record<string, unknown>;
  try {
    const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
    sessionsJson = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    logger.warn(`[session:delete] Could not read sessions.json: ${String(error)}`);
    return { success: false, error: `Could not read sessions.json: ${String(error)}` };
  }

  const resolution = resolveSessionTranscriptPath(sessionsJson, sessionsDir, sessionKey);
  if (!resolution.ok) {
    if (resolution.failure.kind === 'not-found') {
      logger.warn(`[session:delete] Cannot resolve file for "${sessionKey}". Raw value: ${JSON.stringify(sessionsJson[sessionKey])}`);
      return { success: false, error: `Cannot resolve file for session: ${sessionKey}` };
    }
    logger.warn(`[session:delete] Refusing to delete out-of-scope path for "${sessionKey}": ${resolution.failure.resolvedPath}`);
    return {
      success: false,
      error: `Resolved session path is outside the agent sessions dir: ${resolution.failure.resolvedPath}`,
    };
  }

  const { resolvedSrcPath, sessionsDirAbs, baseId } = resolution;
  logger.info(`[session:delete] file: ${resolvedSrcPath}`);
  const sweep = await sweepSessionArtefacts(sessionsDirAbs, baseId);
  for (const removedPath of sweep.removed) {
    logger.info(`[session:delete] Unlinked ${removedPath}`);
  }
  for (const { path: failedPath, error } of sweep.errors) {
    logger.warn(`[session:delete] Failed to unlink ${failedPath}: ${String(error)}`);
  }
  logger.info(`[session:delete] Hard-deleted ${sweep.removed.length} file(s) for ${baseId}`);

  try {
    const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
    const json2 = JSON.parse(raw2) as Record<string, unknown>;
    removeSessionEntry(json2, sessionKey);
    await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
    logger.info(`[session:delete] Removed "${sessionKey}" from sessions.json`);
  } catch (error) {
    logger.warn(`[session:delete] Could not update sessions.json: ${String(error)}`);
  }

  return { success: true };
}

async function renameSession(sessionKey: string, label: string): Promise<{ success: boolean; error?: string }> {
  if (!sessionKey || !sessionKey.startsWith('agent:')) {
    return { success: false, error: `Invalid sessionKey: ${sessionKey}` };
  }
  if (!label || typeof label !== 'string' || !label.trim()) {
    return { success: false, error: 'Label cannot be empty' };
  }
  const parts = sessionKey.split(':');
  if (parts.length < 3) {
    return { success: false, error: `Malformed sessionKey: ${sessionKey}` };
  }
  const agentId = parts[1];
  if (!SAFE_SESSION_SEGMENT.test(agentId)) {
    return { success: false, error: `Invalid agentId in sessionKey: ${agentId}` };
  }

  const sessionsJsonPath = join(resolveOpenClawStateDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  const json = JSON.parse(raw) as Record<string, unknown>;
  const trimmedLabel = label.trim();

  let found = false;
  if (json[sessionKey] && typeof json[sessionKey] === 'object') {
    (json[sessionKey] as Record<string, unknown>).label = trimmedLabel;
    found = true;
  }
  if (Array.isArray(json.sessions)) {
    for (const entry of json.sessions as Array<Record<string, unknown>>) {
      if (entry.key === sessionKey || entry.sessionKey === sessionKey) {
        entry.label = trimmedLabel;
        found = true;
      }
    }
  }

  if (!found) {
    return { success: false, error: `Session not found in sessions.json: ${sessionKey}` };
  }

  await fsP.writeFile(sessionsJsonPath, JSON.stringify(json, null, 2), 'utf8');
  logger.info(`[session:rename] key=${sessionKey} label=${trimmedLabel}`);
  return { success: true };
}

export function createSessionsApi(): CompleteHostServiceRegistry['sessions'] {
  return {
    delete: async (payload) => deleteSession(getSessionKey(payload)),
    rename: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKey = getSessionKey(payload);
      const label = body.label ?? body.title;
      if (typeof label !== 'string') {
        throw new Error('Label cannot be empty');
      }
      return renameSession(sessionKey, label);
    },
    summaries: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKeys = Array.isArray(body.sessionKeys)
        ? body.sessionKeys.filter((value): value is string => typeof value === 'string' && value.startsWith('agent:'))
        : [];
      if (sessionKeys.length === 0) return { success: true, summaries: [] };
      const workspaceByKey = await readOpenClawAcpSessionCwds(sessionKeys);
      return {
        success: true,
        summaries: await Promise.all(sessionKeys.map((sessionKey) => (
          loadSessionSummary(sessionKey, workspaceByKey.get(sessionKey.trim()) ?? null)
        ))),
      };
    },
    history: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const limit = getLimit(payload);

      if (typeof body.sessionKey === 'string' && body.sessionKey.trim()) {
        const messages = await loadSessionTranscriptByKey(body.sessionKey.trim(), limit);
        if (!messages) return { success: false, error: 'Transcript not found' };
        return { success: true, messages };
      }

      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!agentId || !sessionId) {
        return { success: false, error: 'agentId and sessionId are required' };
      }
      if (!SAFE_SESSION_SEGMENT.test(agentId) || !SAFE_SESSION_SEGMENT.test(sessionId)) {
        return { success: false, error: 'Invalid transcript identifier' };
      }

      try {
        const transcriptPath = join(resolveOpenClawStateDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
        return { success: true, messages: readRecentTranscriptMessages(transcriptPath, limit) };
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          return { success: false, error: 'Transcript not found' };
        }
        return { success: false, error: 'Failed to load transcript' };
      }
    },
    turnTimings: async (payload) => {
      const body = isRecord(payload) ? payload as SessionPayload : {};
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      if (!sessionKey) return { success: false, error: 'sessionKey is required' };
      const timings = await loadSessionTurnTimingsByKey(sessionKey, getLimit(payload, 1000));
      if (!timings) return { success: false, error: 'Transcript not found' };
      return { success: true, timings };
    },
  };
}
