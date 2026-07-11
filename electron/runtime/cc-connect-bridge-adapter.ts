import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import WebSocket from 'ws';
import type { AttachedFileMeta, RawMessage } from '@shared/chat/types';
import type { RuntimeSendWithMediaPayload } from './types';
import { getCcConnectMediaDir } from '../utils/runtime-media-paths';
import * as logger from '../utils/logger';

type BridgeAdapterOptions = {
  port: number;
  token: string;
  project: string;
  projectForSessionKey?: (sessionKey: string) => string;
  emit: EventEmitter['emit'];
  heartbeatIntervalMs?: number;
  reconnectDelayMs?: number;
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

type BridgeProgressItem = {
  kind: 'info' | 'thinking' | 'tool_use' | 'tool_result' | 'error';
  text: string;
  tool?: string;
  status?: string;
  exit_code?: number;
  success?: boolean;
};

type BridgeProgressState = {
  runId: string;
  sessionKey: string;
  seenByIndex: Map<number, string>;
  toolCallIdByIndex: Map<number, string>;
  toolNameByIndex: Map<number, string>;
  completedToolIndexes: Set<number>;
  windowBase: number;
  windowFingerprints: string[];
};

type BridgeApprovalAction = {
  action: string;
  label?: string;
};

type PendingApproval = {
  runId: string;
  sessionKey: string;
  bridgeSessionKey: string;
  replyCtx: string;
  project: string;
  itemId: string;
  title: string;
  kind: 'permission' | 'question';
  message: string;
  actions: BridgeApprovalAction[];
};

const CONNECT_TIMEOUT_MS = 15_000;
const BRIDGE_HEARTBEAT_INTERVAL_MS = 25_000;
const BRIDGE_RECONNECT_DELAY_MS = 3_000;
const CLAWX_PROJECT_PREFIX = 'clawx-';
export const CLAWX_BRIDGE_ADMIN_USER_ID = 'clawx-desktop';
const ABORTED_RUN_TTL_MS = 10 * 60_000;
const PROGRESS_CARD_PAYLOAD_PREFIX = '__cc_connect_progress_card_v1__:';
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
  if (direct !== undefined) return parseJsonToolArgs(direct);
  if (tool) {
    const nested = firstPayloadValue(tool, TOOL_ARG_KEYS);
    if (nested !== undefined) return parseJsonToolArgs(nested);
  }

  const collected: Record<string, unknown> = {};
  for (const key of [...FILE_ARG_KEYS, ...EDIT_ARG_KEYS, 'cwd', 'exit_code', 'exitCode', 'output', 'status']) {
    if (message[key] !== undefined) collected[key] = message[key];
    if (tool?.[key] !== undefined) collected[key] = tool[key];
  }
  return Object.keys(collected).length > 0 ? collected : undefined;
}

function parseJsonToolArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if ((!trimmed.startsWith('{') || !trimmed.endsWith('}'))
    && (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
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

function parseBridgeProgressItems(content: unknown): BridgeProgressItem[] | null {
  if (typeof content !== 'string' || !content.startsWith(PROGRESS_CARD_PAYLOAD_PREFIX)) return null;
  try {
    const payload = JSON.parse(content.slice(PROGRESS_CARD_PAYLOAD_PREFIX.length));
    if (!isRecord(payload) || !Array.isArray(payload.items)) return null;
    return payload.items.flatMap((value): BridgeProgressItem[] => {
      if (!isRecord(value)) return [];
      const kind = firstString(value, ['kind']);
      const text = firstString(value, ['text']);
      if (!kind || !text || !['info', 'thinking', 'tool_use', 'tool_result', 'error'].includes(kind)) return [];
      return [{
        kind: kind as BridgeProgressItem['kind'],
        text,
        tool: firstString(value, ['tool']),
        status: firstString(value, ['status']),
        ...(typeof value.exit_code === 'number' ? { exit_code: value.exit_code } : {}),
        ...(typeof value.success === 'boolean' ? { success: value.success } : {}),
      }];
    });
  } catch {
    return null;
  }
}

function bridgeButtonActions(message: Record<string, unknown>): BridgeApprovalAction[] {
  if (!Array.isArray(message.buttons)) return [];
  return message.buttons.flatMap((row) => {
    const entries = Array.isArray(row) ? row : [row];
    return entries.flatMap((button) => {
      if (!isRecord(button)) return [];
      const action = firstString(button, ['data', 'Data', 'value', 'Value', 'action', 'Action']);
      if (!action) return [];
      const label = firstString(button, ['text', 'Text', 'label', 'Label', 'title', 'Title']);
      return [{ action, ...(label ? { label } : {}) }];
    });
  });
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
  return /^(write|writefile|write_file|create_file|edit|editfile|edit_file|str_replace|strreplace|multi_edit|multiedit|apply_patch|applypatch|patch)$/i.test(name);
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
  const [, scope = 'main', ...userParts] = sessionKey.split(':');
  const user = userParts.join(':') || 'main';
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
    const [, scope = 'main', ...userParts] = sessionKey.split(':');
    const user = userParts.join(':') || 'main';
    return `agent:${scope || 'main'}:${user || 'main'}`;
  }
  return sessionKey;
}

export class CcConnectBridgeAdapter {
  private readonly port: number;
  private readonly token: string;
  private readonly project: string;
  private readonly projectForSessionKey: (sessionKey: string) => string;
  private readonly emitRuntimeEvent: EventEmitter['emit'];
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectDelayMs: number;
  private socket: WebSocket | null = null;
  private readonly connectingSockets = new Set<WebSocket>();
  private connectInFlight: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private readonly messagesBySession = new Map<string, RawMessage[]>();
  private readonly pendingRuns = new Map<string, PendingRun>();
  private readonly abortedRuns = new Map<string, AbortedRun>();
  private readonly progressByHandle = new Map<string, BridgeProgressState>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(options: BridgeAdapterOptions) {
    this.port = options.port;
    this.token = options.token;
    this.project = options.project;
    this.projectForSessionKey = options.projectForSessionKey ?? (() => options.project);
    this.emitRuntimeEvent = options.emit;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? BRIDGE_HEARTBEAT_INTERVAL_MS;
    this.reconnectDelayMs = options.reconnectDelayMs ?? BRIDGE_RECONNECT_DELAY_MS;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectInFlight) return await this.connectInFlight;
    const attempt = this.connectWithRetry();
    this.connectInFlight = attempt;
    try {
      await attempt;
    } finally {
      if (this.connectInFlight === attempt) this.connectInFlight = null;
    }
  }

  private async connectWithRetry(): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (this.shouldReconnect && Date.now() - startedAt < CONNECT_TIMEOUT_MS) {
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
    this.shouldReconnect = false;
    this.clearHeartbeat();
    this.clearReconnectTimer();
    const sockets = new Set([
      ...this.connectingSockets,
      ...(this.socket ? [this.socket] : []),
    ]);
    this.socket = null;
    await Promise.all(Array.from(sockets, async (socket) => {
      await new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        socket.once('close', () => resolve());
        socket.close();
        setTimeout(resolve, 500);
      });
    }));
    await this.connectInFlight?.catch(() => undefined);
    this.pendingApprovals.clear();
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
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
      user_id: CLAWX_BRIDGE_ADMIN_USER_ID,
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

  async abort(payload?: unknown): Promise<{
    success: true;
    abortedRuns: string[];
    stoppedSessions: string[];
    upstreamStopRequested: boolean;
  }> {
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
    const controlRunsBySession = new Map<string, string>();
    for (const [runId, pending] of matches) {
      this.pendingRuns.delete(runId);
      this.abortedRuns.set(runId, { sessionKey: pending.sessionKey, abortedAt: now });
      this.clearProgressForRun(runId);
      this.clearApprovalsForRun(runId);
      abortedRuns.push(runId);
      if (!controlRunsBySession.has(pending.sessionKey)) {
        controlRunsBySession.set(pending.sessionKey, runId);
      }
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
    const stoppedSessions: string[] = [];
    let upstreamStopRequested = true;
    for (const [sessionKey, runId] of controlRunsBySession.entries()) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        upstreamStopRequested = false;
        continue;
      }
      try {
        const socket = this.socket;
        await new Promise<void>((resolve, reject) => {
          socket.send(JSON.stringify({
            type: 'message',
            msg_id: `cc-connect-stop-${randomUUID()}`,
            session_key: toCcConnectBridgeSessionKey(sessionKey),
            user_id: CLAWX_BRIDGE_ADMIN_USER_ID,
            user_name: 'ClawX',
            content: '/stop',
            reply_ctx: runId,
            project: this.projectForSessionKey(sessionKey),
            images: [],
            files: [],
          }), (error) => error ? reject(error) : resolve());
        });
        stoppedSessions.push(sessionKey);
      } catch (error) {
        upstreamStopRequested = false;
        logger.warn('[cc-connect bridge] failed to send session stop command', {
          sessionKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { success: true, abortedRuns, stoppedSessions, upstreamStopRequested };
  }

  async respondApproval(payload?: unknown): Promise<{
    success: true;
    runId: string;
    action: string;
    status: 'approved' | 'denied' | 'answered';
  }> {
    const body = isRecord(payload) ? payload : {};
    const runId = firstString(body, ['runId']);
    const action = firstString(body, ['action']);
    if (!runId || !action) {
      throw new Error('cc-connect approval response requires runId and action');
    }
    const pending = this.pendingApprovals.get(runId);
    if (!pending) {
      throw new Error(`No pending cc-connect approval for run ${runId}`);
    }
    if (!pending.actions.some((candidate) => candidate.action === action)) {
      throw new Error(`cc-connect approval action is not available for run ${runId}`);
    }
    if (!this.pendingRuns.has(runId)) {
      this.pendingApprovals.delete(runId);
      throw new Error(`cc-connect run ${runId} is no longer active`);
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('cc-connect bridge is not connected');
    }

    this.socket.send(JSON.stringify({
      type: 'card_action',
      session_key: pending.bridgeSessionKey,
      action,
      reply_ctx: pending.replyCtx,
      project: pending.project,
    }));
    this.pendingApprovals.delete(runId);

    const status = action === 'perm:deny'
      ? 'denied'
      : action.startsWith('askq:')
        ? 'answered'
        : 'approved';
    const run = this.pendingRuns.get(runId);
    const now = Date.now();
    if (run) run.seq += 1;
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'approval.updated',
      runId,
      sessionKey: pending.sessionKey,
      itemId: pending.itemId,
      title: pending.title,
      kind: pending.kind,
      phase: 'resolved',
      status,
      message: pending.message,
      actions: pending.actions,
      ...(run ? { seq: run.seq } : {}),
      ts: now,
    });
    return { success: true, runId, action, status };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return Array.from(this.messagesBySession.entries())
      .filter(([, messages]) => messages.length > 0)
      .map(([key, messages]) => {
        const firstUser = messages.find((message) => message.role === 'user');
        const updatedAt = messages.reduce((latest, message) => {
          const timestamp = normalizeTimestamp(message.timestamp);
          return timestamp ? Math.max(latest, timestamp) : latest;
        }, 0);
        return {
          key,
          displayName: messageText(firstUser?.content).slice(0, 80) || key,
          derivedTitle: messageText(firstUser?.content).slice(0, 80) || undefined,
          lastMessagePreview: messageText(messages.at(-1)?.content).slice(0, 160) || undefined,
          agentId: ccConnectProjectNameForSessionKey(key).slice(CLAWX_PROJECT_PREFIX.length) || 'main',
          createdAt: normalizeTimestamp(messages[0]?.timestamp) ?? updatedAt,
          updatedAt,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    const messages = this.messagesBySession.get(sessionKey) ?? [];
    return messages.slice(-Math.max(1, Math.min(Math.floor(limit), 1000)));
  }

  forgetSession(sessionKey: string): void {
    this.messagesBySession.delete(sessionKey);
    for (const [runId, approval] of this.pendingApprovals.entries()) {
      if (approval.sessionKey === sessionKey) this.pendingApprovals.delete(runId);
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.port}/bridge/ws?token=${encodeURIComponent(this.token)}`);
      this.connectingSockets.add(socket);
      let settled = false;
      const timeout = setTimeout(() => {
        finish(new Error('cc-connect bridge connection timed out'));
      }, 1500);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connectingSockets.delete(socket);
        if (error) {
          if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) socket.close();
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
          ],
          metadata: {
            protocol_version: 1,
            adapter: 'clawx',
            progress_style: 'card',
            supports_progress_card_payload: true,
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
            this.startHeartbeat(socket);
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
        if (this.socket === socket) {
          this.socket = null;
          this.clearHeartbeat();
          this.scheduleReconnect();
        }
        finish(new Error('cc-connect bridge connection closed'));
      });
    });
  }

  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      } catch {
        socket.terminate();
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || this.socket?.readyState === WebSocket.OPEN) return;
      void this.connect().catch(() => this.scheduleReconnect());
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
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
    const progressItems = parseBridgeProgressItems(message.content);
    if (progressItems) {
      logger.debug(
        `[cc-connect bridge] progress packet type=${String(message.type || 'unknown')}`
        + ` itemKinds=${progressItems.map((item) => item.kind).join(',')}`,
      );
    }
    if (message.type === 'ping') {
      this.socket?.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }
    if (message.type === 'preview_start') {
      const handle = String(message.ref_id || randomUUID());
      this.handleBridgeProgress(message, handle);
      this.socket?.send(JSON.stringify({
        type: 'preview_ack',
        ref_id: message.ref_id,
        preview_handle: handle,
      }));
      return;
    }
    if (message.type === 'update_message') {
      const handle = firstString(message, ['preview_handle', 'previewHandle']);
      if (handle && this.handleBridgeProgress(message, handle)) return;
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
      if (this.handleBridgeApproval(message)) return;
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

  private handleBridgeProgress(message: Record<string, unknown>, handle: string): boolean {
    const items = parseBridgeProgressItems(message.content);
    if (!items) return false;
    let state = this.progressByHandle.get(handle);
    if (!state) {
      const resolved = this.resolvePendingRun(message);
      if (!resolved) return true;
      state = {
        runId: resolved.runId,
        sessionKey: resolved.pending.sessionKey,
        seenByIndex: new Map(),
        toolCallIdByIndex: new Map(),
        toolNameByIndex: new Map(),
        completedToolIndexes: new Set(),
        windowBase: 0,
        windowFingerprints: [],
      };
      this.progressByHandle.set(handle, state);
    }
    const pending = this.pendingRuns.get(state.runId);
    if (!pending || this.abortedRuns.has(state.runId)) return true;

    const windowBase = this.reconcileProgressWindow(state, items);
    for (let localIndex = 0; localIndex < items.length; localIndex += 1) {
      const item = items[localIndex];
      const index = windowBase + localIndex;
      const fingerprint = JSON.stringify(item);
      const previous = state.seenByIndex.get(index);
      if (previous === fingerprint) continue;
      state.seenByIndex.set(index, fingerprint);
      const now = Date.now();

      if (item.kind === 'thinking' || item.kind === 'info') {
        pending.seq += 1;
        this.emitRuntimeEvent('chat:runtime-event', {
          type: 'thinking.delta',
          runId: state.runId,
          sessionKey: state.sessionKey,
          text: item.text,
          seq: pending.seq,
          ts: now,
        });
        continue;
      }

      if (item.kind === 'tool_use') {
        if (previous !== undefined) continue;
        const toolCallId = `${state.runId}:progress:${index}`;
        state.toolCallIdByIndex.set(index, toolCallId);
        state.toolNameByIndex.set(index, item.tool || 'tool');
        this.handleBridgeToolMessage({
          type: 'tool_call',
          reply_ctx: state.runId,
          session_key: toCcConnectBridgeSessionKey(state.sessionKey),
          tool_call_id: toolCallId,
          tool_name: item.tool || 'tool',
          args: item.text,
        }, 'started');
        continue;
      }

      const matchingToolIndex = this.findProgressToolIndex(items, state, localIndex, windowBase, item.tool);
      const toolCallId = matchingToolIndex === null
        ? `${state.runId}:progress:${index}`
        : state.toolCallIdByIndex.get(matchingToolIndex) || `${state.runId}:progress:${matchingToolIndex}`;
      if (matchingToolIndex !== null) state.completedToolIndexes.add(matchingToolIndex);
      this.handleBridgeToolMessage({
        type: 'tool_result',
        reply_ctx: state.runId,
        session_key: toCcConnectBridgeSessionKey(state.sessionKey),
        tool_call_id: toolCallId,
        tool_name: item.tool || 'tool',
        result: item.text,
        status: item.status,
        exit_code: item.exit_code,
        is_error: item.kind === 'error' || item.success === false,
        meta: {
          status: item.status,
          exitCode: item.exit_code,
          success: item.success,
        },
      }, 'completed');
    }
    return true;
  }

  private findProgressToolIndex(
    items: BridgeProgressItem[],
    state: BridgeProgressState,
    resultLocalIndex: number,
    windowBase: number,
    toolName?: string,
  ): number | null {
    for (let localIndex = resultLocalIndex - 1; localIndex >= 0; localIndex -= 1) {
      if (items[localIndex]?.kind !== 'tool_use') continue;
      if (toolName && items[localIndex]?.tool && items[localIndex].tool !== toolName) continue;
      const index = windowBase + localIndex;
      if (state.toolCallIdByIndex.has(index)) return index;
    }
    const knownIndexes = Array.from(state.toolCallIdByIndex.keys()).sort((left, right) => right - left);
    for (const index of knownIndexes) {
      if (state.completedToolIndexes.has(index)) continue;
      const knownName = state.toolNameByIndex.get(index);
      if (!toolName || !knownName || knownName === toolName) return index;
    }
    return null;
  }

  private reconcileProgressWindow(state: BridgeProgressState, items: BridgeProgressItem[]): number {
    const next = items.map((item) => JSON.stringify(item));
    const previous = state.windowFingerprints;
    let overlap = Math.min(previous.length, next.length);
    while (overlap > 0) {
      const previousStart = previous.length - overlap;
      let matches = true;
      for (let index = 0; index < overlap; index += 1) {
        if (previous[previousStart + index] !== next[index]) {
          matches = false;
          break;
        }
      }
      if (matches) break;
      overlap -= 1;
    }
    const nextBase = previous.length === 0
      ? 0
      : state.windowBase + previous.length - overlap;
    state.windowBase = nextBase;
    state.windowFingerprints = next;
    return nextBase;
  }

  private handleBridgeApproval(message: Record<string, unknown>): boolean {
    const actions = bridgeButtonActions(message);
    if (!actions.some(({ action }) => action.startsWith('perm:') || action.startsWith('askq:'))) return false;
    const resolved = this.resolvePendingRun(message);
    if (!resolved) return true;
    const supportedActions = actions.filter(({ action }) => action.startsWith('perm:') || action.startsWith('askq:'));
    const itemId = `${resolved.runId}:approval`;
    const title = 'Codex approval';
    const kind = supportedActions.some(({ action }) => action.startsWith('askq:')) ? 'question' : 'permission';
    const content = typeof message.content === 'string' ? message.content : '';
    const bridgeSessionKey = typeof message.session_key === 'string'
      ? message.session_key
      : toCcConnectBridgeSessionKey(resolved.pending.sessionKey);
    this.pendingApprovals.set(resolved.runId, {
      runId: resolved.runId,
      sessionKey: resolved.pending.sessionKey,
      bridgeSessionKey,
      replyCtx: firstString(message, ['reply_ctx']) || resolved.runId,
      project: firstString(message, ['project']) || this.projectForSessionKey(resolved.pending.sessionKey),
      itemId,
      title,
      kind,
      message: content,
      actions: supportedActions,
    });
    resolved.pending.seq += 1;
    const now = Date.now();
    this.emitRuntimeEvent('chat:runtime-event', {
      type: 'approval.updated',
      runId: resolved.runId,
      sessionKey: resolved.pending.sessionKey,
      itemId,
      title,
      kind,
      phase: 'requested',
      status: 'pending',
      message: content,
      actions: supportedActions,
      seq: resolved.pending.seq,
      ts: now,
    });
    return true;
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

  private async finishPendingRun(pending: PendingRun, options: {
    text: string;
    isError?: boolean;
    appendMessage?: boolean;
    messageId?: string;
    timestamp?: number;
    attachedFiles?: AttachedFileMeta[];
  }): Promise<void> {
    const now = options.timestamp ?? Date.now();
    const isError = options.isError === true;
    this.completeOpenProgressTools(pending.runId, isError);
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
    this.clearProgressForRun(pending.runId);
    this.clearApprovalsForRun(pending.runId);
  }

  private completeOpenProgressTools(runId: string, isError: boolean): void {
    for (const state of this.progressByHandle.values()) {
      if (state.runId !== runId) continue;
      for (const [index, toolCallId] of state.toolCallIdByIndex.entries()) {
        if (state.completedToolIndexes.has(index)) continue;
        state.completedToolIndexes.add(index);
        this.handleBridgeToolMessage({
          type: 'tool_result',
          reply_ctx: runId,
          session_key: toCcConnectBridgeSessionKey(state.sessionKey),
          tool_call_id: toolCallId,
          tool_name: state.toolNameByIndex.get(index) || 'tool',
          result: '',
          status: isError ? 'failed' : 'completed',
          is_error: isError,
          meta: {
            status: isError ? 'failed' : 'completed',
            success: !isError,
            inferredFromRunCompletion: true,
          },
        }, 'completed');
      }
    }
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

  private clearProgressForRun(runId: string): void {
    for (const [handle, state] of this.progressByHandle.entries()) {
      if (state.runId === runId) this.progressByHandle.delete(handle);
    }
  }

  private clearApprovalsForRun(runId: string): void {
    this.pendingApprovals.delete(runId);
  }

  private appendMessage(sessionKey: string, message: RawMessage): void {
    this.messagesBySession.set(sessionKey, [
      ...(this.messagesBySession.get(sessionKey) ?? []),
      message,
    ]);
  }
}
