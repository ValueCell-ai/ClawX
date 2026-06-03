import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RawMessage } from '@shared/chat/types';
import { getOpenClawConfigDir } from '../utils/paths';
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
};

type TranscriptMessage = RawMessage;

type ParsedTranscriptLine = {
  type?: string;
  message?: TranscriptMessage;
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
  return text
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
}

function isInternalSummaryText(text: string): boolean {
  if (!text) return true;
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

function parseMessageLine(line: string): TranscriptMessage | null {
  try {
    const entry = JSON.parse(line) as ParsedTranscriptLine;
    if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') {
      return null;
    }
    return entry.message;
  } catch {
    return null;
  }
}

function parseRecentMessagesFromTailChunk(chunk: string, readStart: number, limit: number): TranscriptMessage[] {
  const lines = chunk.split(/\r?\n/);
  if (readStart > 0) lines.shift();

  const collected: TranscriptMessage[] = [];
  let scanned = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.trim()) continue;
    scanned += 1;
    if (scanned > RECENT_TRANSCRIPT_MAX_SCAN_LINES) break;
    const message = parseMessageLine(line);
    if (message) {
      collected.push(message);
      if (collected.length >= limit) break;
    }
  }
  return collected.reverse();
}

function readRecentTranscriptMessages(transcriptPath: string, limit: number): TranscriptMessage[] {
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
      const messages = parseRecentMessagesFromTailChunk(buffer.toString('utf8'), readStart, boundedLimit);
      if (
        messages.length >= boundedLimit
        || readStart === 0
        || readBytes >= RECENT_TRANSCRIPT_MAX_READ_BYTES
      ) {
        return messages;
      }
      readBytes = Math.min(size, readBytes * 2);
    }
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

async function readAllTranscriptMessages(transcriptPath: string): Promise<TranscriptMessage[]> {
  const fsP = await import('node:fs/promises');
  const raw = await fsP.readFile(transcriptPath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const message = parseMessageLine(line);
    return message ? [message] : [];
  });
}

function summarizeTranscriptMessages(sessionKey: string, messages: TranscriptMessage[]): SessionSummary {
  let firstUserText: string | null = null;
  let lastTimestamp: number | null = null;

  for (const message of messages) {
    const normalizedTs = normalizeTimestamp(message.timestamp);
    if (normalizedTs != null) {
      lastTimestamp = normalizedTs;
    }
    if (firstUserText == null && message.role === 'user') {
      const text = cleanSummaryUserText(extractMessageText(message.content));
      if (text && !isInternalSummaryText(text)) {
        firstUserText = text;
      }
    }
  }

  return { sessionKey, firstUserText, lastTimestamp };
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
  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
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

async function loadSessionSummary(sessionKey: string): Promise<SessionSummary> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null };
    }

    const messages = await readAllTranscriptMessages(transcriptPath);
    return summarizeTranscriptMessages(sessionKey, messages);
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }
}

async function loadSessionTranscriptByKey(sessionKey: string, limit: number): Promise<RawMessage[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  try {
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPathByKey(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) return null;

    return readRecentTranscriptMessages(transcriptPath, limit);
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

  const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
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

  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
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
      return {
        success: true,
        summaries: await Promise.all(sessionKeys.map((sessionKey) => loadSessionSummary(sessionKey))),
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
        const transcriptPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
        return { success: true, messages: readRecentTranscriptMessages(transcriptPath, limit) };
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          return { success: false, error: 'Transcript not found' };
        }
        return { success: false, error: 'Failed to load transcript' };
      }
    },
  };
}
