import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RawMessage } from '@shared/chat/types';

const MAX_TRANSCRIPT_SEARCH_DEPTH = 6;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const TRANSCRIPT_TURN_MATCH_WINDOW_MS = 2 * 60_000;
const MAX_TRANSCRIPT_FILE_CACHE_ENTRIES = 512;
const MAX_TRANSCRIPT_PATH_CACHE_ENTRIES = 2_048;
type CachedTranscriptFile = {
  mtimeMs: number;
  size: number;
  jsonl: string;
  turnMetadata?: {
    sessionTimestamp?: number;
    sessionWorkDir?: string;
    userTurns: Array<{
      content: string;
      timestamp?: number;
    }>;
  };
  toolMessages?: RawMessage[];
};

const transcriptFileCache = new Map<string, CachedTranscriptFile>();
const transcriptPathBySessionId = new Map<string, string>();

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export type CcConnectTranscriptTurnHint = {
  content: string;
  timestamp: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function displayToolName(name: string): string {
  switch (name) {
    case 'exec_command':
      return 'Bash';
    case 'apply_patch':
      return 'Patch';
    case 'web_search':
    case 'web_search_call':
      return 'Web Search';
    default:
      return name || 'tool';
  }
}

function toolOutputIsError(output: string): boolean {
  const exitCode = output.match(/\bProcess exited with code (\d+)\b/i)?.[1];
  return exitCode !== undefined && Number(exitCode) !== 0;
}

function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? '');
}

function truncateToolOutput(output: string): string {
  return output.length > MAX_TOOL_OUTPUT_CHARS
    ? `${output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n… output truncated by ClawX`
    : output;
}

async function readTranscriptFile(path: string): Promise<CachedTranscriptFile | null> {
  const metadata = await stat(path).catch(() => null);
  if (!metadata) return null;
  const cached = transcriptFileCache.get(path);
  if (cached && cached.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
    setBoundedCache(transcriptFileCache, path, cached, MAX_TRANSCRIPT_FILE_CACHE_ENTRIES);
    return cached;
  }
  const jsonl = await readFile(path, 'utf8').catch(() => '');
  const entry = {
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
    jsonl,
  };
  setBoundedCache(transcriptFileCache, path, entry, MAX_TRANSCRIPT_FILE_CACHE_ENTRIES);
  return entry;
}

async function findTranscriptFile(
  directory: string,
  agentSessionId: string,
  depth = 0,
): Promise<string | undefined> {
  if (depth > MAX_TRANSCRIPT_SEARCH_DEPTH) return undefined;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.jsonl') && entry.name.includes(agentSessionId)) {
      return join(directory, entry.name);
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = await findTranscriptFile(join(directory, entry.name), agentSessionId, depth + 1);
    if (match) return match;
  }
  return undefined;
}

function transcriptDateParts(timestamp: number, utc: boolean): [string, string, string] {
  const date = new Date(timestamp);
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return [String(year), String(month).padStart(2, '0'), String(day).padStart(2, '0')];
}

function transcriptCandidateDateParts(timestamp: number): Array<[string, string, string]> {
  const candidates = [
    transcriptDateParts(timestamp - 24 * 60 * 60_000, false),
    transcriptDateParts(timestamp, false),
    transcriptDateParts(timestamp + 24 * 60 * 60_000, false),
    transcriptDateParts(timestamp, true),
  ];
  return Array.from(new Map(candidates.map((parts) => [parts.join('/'), parts])).values());
}

function transcriptTurnMetadata(file: CachedTranscriptFile): NonNullable<CachedTranscriptFile['turnMetadata']> {
  if (file.turnMetadata) return file.turnMetadata;
  let sessionTimestamp: number | undefined;
  let sessionWorkDir: string | undefined;
  const userTurns: NonNullable<CachedTranscriptFile['turnMetadata']>['userTurns'] = [];
  for (const line of file.jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      record = parsed;
    } catch {
      continue;
    }
    if (record.type === 'session_meta' && isRecord(record.payload)) {
      sessionTimestamp = parseTimestamp(record.payload.timestamp) ?? parseTimestamp(record.timestamp);
      sessionWorkDir = typeof record.payload.cwd === 'string' ? record.payload.cwd : undefined;
      continue;
    }
    if (record.type !== 'response_item' || !isRecord(record.payload)) continue;
    const payload = record.payload;
    if (payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) continue;
    const timestamp = parseTimestamp(record.timestamp) ?? sessionTimestamp;
    for (const item of payload.content) {
      if (!isRecord(item) || item.type !== 'input_text' || typeof item.text !== 'string') continue;
      userTurns.push({
        content: item.text.trim(),
        ...(timestamp !== undefined ? { timestamp } : {}),
      });
    }
  }
  file.turnMetadata = { sessionTimestamp, sessionWorkDir, userTurns };
  return file.turnMetadata;
}

function transcriptMatchesWorkDir(file: CachedTranscriptFile, expectedWorkDir?: string): boolean {
  if (!expectedWorkDir) return true;
  const { sessionWorkDir } = transcriptTurnMetadata(file);
  return sessionWorkDir !== undefined && resolve(sessionWorkDir) === resolve(expectedWorkDir);
}

function transcriptMatchesTurn(
  file: CachedTranscriptFile,
  hints: CcConnectTranscriptTurnHint[],
  expectedWorkDir?: string,
): boolean {
  const { userTurns } = transcriptTurnMetadata(file);
  if (userTurns.length === 0 || !transcriptMatchesWorkDir(file, expectedWorkDir)) return false;
  return hints.some((hint) => userTurns.some((turn) => (
    turn.timestamp !== undefined
    && Math.abs(turn.timestamp - hint.timestamp) <= TRANSCRIPT_TURN_MATCH_WINDOW_MS
    && turn.content === hint.content.trim()
  )));
}

async function findTurnTranscriptFiles(
  codexHomeDir: string,
  hints: CcConnectTranscriptTurnHint[],
  expectedWorkDir?: string,
): Promise<string[]> {
  const sessionRoot = join(codexHomeDir, 'sessions');
  const directories = new Map<string, string>();
  for (const hint of hints) {
    for (const parts of transcriptCandidateDateParts(hint.timestamp)) {
      const directory = join(sessionRoot, ...parts);
      directories.set(directory, directory);
    }
  }
  const matches: string[] = [];
  for (const directory of directories.values()) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const path = join(directory, entry.name);
      const file = await readTranscriptFile(path);
      if (file?.jsonl && transcriptMatchesTurn(file, hints, expectedWorkDir)) matches.push(path);
    }
  }
  return matches;
}

export function parseCcConnectCodexTranscriptTools(jsonl: string): RawMessage[] {
  const messages: RawMessage[] = [];
  const toolNamesByCallId = new Map<string, string>();

  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      record = parsed;
    } catch {
      continue;
    }
    if (record.type !== 'response_item' || !isRecord(record.payload)) continue;
    const payload = record.payload;
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    const callId = typeof payload.call_id === 'string'
      ? payload.call_id.trim()
      : typeof payload.id === 'string'
        ? payload.id.trim()
        : '';
    if (!callId) continue;
    const timestamp = parseTimestamp(record.timestamp);

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
      const name = displayToolName(rawName);
      toolNamesByCallId.set(callId, name);
      messages.push({
        id: `cc-connect-codex-tool-${callId}`,
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: callId,
          name,
          arguments: parseToolArguments(payload.arguments ?? payload.input),
        }],
        ...(timestamp !== undefined ? { timestamp } : {}),
        stopReason: 'tool_use',
      });
      continue;
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const rawOutput = toolOutputText(payload.output ?? payload.content);
      const output = truncateToolOutput(rawOutput);
      const name = toolNamesByCallId.get(callId) || 'tool';
      const isError = toolOutputIsError(rawOutput);
      messages.push({
        id: `cc-connect-codex-tool-result-${callId}`,
        role: 'toolresult',
        toolCallId: callId,
        toolName: name,
        content: output,
        details: {
          status: isError ? 'error' : 'completed',
          aggregated: output,
        },
        ...(isError ? { isError: true } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
      });
      continue;
    }

    if (payloadType === 'web_search_call') {
      const name = 'Web Search';
      messages.push({
        id: `cc-connect-codex-tool-${callId}`,
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: callId,
          name,
          arguments: payload.action ?? {},
        }],
        ...(timestamp !== undefined ? { timestamp } : {}),
        stopReason: 'tool_use',
      });
      const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
      const isError = ['cancelled', 'error', 'failed'].includes(status);
      if (status === 'completed' || isError) {
        const output = isError ? `Web search ${status}` : 'Web search completed';
        messages.push({
          id: `cc-connect-codex-tool-result-${callId}`,
          role: 'toolresult',
          toolCallId: callId,
          toolName: name,
          content: output,
          details: {
            status: isError ? 'error' : 'completed',
            aggregated: output,
          },
          ...(isError ? { isError: true } : {}),
          ...(timestamp !== undefined ? { timestamp } : {}),
        });
      }
      continue;
    }

    if (payloadType === 'mcp_tool_call') {
      const server = typeof payload.server === 'string' ? payload.server : '';
      const tool = typeof payload.tool === 'string'
        ? payload.tool
        : typeof payload.name === 'string'
          ? payload.name
          : 'tool';
      const name = server ? `${server}: ${tool}` : tool;
      messages.push({
        id: `cc-connect-codex-tool-${callId}`,
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: callId,
          name,
          arguments: parseToolArguments(payload.arguments ?? payload.input),
        }],
        ...(timestamp !== undefined ? { timestamp } : {}),
        stopReason: 'tool_use',
      });
      if (payload.result !== undefined || payload.error !== undefined) {
        const isError = payload.error !== undefined;
        const output = truncateToolOutput(toolOutputText(payload.error ?? payload.result));
        messages.push({
          id: `cc-connect-codex-tool-result-${callId}`,
          role: 'toolresult',
          toolCallId: callId,
          toolName: name,
          content: output,
          details: {
            status: isError ? 'error' : 'completed',
            aggregated: output,
          },
          ...(isError ? { isError: true } : {}),
          ...(timestamp !== undefined ? { timestamp } : {}),
        });
      }
    }
  }

  return messages;
}

export async function loadCcConnectCodexTranscriptTools(
  codexHomeDirs: string | Iterable<string>,
  agentSessionId: string,
  turnHints: CcConnectTranscriptTurnHint[] = [],
  expectedWorkDir?: string,
): Promise<RawMessage[]> {
  const hasValidAgentSessionId = /^[A-Za-z0-9_-]+$/.test(agentSessionId);
  if (!hasValidAgentSessionId && turnHints.length === 0) return [];
  const homes = typeof codexHomeDirs === 'string'
    ? [codexHomeDirs]
    : Array.from(codexHomeDirs);
  const uniqueHomes = Array.from(new Set(homes.filter(Boolean)));
  const idMatchedPaths = new Set<string>();
  for (const codexHomeDir of uniqueHomes) {
    if (hasValidAgentSessionId) {
      const sessionPathCacheKey = `${resolve(codexHomeDir)}\0${agentSessionId}`;
      let transcriptPath = transcriptPathBySessionId.get(sessionPathCacheKey);
      if (!transcriptPath) {
        transcriptPath = await findTranscriptFile(join(codexHomeDir, 'sessions'), agentSessionId);
      }
      if (transcriptPath) {
        setBoundedCache(
          transcriptPathBySessionId,
          sessionPathCacheKey,
          transcriptPath,
          MAX_TRANSCRIPT_PATH_CACHE_ENTRIES,
        );
        const file = await readTranscriptFile(transcriptPath);
        if (file?.jsonl && transcriptMatchesWorkDir(file, expectedWorkDir)) {
          idMatchedPaths.add(transcriptPath);
        }
      }
    }
  }
  let transcriptPaths = new Set<string>();
  if (idMatchedPaths.size === 1) {
    transcriptPaths = idMatchedPaths;
  } else if (idMatchedPaths.size === 0) {
    const fallbackPaths = new Set<string>();
    for (const codexHomeDir of uniqueHomes) {
      for (const path of await findTurnTranscriptFiles(codexHomeDir, turnHints, expectedWorkDir)) {
        fallbackPaths.add(path);
      }
    }
    if (fallbackPaths.size === 1) transcriptPaths = fallbackPaths;
  }
  const messages: RawMessage[] = [];
  for (const transcriptPath of transcriptPaths) {
    const file = await readTranscriptFile(transcriptPath);
    if (!file?.jsonl) continue;
    file.toolMessages ??= parseCcConnectCodexTranscriptTools(file.jsonl);
    messages.push(...file.toolMessages);
  }
  return messages.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}
