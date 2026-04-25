import { invokeIpc } from '@/lib/api-client';
import { useAgentsStore } from '@/stores/agents';
import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  getLastAbortedRunId,
  getLastChatEventAt,
  setHistoryPollTimer,
  setLastChatEventAt,
  setLastAbortedRunId,
  takeBlockedRunEvents,
  upsertImageCacheEntry,
} from './helpers';
import type { ChatSession, RawMessage } from './types';
import type { ChatGet, ChatSet, RuntimeActions } from './store-api';

function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function buildFallbackMainSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

function resolveMainSessionKeyForAgent(agentId: string | undefined | null): string | null {
  if (!agentId) return null;
  const normalizedAgentId = normalizeAgentId(agentId);
  const summary = useAgentsStore.getState().agents.find((agent) => agent.id === normalizedAgentId);
  return summary?.mainSessionKey || buildFallbackMainSessionKey(normalizedAgentId);
}

function ensureSessionEntry(sessions: ChatSession[], sessionKey: string): ChatSession[] {
  if (sessions.some((session) => session.key === sessionKey)) {
    return sessions;
  }
  return [...sessions, { key: sessionKey, displayName: sessionKey }];
}

let sendGeneration = 0;

export function createRuntimeSendActions(set: ChatSet, get: ChatGet): Pick<RuntimeActions, 'sendMessage' | 'abortRun'> {
  return {
    sendMessage: async (
      text: string,
      attachments?: Array<{ fileName: string; mimeType: string; fileSize: number; stagedPath: string; preview: string | null }>,
      targetAgentId?: string | null,
    ) => {
      const trimmed = text.trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;
      const currentSendGeneration = ++sendGeneration;

      const targetSessionKey = resolveMainSessionKeyForAgent(targetAgentId) ?? get().currentSessionKey;
      if (targetSessionKey !== get().currentSessionKey) {
        const current = get();
        const leavingEmpty = !current.currentSessionKey.endsWith(':main') && current.messages.length === 0;
        set((s) => ({
          currentSessionKey: targetSessionKey,
          currentAgentId: getAgentIdFromSessionKey(targetSessionKey),
          sessions: ensureSessionEntry(
            leavingEmpty ? s.sessions.filter((session) => session.key !== current.currentSessionKey) : s.sessions,
            targetSessionKey,
          ),
          sessionLabels: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLabels).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLabels,
          sessionLastActivity: leavingEmpty
            ? Object.fromEntries(Object.entries(s.sessionLastActivity).filter(([key]) => key !== current.currentSessionKey))
            : s.sessionLastActivity,
          messages: [],
          streamingText: '',
          streamingMessage: null,
          streamingTools: [],
          activeRunId: null,
          error: null,
          pendingFinal: false,
          lastUserMessageAt: null,
          pendingToolImages: [],
        }));
        await get().loadHistory(true);
      }

      const currentSessionKey = targetSessionKey;

      // Add user message optimistically (with local file metadata for UI display)
      const nowMs = Date.now();
      const userMsg: RawMessage = {
        role: 'user',
        content: trimmed || (attachments?.length ? '(file attached)' : ''),
        timestamp: nowMs / 1000,
        id: crypto.randomUUID(),
        _attachedFiles: attachments?.map(a => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          preview: a.preview,
          filePath: a.stagedPath,
          source: 'user-upload',
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
        lastUserMessageAt: nowMs,
      }));

      // Update session label with first user message text as soon as it's sent
      const { sessionLabels, messages } = get();
      const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
      if (!currentSessionKey.endsWith(':main') && isFirstMessage && !sessionLabels[currentSessionKey] && trimmed) {
        const truncated = trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
        set((s) => ({ sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated } }));
      }

      // Mark this session as most recently active
      set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: nowMs } }));

      // Start the history poll and safety timeout IMMEDIATELY (before the
      // RPC await) because the gateway's chat.send RPC may block until the
      // entire agentic conversation finishes — the poll must run in parallel.
      setLastChatEventAt(Date.now());
      clearHistoryPoll();
      clearErrorRecoveryTimer();

      const POLL_START_DELAY = 3_000;
      const POLL_INTERVAL = 4_000;
      const pollHistory = () => {
        const state = get();
        if (!state.sending) { clearHistoryPoll(); return; }
        if (state.streamingMessage) {
          setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
          return;
        }
        state.loadHistory(true);
        setHistoryPollTimer(setTimeout(pollHistory, POLL_INTERVAL));
      };
      setHistoryPollTimer(setTimeout(pollHistory, POLL_START_DELAY));

      const SAFETY_TIMEOUT_MS = 90_000;
      const checkStuck = () => {
        const state = get();
        if (!state.sending) return;
        if (state.streamingMessage || state.streamingText) return;
        if (state.pendingFinal) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        if (Date.now() - getLastChatEventAt() < SAFETY_TIMEOUT_MS) {
          setTimeout(checkStuck, 10_000);
          return;
        }
        clearHistoryPoll();
        set({
          error: 'No response received from the model. The provider may be unavailable or the API key may have insufficient quota. Please check your provider settings.',
          sending: false,
          activeRunId: null,
          lastUserMessageAt: null,
        });
      };
      setTimeout(checkStuck, 30_000);

      try {
        const idempotencyKey = crypto.randomUUID();
        const hasMedia = attachments && attachments.length > 0;
        if (hasMedia) {
          console.log('[sendMessage] Media paths:', attachments!.map(a => a.stagedPath));
        }

        // Cache image attachments BEFORE the IPC call to avoid race condition:
        // history may reload (via Gateway event) before the RPC returns.
        // Keyed by staged file path which appears in [media attached: <path> ...].
        if (hasMedia && attachments) {
          for (const a of attachments) {
            upsertImageCacheEntry(a.stagedPath, {
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSize: a.fileSize,
              preview: a.preview,
            });
          }
        }

        let result: { success: boolean; result?: { runId?: string }; error?: string };

        // Longer timeout for chat sends to tolerate high-latency networks (avoids connect error)
        const CHAT_SEND_TIMEOUT_MS = 120_000;

        if (hasMedia) {
          result = await invokeIpc(
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
          result = await invokeIpc(
            'gateway:rpc',
            'chat.send',
            {
              sessionKey: currentSessionKey,
              message: trimmed,
              deliver: false,
              idempotencyKey,
            },
            CHAT_SEND_TIMEOUT_MS,
          ) as { success: boolean; result?: { runId?: string }; error?: string };
        }

        console.log(`[sendMessage] RPC result: success=${result.success}, runId=${result.result?.runId || 'none'}`);

        const returnedRunId = result.result?.runId;
        if (returnedRunId && currentSendGeneration !== sendGeneration) {
          // This send was stopped or superseded while the RPC was in flight.
          // If the stop happened before activeRunId was known, narrow the
          // wildcard abort marker to the concrete runId we just learned.
          // Keep '*' while a newer send is still pending its runId so early
          // events from that newer run cannot re-arm the UI before ownership
          // is established.
          const lastAbortedRunId = getLastAbortedRunId();
          if (!get().sending && (!lastAbortedRunId || lastAbortedRunId === '*' || lastAbortedRunId === returnedRunId)) {
            setLastAbortedRunId(returnedRunId);
          }
          return;
        }

        if (currentSendGeneration !== sendGeneration) return;

        if (!result.success) {
          clearHistoryPoll();
          set({ error: result.error || 'Failed to send message', sending: false });
        } else if (returnedRunId && get().sending) {
          set({ activeRunId: returnedRunId });
          // Now that we have a valid activeRunId for the new run, the
          // activeRunId guard will filter stale events from the old run.
          // Safe to clear the abort marker.
          setLastAbortedRunId(null);
          const blockedEvents = takeBlockedRunEvents(returnedRunId);
          if (blockedEvents.length > 0) {
            queueMicrotask(() => {
              for (const blockedEvent of blockedEvents) {
                get().handleChatEvent(blockedEvent);
              }
            });
          }
        }
      } catch (err) {
        if (currentSendGeneration !== sendGeneration) return;
        clearHistoryPoll();
        set({ error: String(err), sending: false });
      }
    },

    // ── Abort active run ──

    abortRun: async () => {
      sendGeneration += 1;
      clearHistoryPoll();
      clearErrorRecoveryTimer();
      const { currentSessionKey, activeRunId } = get();
      // Mark the run as aborted BEFORE clearing state, so the event handler
      // rejects any lingering Gateway events from this run.  Use wildcard '*'
      // when activeRunId is not yet known (user stopped before chat.send
      // returned a runId) to block ALL run events from re-arming sending.
      setLastAbortedRunId(activeRunId || '*');
      set({ sending: false, activeRunId: null, streamingText: '', streamingMessage: null, pendingFinal: false, lastUserMessageAt: null, pendingToolImages: [] });
      set({ streamingTools: [] });

      try {
        await invokeIpc(
          'gateway:rpc',
          'chat.abort',
          { sessionKey: currentSessionKey },
        );
      } catch (err) {
        set({ error: String(err) });
      }
      // Reload history to pick up final transcript state from Gateway,
      // which resolves hasFinalReply and clears hasActiveExecutionGraph.
      void get().loadHistory(true);
    },

    // ── Handle incoming chat events from Gateway ──

  };
}
