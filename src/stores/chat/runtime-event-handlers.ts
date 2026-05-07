import {
  clearErrorRecoveryTimer,
  clearHistoryPoll,
  collectToolUpdates,
  extractImagesAsAttachedFiles,
  extractMediaRefs,
  getMessageErrorMessage,
  extractRawFilePaths,
  getMessageText,
  getToolCallFilePath,
  hasNonToolAssistantContent,
  isInternalMessage,
  isTerminalAssistantErrorMessage,
  isToolOnlyMessage,
  isToolResultRole,
  makeAttachedFile,
  normalizeStreamingMessage,
  snapshotStreamingAssistantMessage,
  upsertToolStatuses,
} from './helpers';
import type { AttachedFileMeta, RawMessage } from './types';
import type { ChatGet, ChatSet } from './store-api';

export function handleRuntimeEventState(
  set: ChatSet,
  get: ChatGet,
  event: Record<string, unknown>,
  resolvedState: string,
  runId: string,
): void {
      switch (resolvedState) {
        case 'started': {
          // Run just started (e.g. from console); show loading immediately.
          const { sending: currentSending } = get();
          if (!currentSending && runId) {
            set({ sending: true, activeRunId: runId, error: null });
          }
          break;
        }
        case 'delta': {
          // If we're receiving new deltas, the Gateway has recovered from any
          // prior error — cancel the error finalization timer and clear the
          // stale error banner so the user sees the live stream again.
          clearErrorRecoveryTimer();
          if (get().error || get().runError) set({ error: null, runError: null });
          const updates = collectToolUpdates(event.message, resolvedState);
          set((s) => ({
            streamingMessage: (() => {
              if (event.message && typeof event.message === 'object') {
                const msgRole = (event.message as RawMessage).role;
                if (isToolResultRole(msgRole)) return s.streamingMessage;
                // During multi-model fallback the Gateway may emit a delta with an
                // empty or role-only message (e.g. `{}` or `{ role: 'assistant' }`)
                // to signal a model switch.  Accepting such a value would silently
                // discard all content accumulated so far in streamingMessage.
                // Only replace when the incoming message carries actual payload.
                const msgObj = event.message as RawMessage;
                // During multi-model fallback the Gateway may emit an empty or
                // role-only delta (e.g. `{}` or `{ role: 'assistant' }`) to signal
                // a model switch.  If we already have accumulated streaming content,
                // accepting such a message would silently discard it.  Only guard
                // when there IS existing content to protect; when streamingMessage
                // is still null, let any delta through so the UI can start showing
                // the typing indicator immediately.
                if (s.streamingMessage && msgObj.content === undefined) {
                  return s.streamingMessage;
                }
              }
              return normalizeStreamingMessage(event.message ?? s.streamingMessage);
            })(),
            streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
          }));
          break;
        }
        case 'final': {
          clearErrorRecoveryTimer();
          if (get().error || get().runError) set({ error: null, runError: null });
          // Message complete - add to history and clear streaming
          const finalMsg = event.message as RawMessage | undefined;
          if (finalMsg) {
            const normalizedFinalMessage = normalizeStreamingMessage(finalMsg) as RawMessage;
            if (isTerminalAssistantErrorMessage(normalizedFinalMessage)) {
              handleRuntimeEventState(
                set,
                get,
                {
                  ...event,
                  errorMessage: getMessageErrorMessage(normalizedFinalMessage) ?? event.errorMessage,
                  message: normalizedFinalMessage,
                },
                'error',
                runId,
              );
              break;
            }
            const updates = collectToolUpdates(normalizedFinalMessage, resolvedState);
            // Filter out internal-only final responses (NO_REPLY, HEARTBEAT_OK, etc.)
            // before adding to messages. Without this guard, the internal token appears
            // briefly in the UI until loadHistory replaces the message list — and if the
            // quiet-mode reload is debounced away, the token can stay visible permanently.
            if (isInternalMessage(normalizedFinalMessage)) {
              set({
                streamingText: '',
                streamingMessage: null,
                sending: false,
                activeRunId: null,
                pendingFinal: false,
                streamingTools: [],
                pendingToolImages: [],
              });
              clearHistoryPoll();
              void get().loadHistory(true);
              break;
            }
            if (isToolResultRole(normalizedFinalMessage.role)) {
              // Resolve file path from the streaming assistant message's matching tool call
              const currentStreamForPath = get().streamingMessage as RawMessage | null;
              const matchedPath = (currentStreamForPath && normalizedFinalMessage.toolCallId)
                ? getToolCallFilePath(currentStreamForPath, normalizedFinalMessage.toolCallId)
                : undefined;

              // Mirror `enrichWithToolResultFiles`: collect non-image
              // artifacts for the next assistant message. Image content
              // blocks (vision data) and image-typed raw paths in the
              // tool's stdout are intermediate process noise — see the
              // comment in `helpers.ts::enrichWithToolResultFiles`.
              const toolFiles: AttachedFileMeta[] = extractImagesAsAttachedFiles(normalizedFinalMessage.content)
                .filter((file) => !file.mimeType.startsWith('image/'))
                .map((file) => (file.source ? file : { ...file, source: 'tool-result' }));
              if (matchedPath) {
                for (const f of toolFiles) {
                  if (!f.filePath) {
                    f.filePath = matchedPath;
                    f.fileName = matchedPath.split(/[\\/]/).pop() || 'image';
                  }
                }
              }
              const text = getMessageText(normalizedFinalMessage.content);
              if (text) {
                const mediaRefs = extractMediaRefs(text);
                const mediaRefPaths = new Set(mediaRefs.map(r => r.filePath));
                for (const ref of mediaRefs) toolFiles.push(makeAttachedFile(ref, 'tool-result'));
                for (const ref of extractRawFilePaths(text)) {
                  if (mediaRefPaths.has(ref.filePath)) continue;
                  if (ref.mimeType.startsWith('image/')) continue;
                  toolFiles.push(makeAttachedFile(ref, 'tool-result'));
                }
              }
              set((s) => {
                // Snapshot the current streaming assistant message (thinking + tool_use) into
                // messages[] before clearing it. The Gateway does NOT send separate 'final'
                // events for intermediate tool-use turns — it only sends deltas and then the
                // tool result. Without snapshotting here, the intermediate thinking+tool steps
                // would be overwritten by the next turn's deltas and never appear in the UI.
                const currentStream = s.streamingMessage as RawMessage | null;
                const snapshotMsgs = snapshotStreamingAssistantMessage(currentStream, s.messages, runId);
                return {
                  messages: snapshotMsgs.length > 0 ? [...s.messages, ...snapshotMsgs] : s.messages,
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  pendingToolImages: toolFiles.length > 0
                    ? [...s.pendingToolImages, ...toolFiles]
                    : s.pendingToolImages,
                  streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
                };
              });
              break;
            }
            const toolOnly = isToolOnlyMessage(normalizedFinalMessage);
            const hasOutput = hasNonToolAssistantContent(normalizedFinalMessage);
            const msgId = normalizedFinalMessage.id || (toolOnly ? `run-${runId}-tool-${Date.now()}` : `run-${runId}`);
            set((s) => {
              const nextTools = updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools;
              const streamingTools = hasOutput ? [] : nextTools;

              // Attach any files collected from preceding tool results,
              // plus file paths mentioned directly in the final assistant
              // text (e.g. `/Users/.../1000行示例.xlsx`). The latter is
              // what turns a plain path in the bubble into a clickable card
              // immediately, before the quiet history reload finishes.
              const pendingImgs = s.pendingToolImages;
              const ownText = getMessageText(normalizedFinalMessage.content);
              const ownMediaRefs = ownText ? extractMediaRefs(ownText) : [];
              const ownMediaPaths = new Set(ownMediaRefs.map(r => r.filePath));
              const ownFiles = ownText
                ? [
                  ...ownMediaRefs.map(ref => makeAttachedFile(ref, 'message-ref')),
                  ...extractRawFilePaths(ownText)
                    .filter(ref => !ownMediaPaths.has(ref.filePath))
                    .map(ref => makeAttachedFile(ref, 'message-ref')),
                ]
                : [];
              const attachedFiles = [...pendingImgs];
              const attachedPaths = new Set(attachedFiles.map(file => file.filePath).filter(Boolean));
              for (const file of ownFiles) {
                if (file.filePath && attachedPaths.has(file.filePath)) continue;
                if (file.filePath) attachedPaths.add(file.filePath);
                attachedFiles.push(file);
              }
              const msgWithImages: RawMessage = pendingImgs.length > 0
                ? {
                  ...normalizedFinalMessage,
                  role: (normalizedFinalMessage.role || 'assistant') as RawMessage['role'],
                  id: msgId,
                  _attachedFiles: [...(normalizedFinalMessage._attachedFiles || []), ...attachedFiles],
                }
                : attachedFiles.length > 0
                  ? {
                    ...normalizedFinalMessage,
                    role: (normalizedFinalMessage.role || 'assistant') as RawMessage['role'],
                    id: msgId,
                    _attachedFiles: [...(normalizedFinalMessage._attachedFiles || []), ...attachedFiles],
                  }
                  : { ...normalizedFinalMessage, role: (normalizedFinalMessage.role || 'assistant') as RawMessage['role'], id: msgId };
              const clearPendingImages = { pendingToolImages: [] as AttachedFileMeta[] };

              // Check if message already exists (prevent duplicates)
              const alreadyExists = s.messages.some(m => m.id === msgId);
              if (alreadyExists) {
                return toolOnly ? {
                  streamingText: '',
                  streamingMessage: null,
                  pendingFinal: true,
                  streamingTools,
                  ...clearPendingImages,
                } : {
                  streamingText: '',
                  streamingMessage: null,
                  sending: hasOutput ? false : s.sending,
                  activeRunId: hasOutput ? null : s.activeRunId,
                  pendingFinal: hasOutput ? false : true,
                  streamingTools,
                  ...clearPendingImages,
                };
              }
              return toolOnly ? {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                pendingFinal: true,
                streamingTools,
                ...clearPendingImages,
              } : {
                messages: [...s.messages, msgWithImages],
                streamingText: '',
                streamingMessage: null,
                sending: hasOutput ? false : s.sending,
                activeRunId: hasOutput ? null : s.activeRunId,
                pendingFinal: hasOutput ? false : true,
                streamingTools,
                ...clearPendingImages,
              };
            });
            // After the final response, quietly reload history to surface all intermediate
            // tool-use turns (thinking + tool blocks) from the Gateway's authoritative record.
            if (hasOutput && !toolOnly) {
              clearHistoryPoll();
              void get().loadHistory(true);
            }
          } else {
            // No message in final event - reload history to get complete data
            set({ streamingText: '', streamingMessage: null, pendingFinal: true });
            get().loadHistory();
          }
          break;
        }
        case 'error': {
          const errorMsg = String(
            event.errorMessage
            || getMessageErrorMessage(event.message)
            || 'An error occurred',
          );
          const terminalAssistantError = isTerminalAssistantErrorMessage(event.message);
          const wasSending = get().sending;

          // Snapshot the current streaming message into messages[] so partial
          // content ("Let me get that written down...") is preserved in the UI
          // rather than being silently discarded.
          const currentStream = get().streamingMessage as RawMessage | null;
          const errorSnapshot = snapshotStreamingAssistantMessage(
            currentStream,
            get().messages,
            `error-${runId || Date.now()}`,
          );
          if (errorSnapshot.length > 0) {
            set((s) => ({
              messages: [...s.messages, ...errorSnapshot],
            }));
          }

          set({
            error: terminalAssistantError ? null : errorMsg,
            runError: terminalAssistantError ? errorMsg : null,
            sending: false,
            activeRunId: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          if (wasSending) {
            void get().loadHistory(true);
          }
          break;
        }
        case 'aborted': {
          clearHistoryPoll();
          clearErrorRecoveryTimer();
          set({
            sending: false,
            activeRunId: null,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
          break;
        }
        default: {
          // Unknown or empty state — if we're currently sending and receive an event
          // with a message, attempt to process it as streaming data. This handles
          // edge cases where the Gateway sends events without a state field.
          const { sending } = get();
          if (sending && event.message && typeof event.message === 'object') {
            console.warn(`[handleChatEvent] Unknown event state "${resolvedState}", treating message as streaming delta. Event keys:`, Object.keys(event));
            const updates = collectToolUpdates(event.message, 'delta');
            set((s) => ({
              streamingMessage: normalizeStreamingMessage(event.message ?? s.streamingMessage),
              streamingTools: updates.length > 0 ? upsertToolStatuses(s.streamingTools, updates) : s.streamingTools,
            }));
          }
          break;
        }
      }
}
