import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { useGatewayStore } from '@/stores/gateway';
import {
  clearHistoryPoll,
  enrichWithCachedImages,
  enrichWithToolResultFiles,
  getLatestOptimisticUserMessage,
  getMessageErrorMessage,
  getMessageStopReason,
  getMessageText,
  isInternalMessage,
  isToolResultRole,
  loadMissingPreviews,
  matchesOptimisticUserMessage,
  toMs,
} from './helpers';
import { buildCronSessionHistoryPath, isCronSessionKey } from './cron-session-utils';
import {
  CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS,
  classifyHistoryStartupRetryError,
  getStartupHistoryTimeoutOverride,
  shouldRetryStartupHistoryLoad,
  sleep,
} from './history-startup-retry';
import type { RawMessage } from './types';
import type { ChatGet, ChatSet, SessionHistoryActions } from './store-api';

const foregroundHistoryLoadSeen = new Set<string>();

async function loadCronFallbackMessages(sessionKey: string, limit = 200): Promise<RawMessage[]> {
  if (!isCronSessionKey(sessionKey)) return [];
  try {
    const response = await hostApiFetch<{ messages?: RawMessage[] }>(
      buildCronSessionHistoryPath(sessionKey, limit),
    );
    return Array.isArray(response.messages) ? response.messages : [];
  } catch (error) {
    console.warn('Failed to load cron fallback history:', error);
    return [];
  }
}

export function createHistoryActions(
  set: ChatSet,
  get: ChatGet,
): Pick<SessionHistoryActions, 'loadHistory' | 'loadMoreHistory'> {
  return {
    loadMoreHistory: async () => {
      // The legacy split-store path is not active in the Electron app. Keep a
      // conservative implementation for type safety; the monolithic store in
      // src/stores/chat.ts provides paginated transcript loading.
      await get().loadHistory(true);
    },
    loadHistory: async (quiet = false) => {
      const { currentSessionKey } = get();
      const gatewayState = useGatewayStore.getState?.() as { status?: { pid?: number; connectedAt?: number; port?: number } } | undefined;
      const gatewayStatus = gatewayState?.status;
      const foregroundLoadKey = `${gatewayStatus?.pid ?? 'none'}:${gatewayStatus?.connectedAt ?? 'none'}:${gatewayStatus?.port ?? 'none'}|${currentSessionKey}`;
      const isInitialForegroundLoad = !quiet && !foregroundHistoryLoadSeen.has(foregroundLoadKey);
      const historyTimeoutOverride = getStartupHistoryTimeoutOverride(isInitialForegroundLoad);
      if (!quiet) set({ loading: true, error: null });

      const isCurrentSession = () => get().currentSessionKey === currentSessionKey;
      const getPreviewMergeKey = (message: RawMessage): string => (
        `${message.id ?? ''}|${message.role}|${message.timestamp ?? ''}|${getMessageText(message.content)}`
      );
      const mergeHydratedMessages = (
        currentMessages: RawMessage[],
        hydratedMessages: RawMessage[],
      ): RawMessage[] => {
        const hydratedFilesByKey = new Map(
          hydratedMessages
            .filter((message) => message._attachedFiles?.length)
            .map((message) => [
              getPreviewMergeKey(message),
              message._attachedFiles!.map((file) => ({ ...file })),
            ]),
        );

        return currentMessages.map((message) => {
          const attachedFiles = hydratedFilesByKey.get(getPreviewMergeKey(message));
          return attachedFiles
            ? { ...message, _attachedFiles: attachedFiles }
            : message;
        });
      };

      const applyLoadFailure = (errorMessage: string | null) => {
        if (!isCurrentSession()) return;
        set((state) => {
          const hasMessages = state.messages.length > 0;
          return {
            loading: false,
            error: !quiet && errorMessage ? errorMessage : state.error,
            ...(hasMessages ? {} : { messages: [] as RawMessage[] }),
          };
        });
      };

      const applyLoadedMessages = (rawMessages: RawMessage[], thinkingLevel: string | null) => {
        if (!isCurrentSession()) return false;
        // Before filtering: attach images/files from tool_result messages to the next assistant message
        const messagesWithToolImages = enrichWithToolResultFiles(rawMessages);
        const filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg));
        // Restore file attachments for user/assistant messages (from cache + text patterns)
        const enrichedMessages = enrichWithCachedImages(filteredMessages);

        // Preserve the optimistic user message during an active send.
        // The Gateway may not include the user's message in chat.history
        // until the run completes, causing it to flash out of the UI.
        let finalMessages = enrichedMessages;
        const userMsgAt = get().lastUserMessageAt;
        if (get().sending && userMsgAt) {
          const userMsMs = toMs(userMsgAt);
          const optimistic = getLatestOptimisticUserMessage(get().messages, userMsMs);
          const hasMatchingUser = optimistic
            ? enrichedMessages.some((message) => matchesOptimisticUserMessage(message, optimistic, userMsMs))
            : false;
          if (optimistic && !hasMatchingUser) {
            finalMessages = [...enrichedMessages, optimistic];
          }
        }

        const { pendingFinal, lastUserMessageAt, sending: isSendingNow } = get();
        const userMsTs = lastUserMessageAt ? toMs(lastUserMessageAt) : 0;
        const isAfterUserMsg = (msg: RawMessage): boolean => {
          if (!userMsTs || !msg.timestamp) return true;
          return toMs(msg.timestamp) >= userMsTs;
        };
        const isRealUserBoundary = (msg: RawMessage): boolean => {
          if (msg.role !== 'user') return false;
          if (!Array.isArray(msg.content)) return true;
          const blocks = msg.content as Array<{ type?: string }>;
          return blocks.length === 0 || !blocks.every((block) => block.type === 'tool_result' || block.type === 'toolResult');
        };
        const postBoundaryMessages = userMsTs
          ? filteredMessages.filter((msg) => isAfterUserMsg(msg))
          : (() => {
              for (let i = filteredMessages.length - 1; i >= 0; i -= 1) {
                if (isRealUserBoundary(filteredMessages[i])) {
                  return filteredMessages.slice(i + 1);
                }
              }
              return filteredMessages;
            })();
        const lastAssistantAfterBoundary = [...postBoundaryMessages].reverse().find((msg) => msg.role === 'assistant');
        const latestTerminalAssistantErrorMessage = lastAssistantAfterBoundary
          && getMessageStopReason(lastAssistantAfterBoundary) === 'error'
          ? getMessageErrorMessage(lastAssistantAfterBoundary)
          : null;

        set({
          messages: finalMessages,
          thinkingLevel,
          loading: false,
          runError: latestTerminalAssistantErrorMessage,
        });

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
          if (!isCurrentSession()) return;
          if (updated) {
            set((state) => ({
              messages: mergeHydratedMessages(state.messages, finalMessages),
            }));
          }
        });
        // If we're sending but haven't received streaming events, check
        // whether the loaded history reveals assistant activity (tool calls,
        // narration, etc.).  Setting pendingFinal surfaces the execution
        // graph / activity indicator in the UI.
        //
        // Note: we intentionally do NOT set sending=false here.  Run
        // completion is exclusively signalled by the Gateway's phase
        // 'completed' event (handled in gateway.ts) or by receiving a
        // 'final' streaming event (handled in runtime-event-handlers.ts).
        // Attempting to infer completion from message history is fragile
        // and leads to premature sending=false during server-side tool
        // execution.
        if (latestTerminalAssistantErrorMessage) {
          clearHistoryPoll();
          set({
            sending: false,
            activeRunId: null,
            pendingFinal: false,
            lastUserMessageAt: null,
          });
          return true;
        }

        if (isSendingNow && !pendingFinal) {
          const hasRecentAssistantActivity = [...filteredMessages].reverse().some((msg) => {
            if (msg.role !== 'assistant') return false;
            return isAfterUserMsg(msg);
          });
          if (hasRecentAssistantActivity) {
            set({ pendingFinal: true });
          }
        }
        return true;
      };

      try {
        let result: { success: boolean; result?: Record<string, unknown>; error?: string } | null = null;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length; attempt += 1) {
          if (!isCurrentSession()) {
            break;
          }

          try {
            result = await invokeIpc(
              'gateway:rpc',
              'chat.history',
              { sessionKey: currentSessionKey, limit: 200 },
              ...(historyTimeoutOverride != null ? [historyTimeoutOverride] as const : []),
            ) as { success: boolean; result?: Record<string, unknown>; error?: string };

            if (result.success) {
              lastError = null;
              break;
            }

            lastError = new Error(result.error || 'Failed to load chat history');
          } catch (error) {
            lastError = error;
          }

          if (!isCurrentSession()) {
            break;
          }

          const errorKind = classifyHistoryStartupRetryError(lastError);
          const shouldRetry = result?.success !== true
            && isInitialForegroundLoad
            && attempt < CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS.length
            && shouldRetryStartupHistoryLoad(useGatewayStore.getState().status, errorKind);

          if (!shouldRetry) {
            break;
          }

          console.warn('[chat.history] startup retry scheduled', {
            sessionKey: currentSessionKey,
            attempt: attempt + 1,
            gatewayState: useGatewayStore.getState().status.state,
            errorKind,
            error: String(lastError),
          });
          await sleep(CHAT_HISTORY_STARTUP_RETRY_DELAYS_MS[attempt]!);
        }

        if (result?.success && result.result) {
          const data = result.result;
          let rawMessages = Array.isArray(data.messages) ? data.messages as RawMessage[] : [];
          const thinkingLevel = data.thinkingLevel ? String(data.thinkingLevel) : null;
          if (rawMessages.length === 0 && isCronSessionKey(currentSessionKey)) {
            rawMessages = await loadCronFallbackMessages(currentSessionKey, 200);
          }
          const applied = applyLoadedMessages(rawMessages, thinkingLevel);
          if (applied && isInitialForegroundLoad) {
            foregroundHistoryLoadSeen.add(foregroundLoadKey);
          }
          return;
        }

        const errorKind = classifyHistoryStartupRetryError(lastError);
        if (isCurrentSession() && isInitialForegroundLoad && errorKind) {
          console.warn('[chat.history] startup retry exhausted', {
            sessionKey: currentSessionKey,
            gatewayState: useGatewayStore.getState().status.state,
            errorKind,
            error: String(lastError),
          });
        }

        const fallbackMessages = await loadCronFallbackMessages(currentSessionKey, 200);
        if (fallbackMessages.length > 0) {
          const applied = applyLoadedMessages(fallbackMessages, null);
          if (applied && isInitialForegroundLoad) {
            foregroundHistoryLoadSeen.add(foregroundLoadKey);
          }
        } else if (errorKind === 'gateway_startup') {
          // Suppress error UI for gateway startup -- the history will load
          // once the gateway finishes initializing (via sidebar refresh or
          // the next session switch).
          set({ loading: false });
        } else {
          applyLoadFailure(
            result?.error
            || (lastError instanceof Error ? lastError.message : String(lastError))
            || 'Failed to load chat history',
          );
        }
      } catch (err) {
        console.warn('Failed to load chat history:', err);
        const fallbackMessages = await loadCronFallbackMessages(currentSessionKey, 200);
        if (fallbackMessages.length > 0) {
          const applied = applyLoadedMessages(fallbackMessages, null);
          if (applied && isInitialForegroundLoad) {
            foregroundHistoryLoadSeen.add(foregroundLoadKey);
          }
        } else {
          applyLoadFailure(String(err));
        }
      }
    },
  };
}
