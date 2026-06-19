import { create } from 'zustand';
import { chatCoreReducer } from '@/chat-core/openclaw-port/reducer';
import { createInitialChatCoreState } from '@/chat-core/openclaw-port/state';
import { selectVisibleChatItems } from '@/chat-core/openclaw-port/selectors';
import type { ChatCoreAction } from '@/chat-core/openclaw-port/actions';
import type {
  ApprovalDecision,
  ChatQueueAttachment,
  ChatCoreState,
  RawOpenClawMessage,
  VisibleChatItem,
} from '@/chat-core/openclaw-port/types';
import { createClawXChatCoreClient } from '@/chat-core/clawx-adapter/client';
import { subscribeOpenClawChatHostEvents } from '@/chat-core/clawx-adapter/host-events';
import { createQueueItem, isRecoverableSendError, sendQueuedItem } from '@/chat-core/openclaw-port/send';

type OpenClawChatSurfaceStore = {
  core: ChatCoreState;
  visibleItems: VisibleChatItem[];
  initialized: boolean;
  thinkingLevel: string | null;
  dispatch: (action: ChatCoreAction) => void;
  setSessionKey: (sessionKey: string, selectedAgentId?: string) => void;
  setThinkingLevel: (thinkingLevel: string | null) => void;
  loadHistory: () => Promise<void>;
  enqueueOptimisticUserMessage: (text: string, attachments?: OptimisticAttachmentInput[]) => void;
  executeComposerText: (text: string) => Promise<void>;
  abortRun: () => Promise<void>;
  abortLocalRun: () => void;
  resolveApproval: (id: string, decision: ApprovalDecision) => Promise<void>;
  initHostSubscriptions: () => void;
  disposeHostSubscriptions: () => void;
};

type OptimisticAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
};

let cleanupHostSubscriptions: (() => void) | null = null;
const client = createClawXChatCoreClient();
let historyRequestVersion = 0;
let terminalHistoryReloadTimers: Array<ReturnType<typeof setTimeout>> = [];

function thinkingParams(thinkingLevel: string | null): Record<string, unknown> {
  const thinking = thinkingLevel?.trim();
  return thinking ? { thinking } : {};
}

function clearTerminalHistoryReloadTimers() {
  for (const timer of terminalHistoryReloadTimers) clearTimeout(timer);
  terminalHistoryReloadTimers = [];
}

function isTerminalAction(action: ChatCoreAction): boolean {
  if (action.type === 'chat.final' || action.type === 'chat.error') return true;
  return action.type === 'run.status' && action.status != null && (
    action.status.phase === 'done'
    || action.status.phase === 'interrupted'
    || action.status.phase === 'error'
  );
}

export const useOpenClawChatSurfaceStore = create<OpenClawChatSurfaceStore>((set, get) => ({
  core: createInitialChatCoreState({ sessionKey: 'agent:main:main' }),
  visibleItems: [],
  initialized: false,
  thinkingLevel: null,
  dispatch: (action) => {
    set((state) => {
      const core = chatCoreReducer(state.core, action);
      return { core, visibleItems: selectVisibleChatItems(core) };
    });
  },
  setSessionKey: (sessionKey, selectedAgentId) => {
    const { core } = get();
    if (core.sessionKey === sessionKey && core.selectedAgentId === selectedAgentId) return;
    get().dispatch({ type: 'session.changed', sessionKey, selectedAgentId });
  },
  setThinkingLevel: (thinkingLevel) => {
    set({ thinkingLevel: thinkingLevel?.trim() || null });
  },
  loadHistory: async () => {
    const { core, dispatch } = get();
    const requestVersion = ++historyRequestVersion;
    dispatch({ type: 'history.requested', sessionKey: core.sessionKey, requestVersion });
    const response = await client.request<{ messages?: unknown[] }>('chat.history', {
      sessionKey: core.sessionKey,
      limit: 200,
      maxChars: 500000,
    });
    dispatch({
      type: 'history.loaded',
      sessionKey: core.sessionKey,
      requestVersion,
      messages: Array.isArray(response.messages)
        ? response.messages as RawOpenClawMessage[]
        : [],
      hasMore: false,
    });
  },
  enqueueOptimisticUserMessage: (text, attachments) => {
    const trimmed = text.trim();
    const readyAttachments = (attachments ?? []).map((attachment): ChatQueueAttachment => ({
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      preview: attachment.preview,
      filePath: attachment.stagedPath,
      source: 'user-upload',
    }));
    if (!trimmed && readyAttachments.length === 0) return;
    const item = createQueueItem({
      sessionKey: get().core.sessionKey,
      message: trimmed || (readyAttachments.length > 0 ? 'Process the attached file(s).' : ''),
      historyMessageCountAtEnqueue: get().core.history.messages.length,
      attachments: readyAttachments,
    });
    get().dispatch({ type: 'send.enqueued', item });
  },
  executeComposerText: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const [nameWithSlash = '/', ...rest] = trimmed.split(/\s+/);
      const name = nameWithSlash.slice(1);
      const args = rest.join(' ');
      const { executeSlashCommand } = await import('@/chat-core/openclaw-port/slash-command-executor');
      const result = await executeSlashCommand(client, get().core.sessionKey, name, args);
      if (result.action === 'refresh') await get().loadHistory();
      return;
    }

    const item = createQueueItem({
      sessionKey: get().core.sessionKey,
      message: trimmed,
      historyMessageCountAtEnqueue: get().core.history.messages.length,
    });
    get().dispatch({ type: 'send.enqueued', item });
    try {
      const ack = await sendQueuedItem(client, item, thinkingParams(get().thinkingLevel));
      if (ack.runId) get().dispatch({ type: 'send.acked', id: item.id, runId: ack.runId });
    } catch (error) {
      get().dispatch({
        type: 'send.failed',
        id: item.id,
        error: error instanceof Error ? error.message : String(error),
        recoverable: isRecoverableSendError(error),
      });
    }
  },
  abortRun: async () => {
    const { core, dispatch } = get();
    const runId = core.send.activeRunId
      ?? core.live.runId
      ?? (core.runtime.runStatus?.phase === 'running' ? core.runtime.runStatus.runId ?? null : null);
    dispatch({ type: 'send.aborted', sessionKey: core.sessionKey, runId });
    try {
      await client.request('chat.abort', {
        sessionKey: core.sessionKey,
        ...(runId ? { runId } : {}),
      }, 120000);
    } catch (error) {
      dispatch({
        type: 'run.status',
        status: {
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
  abortLocalRun: () => {
    const { core, dispatch } = get();
    const runId = core.send.activeRunId
      ?? core.live.runId
      ?? (core.runtime.runStatus?.phase === 'running' ? core.runtime.runStatus.runId ?? null : null);
    dispatch({ type: 'send.aborted', sessionKey: core.sessionKey, runId });
  },
  resolveApproval: async (id, decision) => {
    const approval = get().core.runtime.approvals.find((item) => (
      item.id === id
      || item.approvalId === id
      || item.approvalSlug === id
      || item.itemId === id
      || item.toolCallId === id
    ));
    const approvalId = approval?.approvalId ?? approval?.id ?? id;
    const method = approval?.kind === 'plugin' || approvalId.startsWith('plugin:')
      ? 'plugin.approval.resolve'
      : 'exec.approval.resolve';
    try {
      await client.request(method, { id: approvalId, decision }, 120000);
      get().dispatch({
        type: 'approval.resolved',
        ids: [
          id,
          approvalId,
          approval?.approvalSlug,
          approval?.itemId,
          approval?.toolCallId,
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      });
    } catch (error) {
      get().dispatch({
        type: 'run.status',
        status: {
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
  initHostSubscriptions: () => {
    if (cleanupHostSubscriptions) return;
    cleanupHostSubscriptions = subscribeOpenClawChatHostEvents((action) => {
      get().dispatch(action);
      if (!isTerminalAction(action)) return;

      const sessionKey = get().core.sessionKey;
      clearTerminalHistoryReloadTimers();
      for (const delayMs of [0, 500, 1500]) {
        const timer = setTimeout(() => {
          if (get().core.sessionKey !== sessionKey) return;
          void get().loadHistory().catch(() => {
            // The host bridge can briefly be unavailable during shutdown or
            // test teardown; the next explicit refresh/session load will retry.
          });
        }, delayMs);
        terminalHistoryReloadTimers.push(timer);
      }
    });
    set({ initialized: true });
  },
  disposeHostSubscriptions: () => {
    cleanupHostSubscriptions?.();
    cleanupHostSubscriptions = null;
    clearTerminalHistoryReloadTimers();
    set({ initialized: false });
  },
}));
