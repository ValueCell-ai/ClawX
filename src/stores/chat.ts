/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via gateway:rpc IPC.
 */
import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  error: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  // Actions
  loadSessions: () => Promise<void>;
  switchSession: (key: string) => void;
  newSession: () => void;
  loadHistory: () => Promise<void>;
  sendMessage: (text: string, attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const DEFAULT_CANONICAL_PREFIX = 'agent:main';
const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;

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

  const content = message.content;
  if (!Array.isArray(content)) return false;

  let hasTool = false;
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
    if (block.type === 'image' || block.type === 'thinking') {
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
  const content = msg.content;
  if (!Array.isArray(content)) return [];

  const updates: ToolStatus[] = [];
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
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,

  showThinking: true,
  thinkingLevel: null,

  // ── Load sessions via sessions.list ──

  loadSessions: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'sessions.list',
        { limit: 50 }
      ) as { success: boolean; result?: Record<string, unknown>; error?: string };

      if (result.success && result.result) {
        const data = result.result;
        const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => ({
          key: String(s.key || ''),
          label: s.label ? String(s.label) : undefined,
          displayName: s.displayName ? String(s.displayName) : undefined,
          thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
          model: s.model ? String(s.model) : undefined,
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

        const { currentSessionKey } = get();
        let nextSessionKey = currentSessionKey || DEFAULT_SESSION_KEY;
        if (!nextSessionKey.startsWith('agent:')) {
          const canonicalMatch = canonicalBySuffix.get(nextSessionKey);
          if (canonicalMatch) {
            nextSessionKey = canonicalMatch;
          }
        }
        if (!dedupedSessions.find((s) => s.key === nextSessionKey) && dedupedSessions.length > 0) {
          // Current session not found at all — switch to the first available session
          nextSessionKey = dedupedSessions[0].key;
        }

        const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
          ? [
            ...dedupedSessions,
            { key: nextSessionKey, displayName: nextSessionKey },
          ]
          : dedupedSessions;

        set({ sessions: sessionsWithCurrent, currentSessionKey: nextSessionKey });

        if (currentSessionKey !== nextSessionKey) {
          get().loadHistory();
        }
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    }
  },

  // ── Switch session ──

  switchSession: (key: string) => {
    set({
      currentSessionKey: key,
      messages: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });
    // Load history for new session
    get().loadHistory();
  },

  // ── New session ──

  newSession: () => {
    // Generate a new unique session key and switch to it
    const prefix = getCanonicalPrefixFromSessions(get().sessions) ?? DEFAULT_CANONICAL_PREFIX;
    const newKey = `${prefix}:session-${Date.now()}`;
    const newSessionEntry: ChatSession = { key: newKey, displayName: newKey };
    set((s) => ({
      currentSessionKey: newKey,
      sessions: [...s.sessions, newSessionEntry],
      messages: [],
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    }));
  },

  // ── Load chat history ──

  loadHistory: async () => {
    const { currentSessionKey } = get();
    set({ loading: true, error: null });

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'chat.history',
        { sessionKey: currentSessionKey, limit: 200 }
      ) as { success: boolean; result?: Record<string, unknown>; error?: string };

      if (result.success && result.result) {
        const data = result.result;
        const rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
        const filteredMessages = rawMessages.filter((msg) => !isToolResultRole(msg.role));
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
        set({ messages: filteredMessages, thinkingLevel, loading: false });
        const { pendingFinal, lastUserMessageAt } = get();
        if (pendingFinal) {
          const recentAssistant = [...filteredMessages].reverse().find((msg) => {
            if (msg.role !== 'assistant') return false;
            if (!hasNonToolAssistantContent(msg)) return false;
            if (lastUserMessageAt && msg.timestamp && msg.timestamp < lastUserMessageAt) return false;
            return true;
          });
          if (recentAssistant) {
            set({ sending: false, activeRunId: null, pendingFinal: false });
          }
        }
      } else {
        set({ messages: [], loading: false });
      }
    } catch (err) {
      console.warn('Failed to load chat history:', err);
      set({ messages: [], loading: false });
    }
  },

  // ── Send message ──

  sendMessage: async (text: string, attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const { currentSessionKey } = get();

    // Add user message optimistically (with local file metadata for UI display)
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || (attachments?.length ? '(file attached)' : ''),
      timestamp: Date.now() / 1000,
      id: crypto.randomUUID(),
      _attachedFiles: attachments?.map(a => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        preview: a.preview,
      })),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: userMsg.timestamp ?? null,
    }));

    try {
      const idempotencyKey = crypto.randomUUID();
      const hasMedia = attachments && attachments.length > 0;

      let result: { success: boolean; result?: { runId?: string }; error?: string };

      if (hasMedia) {
        // Use dedicated chat:sendWithMedia handler — main process reads staged files
        // from disk and builds base64 attachments, avoiding large IPC transfers
        result = await window.electron.ipcRenderer.invoke(
          'chat:sendWithMedia',
          {
            sessionKey: currentSessionKey,
            message: trimmed || 'Process the attached file(s).',
            deliver: false,
            idempotencyKey,
            media: attachments.map((a) => ({
              filePath: a.stagedPath,
              mimeType: a.mimeType,
              fileName: a.fileName,
            })),
          },
        ) as { success: boolean; result?: { runId?: string }; error?: string };
      } else {
        // No media — use standard lightweight RPC
        result = await window.electron.ipcRenderer.invoke(
          'gateway:rpc',
          'chat.send',
          {
            sessionKey: currentSessionKey,
            message: trimmed,
            deliver: false,
            idempotencyKey,
          },
        ) as { success: boolean; result?: { runId?: string }; error?: string };
      }

      if (!result.success) {
        set({ error: result.error || 'Failed to send message', sending: false });
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      } else {
        // No runId from gateway; keep sending state and wait for events.
      }
    } catch (err) {
      set({ error: String(err), sending: false });
    }
  },

  // ── Abort active run ──

  abortRun: async () => {
    const { currentSessionKey } = get();
    set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null });
    set({ streamingTools: [] });

    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
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
    const { activeRunId } = get();

    // Only process events for the active run (or if no active run set)
    if (activeRunId && runId && runId !== activeRunId) return;

    switch (eventState) {
      case 'delta': {
        // Streaming update - store the cumulative message
        const updates = collectToolUpdates(event.message, eventState);
        set((s) => ({
          streamingMessage: (() => {
            if (event.message && typeof event.message === 'object') {
              const msgRole = (event.message as RawMessage).role;
              if (isToolResultRole(msgRole)) return s.streamingMessage;
            }
            return event.message ?? s.streamingMessage;
          })(),
          streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
        }));
        break;
      }
      case 'final': {
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          const updates = collectToolUpdates(finalMsg, eventState);
          if (isToolResultRole(finalMsg.role)) {
            set((s) => ({
              streamingText: '',
              pendingFinal: true,
              streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
            }));
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const msgId = finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
            const streamingTools = hasOutput ? [] : nextTools;
            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some(m => m.id === msgId);
            if (alreadyExists) {
              // Just clear streaming state, don't add duplicate
              return toolOnly ? {
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
              } : {
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                streamingTools,
              };
            }
            return toolOnly ? {
              messages: [...s.messages, {
                ...finalMsg,
                role: finalMsg.role || 'assistant',
                id: msgId,
              }],
              streamingText: '',
              streamingMessage: null,
              pendingFinal: true,
              streamingTools,
            } : {
              messages: [...s.messages, {
                ...finalMsg,
                role: finalMsg.role || 'assistant',
                id: msgId,
              }],
              streamingText: '',
              streamingMessage: null,
              sending: hasOutput ? false : s.sending,
              activeRunId: hasOutput ? null : s.activeRunId,
              pendingFinal: hasOutput ? false : true,
              streamingTools,
            };
          });
        } else {
          // No message in final event - reload history to get complete data
          set({ streamingText: '', streamingMessage: null, pendingFinal: true });
          get().loadHistory();
        }
        break;
      }
      case 'error': {
        const errorMsg = String(event.errorMessage || 'An error occurred');
        set({
          error: errorMsg,
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
        });
        break;
      }
      case 'aborted': {
        set({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          pendingFinal: false,
          lastUserMessageAt: null,
        });
        break;
      }
    }
  },

  // ── Toggle thinking visibility ──

  toggleThinking: () => set((s) => ({ showThinking: !s.showThinking })),

  // ── Refresh: reload history + sessions ──

  refresh: async () => {
    const { loadHistory, loadSessions } = get();
    await Promise.all([loadHistory(), loadSessions()]);
  },

  clearError: () => set({ error: null }),
}));
