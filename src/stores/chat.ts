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
  sendMessage: (text: string) => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  toggleThinking: () => void;
  refresh: () => Promise<void>;
  clearError: () => void;
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

  sessions: [],
  currentSessionKey: 'main',

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

        set({ sessions });
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
    });
    // Load history for new session
    get().loadHistory();
  },

  // ── New session ──

  newSession: () => {
    // Generate a new unique session key and switch to it
    const newKey = `session-${Date.now()}`;
    set({
      currentSessionKey: newKey,
      messages: [],
      streamingText: '',
      streamingMessage: null,
      activeRunId: null,
      error: null,
    });
    // Reload sessions list to include the new one after first message
    get().loadSessions();
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
        const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
        set({ messages: rawMessages, thinkingLevel, loading: false });
      } else {
        set({ messages: [], loading: false });
      }
    } catch (err) {
      console.warn('Failed to load chat history:', err);
      set({ messages: [], loading: false });
    }
  },

  // ── Send message ──

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const { currentSessionKey } = get();

    // Add user message optimistically
    const userMsg: RawMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now() / 1000,
      id: crypto.randomUUID(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sending: true,
      error: null,
      streamingText: '',
      streamingMessage: null,
    }));

    try {
      const idempotencyKey = crypto.randomUUID();
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'chat.send',
        {
          sessionKey: currentSessionKey,
          message: trimmed,
          deliver: false,
          idempotencyKey,
        }
      ) as { success: boolean; result?: { runId?: string }; error?: string };

      if (!result.success) {
        set({ error: result.error || 'Failed to send message', sending: false });
      } else if (result.result?.runId) {
        set({ activeRunId: result.result.runId });
      }
    } catch (err) {
      set({ error: String(err), sending: false });
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
          const msgId = finalMsg.id || `run-${runId}`;
          set((s) => {
            // Check if message already exists (prevent duplicates)
            const alreadyExists = s.messages.some(m => m.id === msgId);
            if (alreadyExists) {
              // Just clear streaming state, don't add duplicate
              return {
                streamingText: '',
                streamingMessage: null,
                sending: false,
                activeRunId: null,
              };
            }
            return {
              messages: [...s.messages, {
                ...finalMsg,
                role: finalMsg.role || 'assistant',
                id: msgId,
              }],
              streamingText: '',
              streamingMessage: null,
              sending: false,
              activeRunId: null,
            };
          });
        } else {
          // No message in final event - reload history to get complete data
          set({ streamingText: '', streamingMessage: null, sending: false, activeRunId: null });
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
        });
        break;
      }
      case 'aborted': {
        set({
          sending: false,
          activeRunId: null,
          streamingText: '',
          streamingMessage: null,
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
