import type {
  ChatCoreState,
  ChatRunUiStatus,
  CommandOutputEntry,
  LiveAssistantSegment,
  LiveThinkingSegment,
  LiveToolEntry,
  PatchSummaryEntry,
  VisibleChatItem,
} from './types';
import {
  queueItemHasMatchingHistoryMessage,
  shouldHideHistoryMessage,
} from './history';
import {
  extractThinkingText,
  stripHeartbeatTokenForDisplay,
} from './message-extraction';
import {
  collapseDuplicateAttachmentUserEchoes,
  collapseDuplicateIdempotentUserEchoes,
  mergeAdjacentToolResultMessages,
} from './message-normalization';
import { toolCardFromLiveEntry } from './tool-cards';

function messageId(message: Record<string, unknown>, index: number): string {
  return typeof message.id === 'string' && message.id.trim()
    ? message.id
    : `history-${index}`;
}

function runIdForHistoryMessage(message: Record<string, unknown>, id: string): string {
  return typeof message.runId === 'string' && message.runId.trim()
    ? message.runId
    : id;
}

function shouldShowRunStatus(status: ChatRunUiStatus): boolean {
  if (status.phase === 'idle' || status.phase === 'done' || status.phase === 'interrupted') {
    return false;
  }
  if (status.phase === 'error' && status.message?.trim().toLowerCase() === 'aborted') {
    return false;
  }
  return true;
}

function assistantStreamItem(segment: LiveAssistantSegment): Extract<VisibleChatItem, { kind: 'stream' }> | null {
  const display = stripHeartbeatTokenForDisplay(segment.text);
  const mediaUrls = segment.mediaUrls?.filter((url) => url.trim().length > 0);
  if (display.shouldSkip && !mediaUrls?.length) return null;
  return {
    kind: 'stream',
    id: `stream-${segment.id}`,
    runId: segment.runId,
    text: display.text,
    phase: segment.phase,
    ...(mediaUrls?.length ? { mediaUrls } : {}),
  };
}

function thinkingItem(segment: LiveThinkingSegment): Extract<VisibleChatItem, { kind: 'thinking' }> {
  return {
    kind: 'thinking',
    id: segment.id,
    runId: segment.runId,
    text: segment.text,
  };
}

function hiddenLiveStatus(runId: string): ChatRunUiStatus {
  return { phase: 'running', runId };
}

function toolItem(entry: LiveToolEntry): Extract<VisibleChatItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id: `tool-${entry.id}`,
    runId: entry.runId,
    toolCallId: entry.toolCallId,
    tool: toolCardFromLiveEntry(entry),
    status: hiddenLiveStatus(entry.runId),
  };
}

function commandItem(entry: CommandOutputEntry): Extract<VisibleChatItem, { kind: 'command' }> {
  return {
    kind: 'command',
    id: `command-${entry.id}`,
    command: entry,
    status: hiddenLiveStatus(entry.runId),
  };
}

function patchItem(entry: PatchSummaryEntry): Extract<VisibleChatItem, { kind: 'patch' }> {
  return {
    kind: 'patch',
    id: `patch-${entry.id}`,
    patch: entry,
    status: hiddenLiveStatus(entry.runId),
  };
}

type OrderedLiveItem = {
  ts: number;
  order: number;
  index: number;
  item: VisibleChatItem;
};

function liveOrder(entry: { order?: number }, fallback: number): number {
  return typeof entry.order === 'number' && Number.isFinite(entry.order)
    ? entry.order
    : fallback;
}

export function selectVisibleChatItems(state: ChatCoreState): VisibleChatItem[] {
  const historyMessages = collapseDuplicateAttachmentUserEchoes(
    collapseDuplicateIdempotentUserEchoes(
      mergeAdjacentToolResultMessages(state.history.messages),
    ),
  );
  const items: VisibleChatItem[] = [];
  historyMessages.forEach((message, index) => {
    if (shouldHideHistoryMessage(message)) return;
    const id = messageId(message, index);
    if (message.role === 'assistant') {
      const thinkingText = extractThinkingText(message);
      if (thinkingText) {
        items.push({
          kind: 'thinking',
          id: `thinking-${id}`,
          runId: runIdForHistoryMessage(message, id),
          text: thinkingText,
        });
      }
    }
    items.push({
      kind: 'message',
      id,
      message,
    });
  });

  for (const item of state.send.queue) {
    if (item.sessionKey !== state.sessionKey) continue;
    if (queueItemHasMatchingHistoryMessage(item, state.history.messages)) continue;
    if (
      item.state === 'queued'
      || item.state === 'sending'
      || item.state === 'waiting-reconnect'
      || item.state === 'failed'
    ) {
      items.push({ kind: 'queue', id: `queue-${item.id}`, item });
    }
  }

  const liveItems: OrderedLiveItem[] = [];
  const pushLiveItem = (ts: number, order: number, item: VisibleChatItem | null) => {
    if (!item) return;
    liveItems.push({ ts, order, index: liveItems.length, item });
  };

  for (const segment of state.live.thinkingSegments) {
    pushLiveItem(segment.ts, liveOrder(segment, liveItems.length), thinkingItem(segment));
  }
  for (const segment of state.live.assistantSegments) {
    pushLiveItem(segment.ts, liveOrder(segment, liveItems.length), assistantStreamItem(segment));
  }
  if (state.live.currentThinking) {
    pushLiveItem(
      state.live.currentThinking.ts,
      liveOrder(state.live.currentThinking, liveItems.length),
      thinkingItem(state.live.currentThinking),
    );
  }
  if (state.live.currentAssistant) {
    pushLiveItem(
      state.live.currentAssistant.ts,
      liveOrder(state.live.currentAssistant, liveItems.length),
      assistantStreamItem(state.live.currentAssistant),
    );
  }

  for (const toolCallId of state.live.toolStreamOrder) {
    const entry = state.live.toolStreamById[toolCallId];
    if (entry) pushLiveItem(entry.startedAt, liveOrder(entry, liveItems.length), toolItem(entry));
  }

  for (const command of state.live.commandOutputs) {
    pushLiveItem(command.ts, liveOrder(command, liveItems.length), commandItem(command));
  }

  for (const patch of state.live.patchSummaries) {
    pushLiveItem(patch.ts, liveOrder(patch, liveItems.length), patchItem(patch));
  }

  liveItems.sort((left, right) => left.ts - right.ts || left.order - right.order || left.index - right.index);
  for (const liveItem of liveItems) items.push(liveItem.item);

  if (state.runtime.compactionStatus) {
    items.push({
      kind: 'runtime',
      id: `runtime-compaction-${state.runtime.compactionStatus.phase}`,
      status: { kind: 'compaction', ...state.runtime.compactionStatus },
    });
  }

  if (state.runtime.fallbackStatus && state.runtime.fallbackStatus.phase !== 'cleared') {
    items.push({
      kind: 'runtime',
      id: `runtime-fallback-${state.runtime.fallbackStatus.phase}`,
      status: { kind: 'fallback', ...state.runtime.fallbackStatus },
    });
  }

  for (const approval of state.runtime.approvals) {
    items.push({ kind: 'approval', id: `approval-${approval.id}`, approval });
  }

  if (state.runtime.runStatus && shouldShowRunStatus(state.runtime.runStatus)) {
    items.push({
      kind: 'status',
      id: `status-${state.runtime.runStatus.runId ?? state.runtime.runStatus.phase}`,
      status: state.runtime.runStatus,
    });
  }

  return items;
}
