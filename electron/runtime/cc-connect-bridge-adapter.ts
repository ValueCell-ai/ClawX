import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { RawMessage } from '@shared/chat/types';
import type { RuntimeSendWithMediaPayload } from './types';

type BridgeAdapterOptions = {
  port: number;
  token: string;
  project: string;
  emit: EventEmitter['emit'];
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

function toBridgeSessionKey(sessionKey: string): string {
  if (sessionKey.startsWith('clawx:')) return sessionKey;
  const [, scope = 'main', user = 'main'] = sessionKey.split(':');
  return `clawx:${scope || 'main'}:${user || 'main'}`;
}

export class CcConnectBridgeAdapter {
  private readonly port: number;
  private readonly token: string;
  private readonly project: string;
  private readonly emitRuntimeEvent: EventEmitter['emit'];
  private socket: WebSocket | null = null;
  private readonly messagesBySession = new Map<string, RawMessage[]>();
  private readonly pendingRuns = new Map<string, PendingRun>();

  constructor(options: BridgeAdapterOptions) {
    this.port = options.port;
    this.token = options.token;
    this.project = options.project;
    this.emitRuntimeEvent = options.emit;
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
      session_key: toBridgeSessionKey(payload.sessionKey),
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
    const sessions: SessionMetadata[] = [];
    for (const [key, messages] of this.messagesBySession.entries()) {
      const firstUser = messages.find((message) => message.role === 'user');
      const lastTimestamp = messages.reduce((latest, message) => {
        const ts = normalizeTimestamp(message.timestamp);
        return ts ? Math.max(latest, ts) : latest;
      }, 0);
      sessions.push({
        key,
        displayName: messageText(firstUser?.content).slice(0, 80) || key,
        createdAt: normalizeTimestamp(messages[0]?.timestamp) ?? lastTimestamp,
        updatedAt: lastTimestamp,
      });
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    const messages = this.messagesBySession.get(sessionKey) ?? [];
    return messages.slice(-Math.max(1, Math.min(Math.floor(limit), 1000)));
  }

  async deleteSession(sessionKey: string): Promise<void> {
    this.messagesBySession.delete(sessionKey);
  }

  async summarizeSessions(sessionKeys: string[]): Promise<Array<{ sessionKey: string; firstUserText: string | null; lastTimestamp: number | null }>> {
    return sessionKeys.map((sessionKey) => {
      const messages = this.messagesBySession.get(sessionKey) ?? [];
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
    });
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
