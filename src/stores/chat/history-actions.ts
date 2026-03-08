import { invokeIpc } from '@/lib/api-client';
import {
  clearHistoryPoll,
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  getMessageText,
  hasNonToolAssistantContent,
  isToolResultRole,
  loadMissingPreviews,
  toMs,
} from './helpers';
import type { RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

export function createHistoryActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadHistory'> {
  return {
    loadHistory: async (quiet = false) => {
      const { currentSessionKey } = get();
      if (!quiet) set({ loading: true, error: null });

      try {
        const result = await invokeIpc(
          'gateway:rpc',
          'chat.history',
          { sessionKey: currentSessionKey, limit: 200 }
        ) as { success: boolean; result?: Record<string, unknown>; error?: string };

        if (result.success && result.result) {
          const data = result.result;
          const rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];

          // Before filtering: attach images/files from tool_result messages to the next assistant message
          const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
          const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role));
          // Restore file attachments for user/assistant messages (from cache + text patterns)
          const enrichedMessages = enrichWithCachedImages(filteredMessages);
          const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;

          // Preserve the optimistic user message during an active send.
          // The Gateway may not include the user's message in chat.history
          // until the run completes, causing it to flash out of the UI.
          let finalMessages = enrichedMessages;
          const userMsgAt = get().lastUserMessageAt;
          if (get().sending && userMsgAt) {
            const userMsMs = toMs(userMsgAt);
            const hasRecentUser = enrichedMessages.some(
              (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
            );
            if (!hasRecentUser) {
              const currentMsgs = get().messages;
              const optimistic = [...currentMsgs].reverse().find(
                (m) => m.role === 'user' && m.timestamp && Math.abs(toMs(m.timestamp) - userMsMs) < 5000,
              );
              if (optimistic) {
                finalMessages = [...enrichedMessages, optimistic];
              }
            }
          }

          set({ messages: finalMessages, thinkingLevel, loading: false });

          // Extract first user message text as a session label for display in the toolbar.
          // Skip main sessions (key ends with ":main") — they rely on the Gateway-provided
          // displayName (e.g. the configured agent name "ClawX") instead.
          const isMainSession = currentSessionKey.endsWith(':main');
          if (!isMainSession) {
            const firstUserMsg = finalMessages.find((m) => m.role === 'user');
            if (firstUserMsg) {
              const labelText = getMessageText(firstUserMsg.content).trim();
              if (labelText) {
                const truncated = labelText.length > 50 ? `${labelText.slice(0, 50)}…` : labelText;
                set((s) => ({
                  sessionLabels: { ...s.sessionLabels, [currentSessionKey]: truncated },
                }));
              }
            }
          }

          // Record last activity time from the last message in history
          const lastMsg = finalMessages[finalMessages.length - 1];
          if (lastMsg?.timestamp) {
            const lastAt = toMs(lastMsg.timestamp);
            set((s) => ({
              sessionLastActivity: { ...s.sessionLastActivity, [currentSessionKey]: lastAt },
            }));
          }

          // Async: load missing image previews from disk (updates in background)
          loadMissingPreviews(finalMessages).then((updated) => {
            if (updated) {
              // Create new object references so React.memo detects changes.
              // loadMissingPreviews mutates AttachedFileMeta in place, so we
              // must produce fresh message + file references for each affected msg.
              set({
                messages: finalMessages.map(msg =>
                  msg._attachedFiles
                    ? { ...msg, _attachedFiles: msg._attachedFiles.map(f => ({ ...f })) }
                    : msg
                ),
              });
            }
          });
          const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();

          // If we're sending but haven't received streaming events, check
          // whether the loaded history reveals intermediate tool-call activity.
          // This surfaces progress via the pendingFinal → ActivityIndicator path.
          const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
          const isAfterUserMsg = (msg: RawMessage): boolean => {
            if (!userMsTs || !msg.timestamp) return true;
            return toMs(msg.timestamp) >= userMsTs;
          };

          if (isSendingNow && !pendingFinal) {
            const hasRecentAssistantActivity = [...filteredMessages].reverse().some((msg) => {
              if (msg.role !== 'assistant') return false;
              return isAfterUserMsg(msg);
            });
            if (hasRecentAssistantActivity) {
              set({ pendingFinal: true });
            }
          }

          // If pendingFinal, check whether the AI produced a final text response.
          if (pendingFinal || get().pendingFinal) {
            const recentAssistant = [...filteredMessages].reverse().find((msg) => {
              if (msg.role !== 'assistant') return false;
              if (!hasNonToolAssistantContent(msg)) return false;
              return isAfterUserMsg(msg);
            });
            if (recentAssistant) {
              clearHistoryPoll();
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
  };
}
