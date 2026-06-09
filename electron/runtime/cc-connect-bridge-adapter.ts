import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { RawMessage } from '@shared/chat/types';
import { getCcConnectManagedDir } from './cc-connect-paths';
import type { RuntimeSendWithMediaPayload } from './types';

type BridgeAdapterOptions = {
  port: number;
  token: string;
  project: string;
  emit: EventEmitter['emit'];
  sessionStoreDir?: string;
};

type SessionMetadata = {
  key: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
};

type PendingRun = {
  runId: string;
  sessionKey: string;
  startedAt: number;
};

type PersistedSession = {
  id: string;
  name?: string;
  history: RawMessage[];
  createdAt: number;
  updatedAt: number;
};

type PersistedSessionStore = {
  path: string;
  sessions: Map<string, PersistedSession>;
  rawSessions: Map<string, Record<string, unknown>>;
  activeSession: Map<string, string>;
  userSessions: Map<string, string[]>;
  userMeta: Map<string, Record<string, unknown>>;
  raw: Record<string, unknown>;
};

const CONNECT_TIMEOUT_MS = 15_000;

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
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toCcConnectBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) return sessionKey;
  if (!sessionKey.startsWith('agent:')) return sessionKey;
  const [, scope = 'main', user = 'main'] = sessionKey.split(':');
  return `clawx:${scope || 'main'}:${user || 'main'}`;
}

function fromBridgeSessionKey(sessionKey: string): string {
  if (sessionKey === 'clawx:main:main') return 'agent:main:main';
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

export class CcConnectBridgeAdapter {
  private readonly port: number;
  private readonly token: string;
  private readonly project: string;
  private readonly emitRuntimeEvent: EventEmitter['emit'];
  private readonly sessionStoreDir: string;
  private socket: WebSocket | null = null;
  private readonly messagesBySession = new Map<string, RawMessage[]>();
  private readonly pendingRuns = new Map<string, PendingRun>();

  constructor(options: BridgeAdapterOptions) {
    this.port = options.port;
    this.token = options.token;
    this.project = options.project;
    this.emitRuntimeEvent = options.emit;
    this.sessionStoreDir = options.sessionStoreDir ?? join(getCcConnectManagedDir(), 'data', 'sessions');
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
    this.pendingRuns.set(runId, { runId, sessionKey: payload.sessionKey, startedAt: now });
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
      project: this.project,
      images: [],
      files: payload.media?.map((item) => ({
        mime_type: item.mimeType,
        file_name: item.fileName,
        path: item.filePath,
      })) ?? [],
    }));
    return { runId };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const sessionsByKey = new Map<string, SessionMetadata>();
    for (const persisted of await this.readPersistedSessionStores()) {
      for (const [storedKey, sessionId] of persisted.activeSession.entries()) {
        const session = persisted.sessions.get(sessionId);
        if (!session || session.history.length === 0) continue;
        const key = fromBridgeSessionKey(storedKey);
        const item = {
          key,
          displayName: displayNameForPersistedSession(key, session, persisted.userMeta.get(storedKey)),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
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
      sessionsByKey.set(key, {
        key,
        displayName: messageText(firstUser?.content).slice(0, 80) || key,
        createdAt: normalizeTimestamp(messages[0]?.timestamp) ?? lastTimestamp,
        updatedAt: lastTimestamp,
      });
    }
    return Array.from(sessionsByKey.values()).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    const messages = [
      ...await this.readPersistedMessages(sessionKey),
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
        ...await this.readPersistedMessages(sessionKey),
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
          history,
          createdAt,
          updatedAt,
        });
      }
      return {
        path,
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

  private async readPersistedMessages(sessionKey: string): Promise<RawMessage[]> {
    for (const store of await this.readPersistedSessionStores()) {
      for (const key of sessionLookupKeys(sessionKey)) {
        const sessionId = store.activeSession.get(key);
        const session = sessionId ? store.sessions.get(sessionId) : undefined;
        if (session) return session.history;
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
          capabilities: ['text', 'card', 'buttons', 'typing', 'preview', 'update_message', 'delete_message', 'reconstruct_reply'],
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
    if (message.type === 'reply') {
      this.finishRun(message, typeof message.content === 'string' ? message.content : '');
      return;
    }
    if (message.type === 'reply_stream' && message.done === true) {
      const text = typeof message.full_text === 'string'
        ? message.full_text
        : typeof message.delta === 'string'
          ? message.delta
          : '';
      this.finishRun(message, text);
      return;
    }
    if (message.type === 'card') {
      this.finishRun(message, JSON.stringify(message.card ?? {}));
      return;
    }
    if (message.type === 'buttons') {
      this.finishRun(message, typeof message.content === 'string' ? message.content : '');
      return;
    }
    if (message.type === 'error') {
      this.finishRun(message, typeof message.message === 'string' ? message.message : 'cc-connect bridge error', true);
    }
  }

  private finishRun(message: Record<string, unknown>, text: string, isError = false): void {
    const runId = typeof message.reply_ctx === 'string' ? message.reply_ctx : '';
    const pending = this.pendingRuns.get(runId);
    const sessionKey = pending?.sessionKey ?? 'agent:main:main';
    const assistantMessage: RawMessage = {
      id: `${runId || randomUUID()}:assistant`,
      role: isError ? 'system' : 'assistant',
      content: text,
      timestamp: Date.now(),
      ...(isError ? { isError: true, errorMessage: text } : {}),
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
      status: isError ? 'error' : 'completed',
      endedAt: Date.now(),
      ts: Date.now(),
      ...(isError ? { error: text } : {}),
    });
    if (runId) this.pendingRuns.delete(runId);
  }

  private appendMessage(sessionKey: string, message: RawMessage): void {
    this.messagesBySession.set(sessionKey, [
      ...(this.messagesBySession.get(sessionKey) ?? []),
      message,
    ]);
  }
}
