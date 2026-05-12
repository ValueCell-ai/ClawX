import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const SAFE_SESSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

type SessionSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
};

type TranscriptMessage = {
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
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

function parseSessionKey(sessionKey: string): { agentId: string; suffix: string } | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  const agentId = parts[1] || '';
  const suffix = parts.slice(2).join(':');
  if (!SAFE_SESSION_SEGMENT.test(agentId) || !suffix) return null;
  return { agentId, suffix };
}

async function readSessionsJson(agentId: string): Promise<Record<string, unknown>> {
  const fsP = await import('node:fs/promises');
  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function resolveSessionTranscriptPath(
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
    const fsP = await import('node:fs/promises');
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPath(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) {
      return { sessionKey, firstUserText: null, lastTimestamp: null };
    }

    const raw = await fsP.readFile(transcriptPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    let firstUserText: string | null = null;
    let lastTimestamp: number | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: TranscriptMessage };
        if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') continue;
        const message = entry.message;
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
      } catch {
        // ignore malformed jsonl rows
      }
    }

    return { sessionKey, firstUserText, lastTimestamp };
  } catch {
    return { sessionKey, firstUserText: null, lastTimestamp: null };
  }
}

async function loadSessionTranscriptByKey(sessionKey: string, limit: number): Promise<unknown[] | null> {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return null;

  try {
    const fsP = await import('node:fs/promises');
    const sessionsDir = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions');
    const sessionsJson = await readSessionsJson(parsed.agentId);
    const transcriptPath = resolveSessionTranscriptPath(sessionKey, sessionsDir, sessionsJson);
    if (!transcriptPath) return null;

    const raw = await fsP.readFile(transcriptPath, 'utf8');
    const messages = raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: unknown };
        return entry.type === 'message' && entry.message ? [entry.message] : [];
      } catch {
        return [];
      }
    });

    return limit > 0 ? messages.slice(-limit) : messages;
  } catch {
    return null;
  }
}

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/sessions/summaries' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKeys?: string[] }>(req);
      const sessionKeys = Array.isArray(body.sessionKeys)
        ? body.sessionKeys.filter((value): value is string => typeof value === 'string' && value.startsWith('agent:'))
        : [];
      if (sessionKeys.length === 0) {
        sendJson(res, 200, { success: true, summaries: [] });
        return true;
      }

      const summaries = await Promise.all(sessionKeys.map((sessionKey) => loadSessionSummary(sessionKey)));
      sendJson(res, 200, { success: true, summaries });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/transcript' && req.method === 'GET') {
    try {
      const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
      const limitRaw = Number(url.searchParams.get('limit') ?? '200');
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 1000) : 200;

      if (sessionKey) {
        const messages = await loadSessionTranscriptByKey(sessionKey, limit);
        if (!messages) {
          sendJson(res, 404, { success: false, error: 'Transcript not found' });
          return true;
        }
        sendJson(res, 200, { success: true, messages });
        return true;
      }

      const agentId = url.searchParams.get('agentId')?.trim() || '';
      const sessionId = url.searchParams.get('sessionId')?.trim() || '';
      if (!agentId || !sessionId) {
        sendJson(res, 400, { success: false, error: 'agentId and sessionId are required' });
        return true;
      }
      if (!SAFE_SESSION_SEGMENT.test(agentId) || !SAFE_SESSION_SEGMENT.test(sessionId)) {
        sendJson(res, 400, { success: false, error: 'Invalid transcript identifier' });
        return true;
      }

      const transcriptPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(transcriptPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const messages = lines.flatMap((line) => {
        try {
          const entry = JSON.parse(line) as { type?: string; message?: unknown };
          return entry.type === 'message' && entry.message ? [entry.message] : [];
        } catch {
          return [];
        }
      });

      sendJson(res, 200, { success: true, messages: limit > 0 ? messages.slice(-limit) : messages });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        sendJson(res, 404, { success: false, error: 'Transcript not found' });
      } else {
        sendJson(res, 500, { success: false, error: 'Failed to load transcript' });
      }
    }
    return true;
  }

  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string }>(req);
      const sessionKey = body.sessionKey;
      if (!sessionKey || !sessionKey.startsWith('agent:')) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }
      const parts = sessionKey.split(':');
      if (parts.length < 3) {
        sendJson(res, 400, { success: false, error: `sessionKey has too few parts: ${sessionKey}` });
        return true;
      }
      const agentId = parts[1];
      const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(raw) as Record<string, unknown>;

      let uuidFileName: string | undefined;
      let resolvedSrcPath: string | undefined;
      if (Array.isArray(sessionsJson.sessions)) {
        const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
          .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
        if (entry) {
          uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (!uuidFileName && typeof entry.id === 'string') {
            uuidFileName = `${entry.id}.jsonl`;
          }
        }
      }
      if (!uuidFileName && sessionsJson[sessionKey] != null) {
        const val = sessionsJson[sessionKey];
        if (typeof val === 'string') {
          uuidFileName = val;
        } else if (typeof val === 'object' && val !== null) {
          const entry = val as Record<string, unknown>;
          const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (absFile) {
            if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
              resolvedSrcPath = absFile;
            } else {
              uuidFileName = absFile;
            }
          } else {
            const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
            if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
          }
        }
      }
      if (!uuidFileName && !resolvedSrcPath) {
        sendJson(res, 404, { success: false, error: `Cannot resolve file for session: ${sessionKey}` });
        return true;
      }
      if (!resolvedSrcPath) {
        if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
        resolvedSrcPath = join(sessionsDir, uuidFileName!);
      }
      const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');
      try {
        await fsP.access(resolvedSrcPath);
        await fsP.rename(resolvedSrcPath, dstPath);
      } catch {
        // Non-fatal; still try to update sessions.json.
      }
      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;
      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }
      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
