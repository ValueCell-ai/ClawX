import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import WebSocket from 'ws';
import type { AttachedFileMeta, RawMessage } from '@shared/chat/types';
import { getCcConnectManagedDir } from './cc-connect-paths';
import type { RuntimeSendWithMediaPayload } from './types';
import { getCcConnectMediaDir } from '../utils/runtime-media-paths';

type BridgeAdapterOptions = {
  port: number;
  token: string;
  project: string;
  projectForSessionKey?: (sessionKey: string) => string;
  emit: EventEmitter['emit'];
  sessionStoreDir?: string;
  codexSessionsDir?: string;
};

type SessionMetadata = {
  key: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
};

type PendingRun = {
  runId: string;
  sessionKey: string;
  prompt: string;
  startedAt: number;
  seq: number;
  codexToolStarts: Set<string>;
  codexToolCompletions: Set<string>;
  codexToolNames: Map<string, string>;
};

type PendingRunResolution = {
  runId: string;
  pending: PendingRun;
};

type AbortedRun = {
  sessionKey: string;
  abortedAt: number;
};

type BridgeMediaKind = 'image' | 'file' | 'audio';

type BridgeToolEventKind = 'started' | 'updated' | 'completed' | 'command-output' | 'patch-completed';

type PersistedSession = {
  id: string;
  name?: string;
  projectName: string;
  agentId: string;
  history: RawMessage[];
  createdAt: number;
  updatedAt: number;
};

type PersistedSessionStore = {
  path: string;
  projectName: string;
  agentId: string;
  sessions: Map<string, PersistedSession>;
  rawSessions: Map<string, Record<string, unknown>>;
  activeSession: Map<string, string>;
  userSessions: Map<string, string[]>;
  userMeta: Map<string, Record<string, unknown>>;
  raw: Record<string, unknown>;
};

const CONNECT_TIMEOUT_MS = 15_000;
const CLAWX_PROJECT_PREFIX = 'clawx-';
const ABORTED_RUN_TTL_MS = 10 * 60_000;
const TOOL_START_TYPES = new Set(['tool_start', 'tool.started', 'tool_call', 'tool_call_start', 'tool_use', 'tool_use_start']);
const TOOL_UPDATE_TYPES = new Set(['tool_update', 'tool.updated', 'tool_call_update', 'tool_use_update']);
const TOOL_COMPLETE_TYPES = new Set(['tool_result', 'tool.completed', 'tool_finish', 'tool_end', 'tool_call_result', 'tool_use_result']);
const COMMAND_OUTPUT_TYPES = new Set(['command_output', 'command.output', 'cmd_output', 'terminal_output']);
const PATCH_COMPLETED_TYPES = new Set(['patch_completed', 'patch.completed', 'patch_applied', 'file_patch_completed']);
const ARTIFACT_TYPES = new Set(['artifact', 'artifact_generated', 'generated_file', 'file_generated']);
const TOOL_ID_KEYS = ['tool_call_id', 'toolCallId', 'call_id', 'callId', 'tool_id', 'toolId', 'item_id', 'itemId', 'id'];
const TOOL_NAME_KEYS = ['tool_name', 'toolName', 'name', 'tool', 'command', 'title'];
const TOOL_ARG_KEYS = ['args', 'arguments', 'input', 'parameters', 'params', 'tool_input', 'toolInput'];
const FILE_ARG_KEYS = ['file_path', 'filePath', 'filepath', 'path', 'target_path', 'targetPath', 'file_name', 'fileName', 'filename'];
const EDIT_ARG_KEYS = [
  'old_string',
  'oldString',
  'new_string',
  'newString',
  'old_text',
  'oldText',
  'new_text',
  'newText',
  'content',
  'contents',
  'diff',
  'patch',
];
const CODEX_TRANSCRIPT_LOOKBACK_MS = 60_000;
const CODEX_TRANSCRIPT_MAX_FILES = 12;
const CODEX_TRANSCRIPT_MAX_DEPTH = 5;

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const record = block as Record<string, unknown>;
      if (typeof record.text === 'string') return [record.text];
      if (typeof record.thinking === 'string') return [record.thinking];
      return [];
    })
    .join('\n')
    .trim();
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizedType(record: Record<string, unknown>): string {
  return typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
}

function firstRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function firstPayloadValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function numberFromUnknown(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function extensionForMimeType(mimeType: string, fallback: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/wav') return 'wav';
  return fallback;
}

function sanitizeFileName(fileName: string): string {
  return basename(fileName).replace(/[^\w.\- ()[\]]+/g, '_').replace(/^_+/, '') || 'attachment';
}

function bridgeToolObject(message: Record<string, unknown>): Record<string, unknown> | undefined {
  return firstRecord(message, ['tool_call', 'toolCall', 'tool_use', 'toolUse', 'tool', 'call']);
}

function bridgeToolCallId(message: Record<string, unknown>): string {
  const tool = bridgeToolObject(message);
  return firstString(message, TOOL_ID_KEYS)
    || (tool ? firstString(tool, TOOL_ID_KEYS) : undefined)
    || `tool-${randomUUID()}`;
}

function bridgeToolName(message: Record<string, unknown>, fallback: string): string {
  const tool = bridgeToolObject(message);
  return firstString(message, TOOL_NAME_KEYS)
    || (tool ? firstString(tool, TOOL_NAME_KEYS) : undefined)
    || fallback;
}

function normalizeBridgeToolArgs(message: Record<string, unknown>): unknown {
  const tool = bridgeToolObject(message);
  const direct = firstPayloadValue(message, TOOL_ARG_KEYS);
  if (direct !== undefined) return direct;
  if (tool) {
    const nested = firstPayloadValue(tool, TOOL_ARG_KEYS);
    if (nested !== undefined) return nested;
  }

  const collected: Record<string, unknown> = {};
  for (const key of [...FILE_ARG_KEYS, ...EDIT_ARG_KEYS, 'cwd', 'exit_code', 'exitCode', 'output', 'status']) {
    if (message[key] !== undefined) collected[key] = message[key];
    if (tool?.[key] !== undefined) collected[key] = tool[key];
  }
  return Object.keys(collected).length > 0 ? collected : undefined;
}

function isBridgeToolMessage(message: Record<string, unknown>): BridgeToolEventKind | null {
  const type = normalizedType(message);
  if (TOOL_START_TYPES.has(type) || ARTIFACT_TYPES.has(type)) return 'started';
  if (TOOL_UPDATE_TYPES.has(type)) return 'updated';
  if (TOOL_COMPLETE_TYPES.has(type)) return 'completed';
  if (COMMAND_OUTPUT_TYPES.has(type)) return 'command-output';
  if (PATCH_COMPLETED_TYPES.has(type)) return 'patch-completed';
  return null;
}

function toolArgsMentionFile(args: unknown): boolean {
  if (!isRecord(args)) return false;
  for (const key of FILE_ARG_KEYS) {
    if (typeof args[key] === 'string' && args[key].trim()) return true;
  }
  return false;
}

function looksLikeGeneratedFileTool(message: Record<string, unknown>, name: string, args: unknown): boolean {
  if (ARTIFACT_TYPES.has(normalizedType(message))) return true;
  if (toolArgsMentionFile(args)) return true;
  return /^(write|writefile|write_file|create_file|edit|editfile|edit_file|str_replace|strreplace|multi_edit|multiedit)$/i.test(name);
}

function mimeTypeForBridgeMedia(kind: BridgeMediaKind, message: Record<string, unknown>): string {
  const explicit = firstString(message, ['mime_type', 'mimeType', 'content_type', 'contentType']);
  if (explicit) return explicit;
  if (kind === 'image') return 'image/png';
  if (kind === 'audio') {
    const format = firstString(message, ['format']);
    return format ? `audio/${format.replace(/^\./, '')}` : 'audio/mpeg';
  }
  return 'application/octet-stream';
}

export function toCcConnectBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) return sessionKey;
  if (!sessionKey.startsWith('agent:')) return sessionKey;
  const [, scope = 'main', user = 'main'] = sessionKey.split(':');
  return `clawx:${scope || 'main'}:${user || 'main'}`;
}

function normalizeClawXAgentId(value: string | undefined): string {
  const normalized = (value || 'main')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'main';
}

export function ccConnectProjectNameForAgent(agentId: string): string {
  return `${CLAWX_PROJECT_PREFIX}${normalizeClawXAgentId(agentId)}`;
}

export function ccConnectProjectNameForSessionKey(sessionKey: string): string {
  const bridgeKey = toCcConnectBridgeSessionKey(sessionKey);
  if (!bridgeKey.startsWith('clawx:')) return ccConnectProjectNameForAgent('main');
  const [, agentId] = bridgeKey.split(':');
  return ccConnectProjectNameForAgent(agentId);
}

function fromBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) {
    const [, scope = 'main', user = 'main'] = sessionKey.split(':');
    return `agent:${scope || 'main'}:${user || 'main'}`;
  }
  return sessionKey;
}

function sessionLookupKeys(sessionKey: string): string[] {
  const bridgeKey = toCcConnectBridgeSessionKey(sessionKey);
  return Array.from(new Set([sessionKey, bridgeKey, fromBridgeSessionKey(sessionKey)]));
}

function normalizeRawMessage(value: unknown, fallbackId: string): RawMessage | null {
  if (!isRecord(value)) return null;
  const role = typeof value.role === 'string' ? value.role : '';
  if (!['user', 'assistant', 'system', 'toolresult'].includes(role)) return null;
  const content = typeof value.content === 'string' || Array.isArray(value.content)
    ? value.content
    : '';
  const timestamp = normalizeTimestamp(value.timestamp ?? value.created_at ?? value.createdAt) ?? Date.now();
  return {
    id: typeof value.id === 'string' && value.id ? value.id : fallbackId,
    role: role as RawMessage['role'],
    content,
    timestamp,
    ...(value.isError === true ? { isError: true } : {}),
    ...(typeof value.errorMessage === 'string' ? { errorMessage: value.errorMessage } : {}),
  };
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function codexInputText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      return item.type === 'input_text' && typeof item.text === 'string' ? [item.text] : [];
    })
    .join('\n')
    .trim();
}

function parseJsonArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function codexDisplayToolName(name: string, args: unknown): string {
  if (name === 'exec_command' && isRecord(args) && typeof args.cmd === 'string') return 'Bash';
  return name || 'tool';
}

function readStringMap(value: unknown): Map<string, string> {
  if (!isRecord(value)) return new Map();
  return new Map(Object.entries(value).flatMap(([key, item]) => (
    typeof item === 'string' ? [[key, item]] : []
  )));
}

function readUserSessions(value: unknown): Map<string, string[]> {
  if (!isRecord(value)) return new Map();
  return new Map(Object.entries(value).map(([key, item]) => [
    key,
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : [],
  ]));
}

function readUserMeta(value: unknown): Map<string, Record<string, unknown>> {
  if (!isRecord(value)) return new Map();
  return new Map(Object.entries(value).flatMap(([key, item]) => (
    isRecord(item) ? [[key, item]] : []
  )));
}

function displayNameForPersistedSession(key: string, session: PersistedSession, meta?: Record<string, unknown>): string {
  const chatName = typeof meta?.chat_name === 'string' ? meta.chat_name.trim() : '';
  const userName = typeof meta?.user_name === 'string' ? meta.user_name.trim() : '';
  const metaName = [chatName, userName].filter(Boolean).join(' / ');
  if (metaName) return metaName.slice(0, 80);
  const firstUser = session.history.find((message) => message.role === 'user');
  return messageText(firstUser?.content).slice(0, 80) || session.name || key;
}

function sessionTitleFromHistory(history: RawMessage[]): string | undefined {
  const firstUser = history.find((message) => message.role === 'user');
  const title = messageText(firstUser?.content).slice(0, 80).trim();
  return title || undefined;
}

function sessionPreviewFromHistory(history: RawMessage[]): string | undefined {
  const latest = [...history].reverse().find((message) => {
    const text = messageText(message.content);
    return Boolean(text);
  });
  const preview = messageText(latest?.content).slice(0, 120).trim();
  return preview || undefined;
}

function projectNameFromStorePath(path: string): string {
  return basename(path).replace(/_[a-f0-9]{8}\.json$/i, '').replace(/\.json$/i, '');
}

function agentIdFromProjectName(projectName: string): string {
  if (!projectName.startsWith(CLAWX_PROJECT_PREFIX)) return 'main';
  return projectName.slice(CLAWX_PROJECT_PREFIX.length) || 'main';
}

export class CcConnectBridgeAdapter {
  private readonly port: number;
  private readonly token: string;
  private readonly project: string;
  private readonly projectForSessionKey: (sessionKey: string) => string;
  private readonly emitRuntimeEvent: EventEmitter['emit'];
  private readonly sessionStoreDir: string;
  private readonly codexSessionsDir: string;
  private socket: WebSocket | null = null;
  private readonly messagesBySession = new Map<string, RawMessage[]>();
  private readonly pendingRuns = new Map<string, PendingRun>();
  private readonly abortedRuns = new Map<string, AbortedRun>();

  constructor(options: BridgeAdapterOptions) {
    this.port = options.port;
    this.token = options.token;
    this.project = options.project;
    this.projectForSessionKey = options.projectForSessionKey ?? (() => options.project);
    this.emitRuntimeEvent = options.emit;
    this.sessionStoreDir = options.sessionStoreDir ?? join(getCcConnectManagedDir(), 'data', 'sessions');
    this.codexSessionsDir = options.codexSessionsDir ?? join(getCcConnectManagedDir(), 'codex-home', 'sessions');
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < CONNECT_TIMEOUT_MS) {
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'cc-connect bridge did not become ready'));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      socket.once('close', () => resolve());
      socket.close();
      setTimeout(resolve, 500);
    });
  }

  async send(payload: RuntimeSendWithMediaPayload): Promise<{ runId: string }> {
    this.pruneAbortedRuns();
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('cc-connect bridge is not connected');
    }
    const runId = `cc-connect-${randomUUID()}`;
    const now = Date.now();
    const userMessage: RawMessage = {
      id: `${runId}:user`,
      role: 'user',
      content: payload.message,
      timestamp: now,
    };
    this.appendMessage(payload.sessionKey, userMessage);
    this.pendingRuns.set(runId, {
      runId,
      sessionKey: payload.sessionKey,
      prompt: payload.message,
      startedAt: now,
      seq: 0,
      codexToolStarts: new Set(),
      codexToolCompletions: new Set(),
      codexToolNames: new Map(),
    });
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'run.started',
      runId,
      sessionKey: payload.sessionKey,
      startedAt: now,
      ts: now,
    });
    this.socket.send(JSON.stringify({
      type: 'message',
      msg_id: payload.idempotencyKey || runId,
      session_key: toCcConnectBridgeSessionKey(payload.sessionKey),
      user_id: 'main',
      user_name: 'ClawX',
      content: payload.message,
      reply_ctx: runId,
      project: this.projectForSessionKey(payload.sessionKey),
      images: [],
      files: payload.media?.map((item) => ({
        mime_type: item.mimeType,
        file_name: item.fileName,
        path: item.filePath,
      })) ?? [],
    }));
    return { runId };
  }

  async abort(payload?: unknown): Promise<{ success: true; abortedRuns: string[] }> {
    const body = isRecord(payload) ? payload : {};
    const requestedRunId = typeof body.runId === 'string' && body.runId.trim()
      ? body.runId.trim()
      : undefined;
    const requestedSessionKey = typeof body.sessionKey === 'string' && body.sessionKey.trim()
      ? body.sessionKey.trim()
      : undefined;
    const matches = Array.from(this.pendingRuns.entries()).filter(([runId, pending]) => {
      if (requestedRunId) return runId === requestedRunId;
      if (requestedSessionKey) {
        return pending.sessionKey === requestedSessionKey
          || toCcConnectBridgeSessionKey(pending.sessionKey) === requestedSessionKey
          || pending.sessionKey === fromBridgeSessionKey(requestedSessionKey);
      }
      return true;
    });
    const now = Date.now();
    const abortedRuns: string[] = [];
    for (const [runId, pending] of matches) {
      this.pendingRuns.delete(runId);
      this.abortedRuns.set(runId, { sessionKey: pending.sessionKey, abortedAt: now });
      abortedRuns.push(runId);
      this.emitRuntimeEvent('chat:runtime-event', {
        type: 'run.ended',
        runId,
        sessionKey: pending.sessionKey,
        status: 'aborted',
        endedAt: now,
        seq: pending.seq + 1,
        ts: now,
        stopReason: 'user',
      });
    }
    return { success: true, abortedRuns };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const sessionsByKey = new Map<string, SessionMetadata>();
    for (const persisted of await this.readPersistedSessionStores()) {
      for (const [storedKey, sessionId] of persisted.activeSession.entries()) {
        const session = persisted.sessions.get(sessionId);
        if (!session) continue;
        const key = fromBridgeSessionKey(storedKey);
        const history = session.history;
        if (history.length === 0) continue;
        const updatedAt = history.reduce((latest, message) => {
          const ts = normalizeTimestamp(message.timestamp);
          return ts ? Math.max(latest, ts) : latest;
        }, session.updatedAt);
        const item = {
          key,
          displayName: displayNameForPersistedSession(key, { ...session, history }, persisted.userMeta.get(storedKey)),
          derivedTitle: sessionTitleFromHistory(history),
          lastMessagePreview: sessionPreviewFromHistory(history),
          agentId: session.agentId,
          createdAt: session.createdAt,
          updatedAt,
        };
        const existing = sessionsByKey.get(key);
        if (!existing || item.updatedAt >= existing.updatedAt) {
          sessionsByKey.set(key, item);
        }
      }
    }
    for (const [key, messages] of this.messagesBySession.entries()) {
      const firstUser = messages.find((message) => message.role === 'user');
      const lastTimestamp = messages.reduce((latest, message) => {
        const ts = normalizeTimestamp(message.timestamp);
        return ts ? Math.max(latest, ts) : latest;
      }, 0);
      const derivedTitle = sessionTitleFromHistory(messages);
      sessionsByKey.set(key, {
        key,
        displayName: derivedTitle || messageText(firstUser?.content).slice(0, 80) || key,
        derivedTitle,
        lastMessagePreview: sessionPreviewFromHistory(messages),
        createdAt: normalizeTimestamp(messages[0]?.timestamp) ?? lastTimestamp,
        updatedAt: lastTimestamp,
      });
    }
    return Array.from(sessionsByKey.values()).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    const messages = [
      ...await this.readPersistedMessages(sessionKey, limit),
      ...(this.messagesBySession.get(sessionKey) ?? []),
    ];
    return messages.slice(-Math.max(1, Math.min(Math.floor(limit), 1000)));
  }

  async deleteSession(sessionKey: string): Promise<void> {
    this.messagesBySession.delete(sessionKey);
    await this.deletePersistedSession(sessionKey);
  }

  async summarizeSessions(sessionKeys: string[]): Promise<Array<{ sessionKey: string; firstUserText: string | null; lastTimestamp: number | null }>> {
    return Promise.all(sessionKeys.map(async (sessionKey) => {
      const messages = [
        ...await this.readPersistedMessages(sessionKey, 1000),
        ...(this.messagesBySession.get(sessionKey) ?? []),
      ];
      const firstUser = messages.find((message) => message.role === 'user');
      const lastTimestamp = messages.reduce<number | null>((latest, message) => {
        const ts = normalizeTimestamp(message.timestamp);
        if (!ts) return latest;
        return latest == null ? ts : Math.max(latest, ts);
      }, null);
      return {
        sessionKey,
        firstUserText: messageText(firstUser?.content) || null,
        lastTimestamp,
      };
    }));
  }

  async reconcilePendingRunsFromHistory(): Promise<void> {
    const pendingRuns = Array.from(this.pendingRuns.values());
    for (const pending of pendingRuns) {
      await this.emitCodexTranscriptToolEventsForPendingRun(pending);
      const messages = await this.readPersistedMessages(pending.sessionKey, 1000);
      const completion = this.findPersistedCompletionForPendingRun(pending, messages);
      if (!completion) continue;
      await this.finishPendingRun(pending, {
        text: messageText(completion.content),
        isError: completion.isError === true,
        appendMessage: false,
        messageId: completion.id,
        timestamp: normalizeTimestamp(completion.timestamp),
      });
    }
  }

  private async emitCodexTranscriptToolEventsForPendingRun(pending: PendingRun): Promise<void> {
    const files = await this.findRecentCodexTranscriptFiles(pending.startedAt - CODEX_TRANSCRIPT_LOOKBACK_MS);
    for (const file of files) {
      const content = await readFile(file, 'utf8').catch(() => '');
      if (!content) continue;
      this.emitCodexTranscriptToolEventsFromContent(pending, content);
    }
  }

  private async findRecentCodexTranscriptFiles(sinceMs: number): Promise<string[]> {
    const results: Array<{ path: string; mtimeMs: number }> = [];
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (depth > CODEX_TRANSCRIPT_MAX_DEPTH) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      await Promise.all(entries.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath, depth + 1);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
        const info = await stat(fullPath).catch(() => null);
        if (!info || info.mtimeMs < sinceMs) return;
        results.push({ path: fullPath, mtimeMs: info.mtimeMs });
      }));
    };
    await visit(this.codexSessionsDir, 0);
    return results
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, CODEX_TRANSCRIPT_MAX_FILES)
      .map((item) => item.path);
  }

  private emitCodexTranscriptToolEventsFromContent(pending: PendingRun, content: string): void {
    const expectedPrompt = normalizeComparableText(pending.prompt);
    if (!expectedPrompt) return;
    let inMatchingTurn = false;

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(record)) continue;
      const ts = normalizeTimestamp(record.timestamp);
      if (ts != null && ts < pending.startedAt - CODEX_TRANSCRIPT_LOOKBACK_MS) continue;
      const payload = isRecord(record.payload) ? record.payload : null;
      if (!payload) continue;

      if (record.type === 'event_msg' && payload.type === 'user_message') {
        inMatchingTurn = normalizeComparableText(typeof payload.message === 'string' ? payload.message : '') === expectedPrompt;
        continue;
      }
      if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
        const text = codexInputText(payload.content);
        inMatchingTurn = normalizeComparableText(text) === expectedPrompt;
        continue;
      }
      if (record.type === 'event_msg' && payload.type === 'task_complete') {
        inMatchingTurn = false;
        continue;
      }
      if (!inMatchingTurn || record.type !== 'response_item') continue;

      if (payload.type === 'function_call') {
        const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const rawName = typeof payload.name === 'string' ? payload.name : 'tool';
        if (!toolCallId || pending.codexToolStarts.has(toolCallId)) continue;
        const args = parseJsonArguments(payload.arguments);
        const name = codexDisplayToolName(rawName, args);
        pending.codexToolStarts.add(toolCallId);
        pending.codexToolNames.set(toolCallId, name);
        pending.seq += 1;
        this.emitRuntimeEvent('chat:runtime-event', {
          type: 'tool.started',
          runId: pending.runId,
          sessionKey: pending.sessionKey,
          toolCallId,
          name,
          ...(args !== undefined ? { args } : {}),
          seq: pending.seq,
          ts: ts ?? Date.now(),
        });
        continue;
      }

      if (payload.type === 'function_call_output') {
        const toolCallId = typeof payload.call_id === 'string' ? payload.call_id : '';
        if (!toolCallId || pending.codexToolCompletions.has(toolCallId)) continue;
        pending.codexToolCompletions.add(toolCallId);
        pending.seq += 1;
        this.emitRuntimeEvent('chat:runtime-event', {
          type: 'tool.completed',
          runId: pending.runId,
          sessionKey: pending.sessionKey,
          toolCallId,
          name: pending.codexToolNames.get(toolCallId) || 'tool',
          ...(payload.output !== undefined ? { result: payload.output } : {}),
          seq: pending.seq,
          ts: ts ?? Date.now(),
        });
      }
    }
  }

  private async readPersistedSessionStores(): Promise<PersistedSessionStore[]> {
    const names = await readdir(this.sessionStoreDir).catch(() => []);
    return (await Promise.all(names
      .filter((name) => name.endsWith('.json'))
      .map((name) => this.readPersistedSessionStore(join(this.sessionStoreDir, name)))))
      .filter((store): store is PersistedSessionStore => Boolean(store));
  }

  private async readPersistedSessionStore(path: string): Promise<PersistedSessionStore | null> {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (!isRecord(raw) || !isRecord(raw.sessions)) return null;
      const projectName = projectNameFromStorePath(path);
      const agentId = agentIdFromProjectName(projectName);
      const sessions = new Map<string, PersistedSession>();
      const rawSessions = new Map<string, Record<string, unknown>>();
      for (const [id, value] of Object.entries(raw.sessions)) {
        if (!isRecord(value)) continue;
        rawSessions.set(id, value);
        const history = Array.isArray(value.history)
          ? value.history.flatMap((message, index) => {
              const normalized = normalizeRawMessage(message, `${id}:${index}`);
              return normalized ? [normalized] : [];
            })
          : [];
        const updatedAt = normalizeTimestamp(value.updated_at ?? value.updatedAt)
          ?? history.reduce((latest, message) => Math.max(latest, normalizeTimestamp(message.timestamp) ?? 0), 0);
        const createdAt = normalizeTimestamp(value.created_at ?? value.createdAt)
          ?? normalizeTimestamp(history[0]?.timestamp)
          ?? updatedAt;
        sessions.set(id, {
          id,
          name: typeof value.name === 'string' ? value.name : undefined,
          projectName,
          agentId,
          history,
          createdAt,
          updatedAt,
        });
      }
      return {
        path,
        projectName,
        agentId,
        sessions,
        rawSessions,
        activeSession: readStringMap(raw.active_session),
        userSessions: readUserSessions(raw.user_sessions),
        userMeta: readUserMeta(raw.user_meta),
        raw,
      };
    } catch {
      return null;
    }
  }

  private async readPersistedMessages(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    for (const store of await this.readPersistedSessionStores()) {
      for (const key of sessionLookupKeys(sessionKey)) {
        const sessionId = store.activeSession.get(key);
        const session = sessionId ? store.sessions.get(sessionId) : undefined;
        if (!session) continue;
        if (session.history.length > 0) return session.history.slice(-Math.max(1, Math.min(Math.floor(limit), 1000)));
        return [];
      }
    }
    return [];
  }

  private async deletePersistedSession(sessionKey: string): Promise<void> {
    for (const store of await this.readPersistedSessionStores()) {
      let changed = false;
      for (const key of sessionLookupKeys(sessionKey)) {
        const sessionId = store.activeSession.get(key);
        if (!sessionId) continue;
        store.sessions.delete(sessionId);
        store.rawSessions.delete(sessionId);
        store.activeSession.delete(key);
        store.userSessions.delete(key);
        store.userMeta.delete(key);
        changed = true;
      }
      if (!changed) continue;
      const next = {
        ...store.raw,
        sessions: Object.fromEntries(store.rawSessions.entries()),
        active_session: Object.fromEntries(store.activeSession.entries()),
        user_sessions: Object.fromEntries(store.userSessions.entries()),
        user_meta: Object.fromEntries(store.userMeta.entries()),
      };
      await mkdir(this.sessionStoreDir, { recursive: true });
      await writeFile(store.path, JSON.stringify(next, null, 2), 'utf8');
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.port}/bridge/ws?token=${encodeURIComponent(this.token)}`);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('cc-connect bridge connection timed out'));
      }, 1500);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      socket.once('open', () => {
        socket.send(JSON.stringify({
          type: 'register',
          platform: 'clawx',
          project: this.project,
          capabilities: [
            'text',
            'image',
            'file',
            'audio',
            'card',
            'buttons',
            'typing',
            'preview',
            'update_message',
            'delete_message',
            'reconstruct_reply',
            'tool_events',
            'command_output',
            'patch_events',
          ],
          metadata: {
            protocol_version: 1,
            description: 'ClawX GUI bridge adapter',
          },
        }));
      });
      socket.on('message', (data) => {
        const parsed = this.parseMessage(data);
        if (!parsed) return;
        if (parsed.type === 'register_ack') {
          if (parsed.ok === true) {
            this.socket = socket;
            finish();
          } else {
            finish(new Error(typeof parsed.error === 'string' ? parsed.error : 'cc-connect bridge registration failed'));
          }
          return;
        }
        this.handleServerMessage(parsed);
      });
      socket.once('error', (error) => finish(error));
      socket.once('close', () => {
        if (this.socket === socket) this.socket = null;
      });
    });
  }

  private parseMessage(data: WebSocket.RawData): Record<string, unknown> | null {
    try {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : String(data);
      const parsed = JSON.parse(text);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private handleServerMessage(message: Record<string, unknown>): void {
    if (message.type === 'ping') {
      this.socket?.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }
    if (message.type === 'preview_start') {
      this.socket?.send(JSON.stringify({
        type: 'preview_ack',
        ref_id: message.ref_id,
        preview_handle: String(message.ref_id || randomUUID()),
      }));
      return;
    }
    if (message.type === 'update_message') {
      this.emitAssistantDelta({
        ...message,
        full_text: typeof message.content === 'string' ? message.content : '',
      });
      return;
    }
    if (message.type === 'delete_message' || message.type === 'typing_start' || message.type === 'typing_stop') {
      return;
    }
    const toolEventKind = isBridgeToolMessage(message);
    if (toolEventKind) {
      this.handleBridgeToolMessage(message, toolEventKind);
      return;
    }
    if (message.type === 'reply') {
      void this.finishRun(message, typeof message.content === 'string' ? message.content : '');
      return;
    }
    if (message.type === 'reply_stream' && message.done !== true) {
      this.emitAssistantDelta(message);
      return;
    }
    if (message.type === 'reply_stream' && message.done === true) {
      const text = typeof message.full_text === 'string'
        ? message.full_text
        : typeof message.delta === 'string'
          ? message.delta
          : '';
      void this.finishRun(message, text);
      return;
    }
    if (message.type === 'card') {
      void this.finishRun(message, JSON.stringify(message.card ?? {}));
      return;
    }
    if (message.type === 'buttons') {
      void this.finishRun(message, typeof message.content === 'string' ? message.content : '');
      return;
    }
    if (message.type === 'image' || message.type === 'file' || message.type === 'audio') {
      void this.finishMediaRun(message, message.type);
      return;
    }
    if (message.type === 'error') {
      void this.finishRun(message, typeof message.message === 'string' ? message.message : 'cc-connect bridge error', true);
    }
  }

  private handleBridgeToolMessage(message: Record<string, unknown>, kind: BridgeToolEventKind): void {
    if (this.isAbortedBridgeMessage(message)) return;
    const resolved = this.resolvePendingRun(message);
    const runId = resolved?.runId || firstString(message, ['reply_ctx', 'run_id', 'runId']) || `cc-connect-${randomUUID()}`;
    const sessionKey = resolved?.pending.sessionKey
      || (typeof message.session_key === 'string' ? fromBridgeSessionKey(message.session_key) : 'agent:main:main');
    const now = Date.now();
    const seq = resolved ? (resolved.pending.seq += 1) : undefined;
    const toolCallId = bridgeToolCallId(message);
    const fallbackName = kind === 'patch-completed' ? 'patch' : kind === 'command-output' ? 'command' : 'tool';
    const name = bridgeToolName(message, fallbackName);
    const args = normalizeBridgeToolArgs(message);
    const result = firstPayloadValue(message, ['result', 'output', 'content', 'data', 'error']);
    const output = typeof message.output === 'string'
      ? message.output
      : typeof message.content === 'string'
        ? message.content
        : typeof result === 'string'
          ? result
          : undefined;

    if (kind === 'started') {
      this.emitRuntimeEvent('chat:runtime-event', {
        type: 'tool.started',
        runId,
        sessionKey,
        toolCallId,
        name,
        ...(args !== undefined ? { args } : {}),
        ...(seq !== undefined ? { seq } : {}),
        ts: now,
      });
      if (looksLikeGeneratedFileTool(message, name, args)) {
        this.emitToolCallMessage({ runId, sessionKey, toolCallId, name, args, timestamp: now });
      }
      return;
    }

    if (kind === 'updated') {
      this.emitRuntimeEvent('chat:runtime-event', {
        type: 'tool.updated',
        runId,
        sessionKey,
        toolCallId,
        name,
        ...(result !== undefined ? { partialResult: result } : {}),
        ...(seq !== undefined ? { seq } : {}),
        ts: now,
      });
      return;
    }

    if (kind === 'completed') {
      this.emitRuntimeEvent('chat:runtime-event', {
        type: 'tool.completed',
        runId,
        sessionKey,
        toolCallId,
        name,
        ...(result !== undefined ? { result } : {}),
        ...(message.meta !== undefined ? { meta: message.meta } : {}),
        ...(message.is_error === true || message.isError === true ? { isError: true } : {}),
        ...(seq !== undefined ? { seq } : {}),
        ts: now,
      });
      return;
    }

    if (kind === 'command-output') {
      this.emitRuntimeEvent('chat:runtime-event', {
        type: 'command.output',
        runId,
        sessionKey,
        toolCallId,
        itemId: firstString(message, ['item_id', 'itemId', 'id']) || toolCallId,
        name,
        title: firstString(message, ['title']) || name,
        ...(output !== undefined ? { output } : {}),
        ...(firstString(message, ['status', 'phase']) ? { status: firstString(message, ['status', 'phase']) } : {}),
        ...(typeof message.phase === 'string' ? { phase: message.phase } : {}),
        ...(typeof message.exit_code === 'number' ? { exitCode: message.exit_code } : {}),
        ...(typeof message.exitCode === 'number' ? { exitCode: message.exitCode } : {}),
        ...(typeof message.duration_ms === 'number' ? { durationMs: message.duration_ms } : {}),
        ...(typeof message.durationMs === 'number' ? { durationMs: message.durationMs } : {}),
        ...(typeof message.cwd === 'string' ? { cwd: message.cwd } : {}),
        ...(seq !== undefined ? { seq } : {}),
        ts: now,
      });
      return;
    }

    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'patch.completed',
      runId,
      sessionKey,
      toolCallId,
      itemId: firstString(message, ['item_id', 'itemId', 'id']) || toolCallId,
      name,
      title: firstString(message, ['title']) || name,
      summary: firstString(message, ['summary', 'content', 'output']),
      added: numberFromUnknown(message.added ?? message.additions),
      modified: numberFromUnknown(message.modified ?? message.changed),
      deleted: numberFromUnknown(message.deleted ?? message.deletions),
      ...(seq !== undefined ? { seq } : {}),
      ts: now,
    });
  }

  private emitToolCallMessage(options: {
    runId: string;
    sessionKey: string;
    toolCallId: string;
    name: string;
    args: unknown;
    timestamp: number;
  }): void {
    const message: RawMessage = {
      id: `${options.runId}:${options.toolCallId}:tool`,
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: options.toolCallId,
        name: options.name,
        arguments: options.args ?? {},
      }],
      timestamp: options.timestamp,
      stopReason: 'tool_use',
    };
    this.appendMessage(options.sessionKey, message);
    this.emitRuntimeEvent('chat:message', {
      state: 'final',
      runId: options.runId,
      sessionKey: options.sessionKey,
      message,
    });
  }

  private async finishMediaRun(message: Record<string, unknown>, kind: BridgeMediaKind): Promise<void> {
    if (this.isAbortedBridgeMessage(message)) return;
    const attachment = await this.normalizeBridgeMediaAttachment(message, kind);
    const label = firstString(message, ['content', 'caption', 'title', 'file_name', 'fileName', 'name'])
      || attachment.fileName;
    const resolved = this.resolvePendingRun(message);
    if (resolved) {
      await this.finishPendingRun(resolved.pending, {
        text: label,
        attachedFiles: [attachment],
      });
      return;
    }

    const runId = typeof message.reply_ctx === 'string' ? message.reply_ctx : '';
    const sessionKey = typeof message.session_key === 'string'
      ? fromBridgeSessionKey(message.session_key)
      : 'agent:main:main';
    const now = Date.now();
    const assistantMessage: RawMessage = {
      id: `${runId || randomUUID()}:${kind}`,
      role: 'assistant',
      content: label,
      timestamp: now,
      _attachedFiles: [attachment],
    };
    this.appendMessage(sessionKey, assistantMessage);
    this.emitRuntimeEvent('chat:message', {
      state: 'final',
      runId,
      sessionKey,
      message: assistantMessage,
    });
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'run.ended',
      runId,
      sessionKey,
      status: 'completed',
      endedAt: now,
      ts: now,
    });
  }

  private async normalizeBridgeMediaAttachment(
    message: Record<string, unknown>,
    kind: BridgeMediaKind,
  ): Promise<AttachedFileMeta> {
    const mimeType = mimeTypeForBridgeMedia(kind, message);
    const fileName = sanitizeFileName(
      firstString(message, ['file_name', 'fileName', 'name', 'filename'])
        || `${kind}.${extensionForMimeType(mimeType, kind === 'audio' ? 'mp3' : 'bin')}`,
    );
    const filePath = firstString(message, ['path', 'file_path', 'filePath', 'local_path', 'localPath']);
    const url = firstString(message, ['url', 'file_url', 'fileUrl']);
    const rawData = firstString(message, ['data', 'base64']);
    const dataMatch = rawData?.match(/^data:([^;]+);base64,(.*)$/);
    const base64Data = dataMatch ? dataMatch[2] : rawData;
    const dataMimeType = dataMatch?.[1] || mimeType;

    if (base64Data) {
      const buffer = Buffer.from(base64Data, 'base64');
      const outputDir = join(getCcConnectMediaDir(), 'outgoing', 'bridge');
      await mkdir(outputDir, { recursive: true });
      const outputPath = join(outputDir, `${Date.now()}-${randomUUID()}-${fileName}`);
      await writeFile(outputPath, buffer);
      return {
        fileName,
        mimeType: dataMimeType,
        fileSize: buffer.byteLength,
        preview: dataMimeType.startsWith('image/') ? `data:${dataMimeType};base64,${base64Data}` : null,
        filePath: outputPath,
        source: 'gateway-media',
      };
    }

    if (filePath) {
      return {
        fileName,
        mimeType,
        fileSize: numberFromUnknown(message.file_size ?? message.fileSize ?? message.size),
        preview: null,
        filePath,
        source: 'gateway-media',
      };
    }

    return {
      fileName,
      mimeType,
      fileSize: numberFromUnknown(message.file_size ?? message.fileSize ?? message.size),
      preview: kind === 'image' && url && !url.startsWith('/') ? url : null,
      ...(url?.startsWith('/') ? { gatewayUrl: url } : {}),
      source: 'gateway-media',
    };
  }

  private emitAssistantDelta(message: Record<string, unknown>): void {
    const resolved = this.resolvePendingRun(message);
    if (!resolved) return;
    const { runId, pending } = resolved;
    const fullText = typeof message.full_text === 'string' ? message.full_text : '';
    const delta = typeof message.delta === 'string' ? message.delta : '';
    const text = typeof message.text === 'string' ? message.text : fullText;
    if (!text && !delta) return;
    const now = Date.now();
    pending.seq += 1;
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'assistant.delta',
      runId,
      sessionKey: pending.sessionKey,
      seq: pending.seq,
      ts: now,
      ...(text ? { text, replace: true } : { delta }),
    });
  }

  private async finishRun(message: Record<string, unknown>, text: string, isError = false): Promise<void> {
    if (this.isAbortedBridgeMessage(message)) return;
    const resolved = this.resolvePendingRun(message);
    if (resolved) {
      await this.finishPendingRun(resolved.pending, { text, isError });
      return;
    }
    const runId = typeof message.reply_ctx === 'string' ? message.reply_ctx : '';
    const now = Date.now();
    const assistantMessage: RawMessage = {
      id: `${runId || randomUUID()}:assistant`,
      role: isError ? 'system' : 'assistant',
      content: text,
      timestamp: now,
      ...(isError ? { isError: true, errorMessage: text } : {}),
    };
    this.appendMessage('agent:main:main', assistantMessage);
    this.emitRuntimeEvent('chat:message', {
      state: 'final',
      runId,
      sessionKey: 'agent:main:main',
      message: assistantMessage,
    });
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'run.ended',
      runId,
      sessionKey: 'agent:main:main',
      status: isError ? 'error' : 'completed',
      endedAt: now,
      ts: now,
      ...(isError ? { error: text } : {}),
    });
  }

  private resolvePendingRun(message: Record<string, unknown>): PendingRunResolution | null {
    const replyCtx = typeof message.reply_ctx === 'string' ? message.reply_ctx : '';
    const byReplyCtx = replyCtx ? this.pendingRuns.get(replyCtx) : undefined;
    if (byReplyCtx) return { runId: replyCtx, pending: byReplyCtx };

    const bridgeSessionKey = typeof message.session_key === 'string' ? message.session_key : '';
    if (bridgeSessionKey) {
      const sessionKey = fromBridgeSessionKey(bridgeSessionKey);
      for (const [runId, pending] of this.pendingRuns.entries()) {
        if (pending.sessionKey === sessionKey || toCcConnectBridgeSessionKey(pending.sessionKey) === bridgeSessionKey) {
          return { runId, pending };
        }
      }
    }

    if (this.pendingRuns.size === 1) {
      const [runId, pending] = Array.from(this.pendingRuns.entries())[0];
      return { runId, pending };
    }
    return null;
  }

  private findPersistedCompletionForPendingRun(pending: PendingRun, messages: RawMessage[]): RawMessage | null {
    const startedAt = pending.startedAt - 5_000;
    const candidates = messages.filter((message) => {
      if (message.role !== 'assistant' && message.role !== 'system') return false;
      if (!messageText(message.content)) return false;
      const timestamp = normalizeTimestamp(message.timestamp);
      return timestamp == null || timestamp >= startedAt;
    });
    return candidates.at(-1) ?? null;
  }

  private async finishPendingRun(pending: PendingRun, options: {
    text: string;
    isError?: boolean;
    appendMessage?: boolean;
    messageId?: string;
    timestamp?: number;
    attachedFiles?: AttachedFileMeta[];
  }): Promise<void> {
    await this.emitCodexTranscriptToolEventsForPendingRun(pending);
    const now = options.timestamp ?? Date.now();
    const isError = options.isError === true;
    const assistantMessage: RawMessage = {
      id: options.messageId || `${pending.runId}:assistant`,
      role: isError ? 'system' : 'assistant',
      content: options.text,
      timestamp: now,
      ...(isError ? { isError: true, errorMessage: options.text } : {}),
      ...(options.attachedFiles?.length ? { _attachedFiles: options.attachedFiles } : {}),
    };
    if (options.appendMessage !== false) {
      this.appendMessage(pending.sessionKey, assistantMessage);
      this.emitRuntimeEvent('chat:message', {
        state: 'final',
        runId: pending.runId,
        sessionKey: pending.sessionKey,
        message: assistantMessage,
      });
    }
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'run.ended',
      runId: pending.runId,
      sessionKey: pending.sessionKey,
      status: isError ? 'error' : 'completed',
      endedAt: now,
      seq: pending.seq + 1,
      ts: now,
      ...(isError ? { error: options.text } : {}),
    });
    this.pendingRuns.delete(pending.runId);
  }

  private isAbortedBridgeMessage(message: Record<string, unknown>): boolean {
    this.pruneAbortedRuns();
    const replyCtx = typeof message.reply_ctx === 'string' ? message.reply_ctx : '';
    if (replyCtx && this.abortedRuns.has(replyCtx)) return true;
    if (replyCtx) return false;
    const bridgeSessionKey = typeof message.session_key === 'string' ? message.session_key : '';
    if (!bridgeSessionKey) return false;
    const sessionKey = fromBridgeSessionKey(bridgeSessionKey);
    const hasPendingForSession = Array.from(this.pendingRuns.values()).some((pending) => (
      pending.sessionKey === sessionKey || toCcConnectBridgeSessionKey(pending.sessionKey) === bridgeSessionKey
    ));
    if (hasPendingForSession) return false;
    return Array.from(this.abortedRuns.values()).some((aborted) => aborted.sessionKey === sessionKey);
  }

  private pruneAbortedRuns(): void {
    const cutoff = Date.now() - ABORTED_RUN_TTL_MS;
    for (const [runId, aborted] of this.abortedRuns.entries()) {
      if (aborted.abortedAt < cutoff) this.abortedRuns.delete(runId);
    }
  }

  private appendMessage(sessionKey: string, message: RawMessage): void {
    this.messagesBySession.set(sessionKey, [
      ...(this.messagesBySession.get(sessionKey) ?? []),
      message,
    ]);
  }
}
