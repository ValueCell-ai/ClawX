/**
 * Chat State Store
 * Manages chat messages, sessions, streaming, and thinking state.
 * Communicates with OpenClaw Gateway via gateway:rpc IPC.
 */
import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: unknown;
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
  pendingFinal: boolean;
  lastUserMessageAt: number | null;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;

  // Thinking
  showThinking: boolean;
  thinkingLevel: string | null;

  // Actions
  loadSessions: (reloadHistory?: boolean) => Promise<void>;
  switchSession: (key: string) => void;
  newSession: () => void;
  loadHistory: () => Promise<void>;
  sendMessage: (text: string, attachments?: { type: string; mimeType: string; fileName: string; content: string }[]) => Promise<void>;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
}

function isToolResultRole(role: unknown): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
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
    if (block.type === 'tool_use' || block.type === 'tool_result') {
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

const DEFAULT_CANONICAL_PREFIX = 'agent:main';
const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;

function getCanonicalPrefixFromSessions(sessions: ChatSession[]): string | null {
  const canonical = sessions.find((s) => s.key.startsWith('agent:'))?.key;
  if (!canonical) return null;
  const parts = canonical.split(':');
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
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
  pendingFinal: false,
  lastUserMessageAt: null,

  sessions: [],
  currentSessionKey: '',

  showThinking: true,
  thinkingLevel: null,

  // ── Load sessions via sessions.list ──

  loadSessions: async (reloadHistory = true) => {
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'sessions.list',
        { limit: 50 }
      ) as { success: boolean; result?: Record<string, unknown>; error?: string };

      if (result.success && result.result) {
        const data = result.result;
        const rawSessions = Array.isArray(data.sessions) ? data.sessions : [];
        const sessions: ChatSession[] = rawSessions.map((s: Record<string, unknown>) => {
          const key = String(s.key || '');
          return {
            key,
            thinkingLevel: s.thinkingLevel ? String(s.thinkingLevel) : undefined,
            model: s.model ? String(s.model) : undefined,
          };
        }).filter((s: ChatSession) => s.key);

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
        let nextSessionKey = currentSessionKey;
        if (!nextSessionKey && dedupedSessions.length > 0) {
          // No current session set; default to the first available session.
          nextSessionKey = dedupedSessions[0].key;
        }

        const sessionsWithCurrent = !dedupedSessions.find((s) => s.key === nextSessionKey) && nextSessionKey
          ? [
              ...dedupedSessions,
              {
                key: nextSessionKey,
                displayName: nextSessionKey,
              },
            ]
          : dedupedSessions;

        set({
          sessions: sessionsWithCurrent,
          currentSessionKey: nextSessionKey,
        });

        if (reloadHistory && currentSessionKey !== nextSessionKey) {
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
    set({
      currentSessionKey: newKey,
      messages: [],
      streamingText: '',
      streamingMessage: null,
      activeRunId: null,
      error: null,
      pendingFinal: false,
      lastUserMessageAt: null,
    });
    // Reload sessions list to include the new one after first message
    get().loadSessions();
  },

  // ── Load chat history ──

  loadHistory: async () => {
    const { currentSessionKey, sessions } = get();
    const resolvedSessionKey = currentSessionKey || sessions[0]?.key || DEFAULT_SESSION_KEY;
    if (resolvedSessionKey !== currentSessionKey) {
      set({ currentSessionKey: resolvedSessionKey });
    }
    set({ loading: true, error: null });

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'chat.history',
        { sessionKey: resolvedSessionKey, limit: 200 }
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

  sendMessage: async (text: string, attachments?: { type: string; mimeType: string; fileName: string; content: string }[]) => {
    const trimmed = text.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) return;

    const { currentSessionKey, sessions } = get();
    const resolvedSessionKey = currentSessionKey || sessions[0]?.key || DEFAULT_SESSION_KEY;
    if (resolvedSessionKey !== currentSessionKey) {
      set({ currentSessionKey: resolvedSessionKey });
    }

    // Add user message optimistically
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed || '(image)',
      timestamp: Date.now() / 1000,
      id: crypto.randomUUID(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      streamingText: '',
      streamingMessage: null,
      pendingFinal: false,
      lastUserMessageAt: userMsg.timestamp ?? null,
    }));

    try {
      const idempotencyKey = crypto.randomUUID();
      const rpcParams: Record<string, unknown> = {
        sessionKey: resolvedSessionKey,
        message: trimmed || 'Describe this image.',
        deliver: false,
        idempotencyKey,
      };

      // Include image attachments if any
      if (attachments && attachments.length > 0) {
        rpcParams.attachments = attachments.map((a) => ({
          type: a.type,
          mimeType: a.mimeType,
          fileName: a.fileName,
          content: a.content,
        }));
      }

      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'chat.send',
        rpcParams,
      ) as { success: boolean; result?: { runId?: string }; error?: string };

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
    const { currentSessionKey, sessions } = get();
    const resolvedSessionKey = currentSessionKey || sessions[0]?.key || DEFAULT_SESSION_KEY;
    if (resolvedSessionKey !== currentSessionKey) {
      set({ currentSessionKey: resolvedSessionKey });
    }
    set({ sending: false, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null });

    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'chat.abort',
        { sessionKey: resolvedSessionKey },
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
        set({
          streamingMessage: event.message ?? get().streamingMessage,
        });
        break;
      }
      case 'final': {
        // Message complete - add to history and clear streaming
        const finalMsg = event.message as RawMessage | undefined;
        if (finalMsg) {
          if (isToolResultRole(finalMsg.role)) {
            set({
              streamingText: '',
              streamingMessage: null,
              pendingFinal: true,
            });
            break;
          }
          const toolOnly = isToolOnlyMessage(finalMsg);
          const hasOutput = hasNonToolAssistantContent(finalMsg);
          const msgId = finalMsg.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
          set((s) => {
            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some(m => m.id === msgId);
            if (alreadyExists) {
              // Just clear streaming state, don't add duplicate
              return toolOnly ? {
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
              } : {
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
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
    await loadSessions();
    await loadHistory();
  },

  clearError: () => set({ error: null }),
}));
