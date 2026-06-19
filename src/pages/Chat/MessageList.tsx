import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { extractDisplayMessageText } from '@/chat-core/openclaw-port/history';
import { extractAssistantCommentaryText } from '@/chat-core/openclaw-port/message-extraction';
import { extractToolCardsCached } from '@/chat-core/openclaw-port/tool-cards';
import { GeneratedFilesPanel } from '@/components/file-preview/GeneratedFilesPanel';
import type { GeneratedFile } from '@/lib/generated-files';
import type {
  ApprovalDecision,
  CommandOutputEntry,
  RawOpenClawMessage,
  VisibleChatItem,
} from '@/chat-core/openclaw-port/types';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { ApprovalCard } from './ApprovalCard';
import { ChatMessage } from './ChatMessage';
import { CommandCard } from './CommandCard';
import { MessageGroup } from './MessageGroup';
import { PatchCard } from './PatchCard';
import { RunStatusBar } from './RunStatusBar';
import { RuntimeIndicator } from './RuntimeIndicator';
import { StreamingGroup } from './StreamingGroup';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';
import { chatMessageAnchorId, sanitizeAssistantReplyText } from './message-utils';

const BOTTOM_EPSILON_PX = 8;

type AssistantRunProcessItem = Extract<
  VisibleChatItem,
  { kind: 'thinking' | 'stream' | 'tool' | 'command' | 'patch' }
>;

type AssistantRunGroupItem = {
  kind: 'assistant-run';
  id: string;
  runId: string;
  processItems: AssistantRunProcessItem[];
  followupMessages?: MessageChatItem[];
};

type MessageChatItem = Extract<VisibleChatItem, { kind: 'message' }>;

type AssistantHistoryTurnItem = {
  kind: 'assistant-history-turn';
  id: string;
  messages: MessageChatItem[];
  thinkingText?: string;
};

type AssistantHistoryTurnPartModel = {
  item: MessageChatItem;
  suppressText: boolean;
};

type RenderableChatItem = VisibleChatItem | AssistantRunGroupItem | AssistantHistoryTurnItem;

function isAssistantRunProcessItem(item: VisibleChatItem): item is AssistantRunProcessItem {
  return (
    item.kind === 'thinking'
    || item.kind === 'stream'
    || item.kind === 'tool'
    || item.kind === 'command'
    || item.kind === 'patch'
  );
}

function runIdForAssistantRunProcessItem(item: AssistantRunProcessItem): string {
  if (item.kind === 'command') return item.command.runId;
  if (item.kind === 'patch') return item.patch.runId;
  return item.runId;
}

function groupAssistantRunItems(items: VisibleChatItem[]): RenderableChatItem[] {
  const grouped: RenderableChatItem[] = [];
  let pending: AssistantRunGroupItem | null = null;

  const flush = () => {
    if (!pending) return;
    grouped.push(pending);
    pending = null;
  };

  for (const item of items) {
    if (!isAssistantRunProcessItem(item)) {
      flush();
      grouped.push(item);
      continue;
    }

    const runId = runIdForAssistantRunProcessItem(item);
    if (!pending || pending.runId !== runId) {
      flush();
      pending = {
        kind: 'assistant-run',
        id: `assistant-run-${runId}-${item.id}`,
        runId,
        processItems: [item],
      };
      continue;
    }

    pending.processItems.push(item);
  }

  flush();
  return mergeAdjacentAssistantHistoryTurns(groupAssistantHistoryTurns(groupAssistantRunFollowupMessages(grouped)));
}

function joinProcessText(values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

function assistantMessageText(message: RawOpenClawMessage): string {
  const visibleText = sanitizeAssistantReplyText(extractDisplayMessageText(message));
  if (visibleText.trim()) return visibleText;
  return sanitizeAssistantReplyText(extractAssistantCommentaryText(message) ?? '');
}

function assistantRunCopyText(
  group: AssistantRunGroupItem,
): string {
  return joinProcessText([
    ...group.processItems.flatMap((item) => (item.kind === 'stream' ? [item.text] : [])),
    ...(group.followupMessages ?? []).map((item) => assistantMessageText(item.message)),
  ]);
}

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.replace(/[_-]/g, '').toLowerCase() : '';
}

function isAssistantMessageItem(item: RenderableChatItem): item is MessageChatItem {
  return item.kind === 'message' && normalizeRole(item.message.role) === 'assistant';
}

function messageHasToolCards(message: RawOpenClawMessage): boolean {
  return extractToolCardsCached(message, String(message.id ?? 'message')).length > 0;
}

function isToolResultLikeMessage(message: RawOpenClawMessage): boolean {
  const role = normalizeRole(message.role);
  return (
    role === 'tool'
    || role === 'toolresult'
    || role === 'function'
    || typeof message.toolName === 'string'
    || typeof message.tool_name === 'string'
    || typeof message.toolCallId === 'string'
    || typeof message.tool_call_id === 'string'
    || typeof message.toolUseId === 'string'
    || typeof message.tool_use_id === 'string'
  );
}

function isAssistantTurnMessageItem(
  item: RenderableChatItem,
): item is MessageChatItem {
  return item.kind === 'message'
    && (
      normalizeRole(item.message.role) === 'assistant'
      || messageHasToolCards(item.message)
      || isToolResultLikeMessage(item.message)
    );
}

function messageIsStreamFallback(message: RawOpenClawMessage): boolean {
  const fallback = (message as Record<string, unknown>).openclawStreamFallback;
  return Boolean(fallback && typeof fallback === 'object' && !Array.isArray(fallback));
}

function assistantRunHasProcessBlocks(item: AssistantRunGroupItem): boolean {
  return item.processItems.some((processItem) => (
    processItem.kind === 'tool' || processItem.kind === 'command' || processItem.kind === 'patch'
  ));
}

function compactIds(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function withoutPrefix(value: string | undefined, prefix: string): string | undefined {
  if (!value?.startsWith(prefix)) return value;
  return value.slice(prefix.length);
}

function toolAssociationIds(item: Extract<AssistantRunProcessItem, { kind: 'tool' }>): string[] {
  return compactIds([
    item.toolCallId,
    withoutPrefix(item.id, 'tool-'),
    withoutPrefix(item.tool.id, 'live:'),
    item.tool.transcriptMessageId,
  ]);
}

function commandAssociationIds(command: CommandOutputEntry): string[] {
  return compactIds([
    command.toolCallId,
    command.itemId,
    command.toolId,
    command.toolItemId,
    command.callId,
    command.parentId,
    command.parentItemId,
  ]);
}

function hasSharedId(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  return left.some((id) => rightSet.has(id));
}

const COMMAND_TOOL_NAMES = new Set(['exec', 'shell', 'bash', 'sh', 'terminal', 'command']);

function isLikelyCommandTool(toolName: string | undefined): boolean {
  const normalized = toolName?.trim().toLowerCase();
  return normalized ? COMMAND_TOOL_NAMES.has(normalized) : false;
}

function commandMatchesTool(
  command: Extract<AssistantRunProcessItem, { kind: 'command' }>,
  tool: Extract<AssistantRunProcessItem, { kind: 'tool' }>,
  toolItems: Array<Extract<AssistantRunProcessItem, { kind: 'tool' }>>,
  commandItems: Array<Extract<AssistantRunProcessItem, { kind: 'command' }>>,
): boolean {
  if (hasSharedId(commandAssociationIds(command.command), toolAssociationIds(tool))) return true;
  return toolItems.length === 1
    && commandItems.length === 1
    && isLikelyCommandTool(tool.tool.toolName);
}

function commandForTool(
  tool: Extract<AssistantRunProcessItem, { kind: 'tool' }>,
  toolItems: Array<Extract<AssistantRunProcessItem, { kind: 'tool' }>>,
  commandItems: Array<Extract<AssistantRunProcessItem, { kind: 'command' }>>,
): Extract<AssistantRunProcessItem, { kind: 'command' }> | undefined {
  return commandItems.find((command) => commandMatchesTool(command, tool, toolItems, commandItems));
}

function commandIsMergedIntoTool(
  command: Extract<AssistantRunProcessItem, { kind: 'command' }>,
  toolItems: Array<Extract<AssistantRunProcessItem, { kind: 'tool' }>>,
  commandItems: Array<Extract<AssistantRunProcessItem, { kind: 'command' }>>,
): boolean {
  return toolItems.some((tool) => commandMatchesTool(command, tool, toolItems, commandItems));
}

const TERMINAL_COMMAND_STATUSES = new Set(['end', 'done', 'finished', 'completed', 'complete', 'success', 'error', 'failed']);

function isTerminalCommand(command: CommandOutputEntry | undefined): boolean {
  if (!command) return false;
  if (command.exitCode != null || command.endedAt != null) return true;
  const status = command.status?.trim().toLowerCase();
  const phase = command.phase?.trim().toLowerCase();
  return Boolean(
    (status && TERMINAL_COMMAND_STATUSES.has(status))
    || (phase && TERMINAL_COMMAND_STATUSES.has(phase)),
  );
}

function assistantRunCanOwnFollowupMessages(item: AssistantRunGroupItem): boolean {
  return assistantRunHasProcessBlocks(item)
    || item.processItems.every((processItem) => processItem.kind === 'thinking');
}

function groupAssistantRunFollowupMessages(
  items: RenderableChatItem[],
): RenderableChatItem[] {
  const grouped: RenderableChatItem[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind !== 'assistant-run' || !assistantRunCanOwnFollowupMessages(item)) {
      grouped.push(item);
      continue;
    }

    const followupMessages: MessageChatItem[] = [];
    let nextIndex = index + 1;
    while (nextIndex < items.length && isAssistantMessageItem(items[nextIndex])) {
      followupMessages.push(items[nextIndex] as MessageChatItem);
      nextIndex += 1;
    }

    if (followupMessages.length === 0) {
      grouped.push(item);
      continue;
    }

    if (item.processItems.every((processItem) => processItem.kind === 'thinking')) {
      grouped.push({
        kind: 'assistant-history-turn',
        id: `assistant-history-turn-${item.id}-${followupMessages.map((message) => message.id).join('-')}`,
        messages: followupMessages,
        thinkingText: joinProcessText(item.processItems.map((processItem) => processItem.text)),
      });
      index = nextIndex - 1;
      continue;
    }

    grouped.push({
      ...item,
      id: `${item.id}-${followupMessages.map((message) => message.id).join('-')}`,
      followupMessages,
    });
    index = nextIndex - 1;
  }

  return grouped;
}

function groupAssistantHistoryTurns(
  items: RenderableChatItem[],
): RenderableChatItem[] {
  const grouped: RenderableChatItem[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!isAssistantTurnMessageItem(item)) {
      grouped.push(item);
      continue;
    }

    const messages: MessageChatItem[] = [item];
    let nextIndex = index + 1;
    while (nextIndex < items.length && isAssistantTurnMessageItem(items[nextIndex])) {
      messages.push(items[nextIndex] as MessageChatItem);
      nextIndex += 1;
    }

    if (messages.length > 1 && messages.some((message) => (
      messageHasToolCards(message.message)
      || messageIsStreamFallback(message.message)
      || isToolResultLikeMessage(message.message)
    ))) {
      grouped.push({
        kind: 'assistant-history-turn',
        id: `assistant-history-turn-${messages.map((message) => message.id).join('-')}`,
        messages,
      });
    } else {
      grouped.push(...messages);
    }
    index = nextIndex - 1;
  }

  return grouped;
}

function mergeAdjacentAssistantHistoryTurns(items: RenderableChatItem[]): RenderableChatItem[] {
  const merged: RenderableChatItem[] = [];

  for (const item of items) {
    const previous = merged.at(-1);
    if (previous?.kind === 'assistant-history-turn' && item.kind === 'assistant-history-turn') {
      merged[merged.length - 1] = {
        kind: 'assistant-history-turn',
        id: `${previous.id}-${item.id}`,
        messages: [...previous.messages, ...item.messages],
        thinkingText: joinProcessText([
          previous.thinkingText ?? '',
          item.thinkingText ?? '',
        ]),
      };
      continue;
    }
    merged.push(item);
  }

  return merged;
}

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.clientHeight - element.scrollTop;
}

function scrollElementToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
}

export function MessageList({
  items,
  generatedFilesByMessageId,
  onOpenFile,
  onOpenGeneratedFile,
  onResolveApproval,
}: {
  items: VisibleChatItem[];
  generatedFilesByMessageId?: Record<string, GeneratedFile[]>;
  onOpenFile?: (file: AttachedFileMeta) => void;
  onOpenGeneratedFile?: (file: GeneratedFile) => void;
  onResolveApproval?: (id: string, decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation('chat');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const userDetachedFromBottomRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const renderItems = groupAssistantRunItems(items);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    scrollElementToBottom(element);
    pinnedToBottomRef.current = true;
    userDetachedFromBottomRef.current = false;
    lastScrollTopRef.current = element.scrollTop;
    setShowJumpToLatest(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pinned = distanceFromBottom(element) <= BOTTOM_EPSILON_PX;
    const previousScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = element.scrollTop;

    if (!pinned) {
      userDetachedFromBottomRef.current = true;
      pinnedToBottomRef.current = false;
      setShowJumpToLatest(true);
      return;
    }

    if (userDetachedFromBottomRef.current && element.scrollTop <= previousScrollTop) {
      pinnedToBottomRef.current = false;
      setShowJumpToLatest(true);
      return;
    }

    userDetachedFromBottomRef.current = false;
    pinnedToBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  useLayoutEffect(() => {
    if (items.length > 0) return;
    pinnedToBottomRef.current = true;
    userDetachedFromBottomRef.current = false;
    lastScrollTopRef.current = 0;
    const frame = requestAnimationFrame(() => {
      setShowJumpToLatest(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [items.length]);

  useLayoutEffect(() => {
    if (!pinnedToBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    scrollElementToBottom(element);
    const frame = requestAnimationFrame(() => {
      const latestElement = scrollRef.current;
      if (latestElement) scrollElementToBottom(latestElement);
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);

  const shouldShowJumpToLatest = items.length > 0 && showJumpToLatest;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="chat-scroll-container"
        className="h-full min-h-0 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        onScroll={handleScroll}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {renderItems.map((item, index) => {
            if (item.kind === 'assistant-run') {
              return <AssistantRunGroup key={item.id} group={item} onOpenFile={onOpenFile} />;
            }
            if (item.kind === 'assistant-history-turn') {
              return <AssistantHistoryTurn key={item.id} group={item} index={index} onOpenFile={onOpenFile} />;
            }
            if (item.kind === 'message') {
              const messageId = String(item.message.id ?? item.id);
              const generatedFiles = generatedFilesByMessageId?.[messageId] ?? [];
              return (
                <div key={item.id} id={chatMessageAnchorId(messageId)} className="space-y-2">
                  <MessageGroup
                    message={item.message}
                    index={index}
                    onOpenFile={onOpenFile}
                  />
                  {generatedFiles.length > 0 && onOpenGeneratedFile ? (
                    <div className="mx-auto w-full max-w-4xl px-16">
                      <GeneratedFilesPanel
                        files={generatedFiles}
                        onOpen={onOpenGeneratedFile}
                      />
                    </div>
                  ) : null}
                </div>
              );
            }
            if (item.kind === 'runtime') {
              return <RuntimeIndicator key={item.id} status={item.status} />;
            }
            if (item.kind === 'approval') {
              return (
                <ApprovalCard
                  key={item.id}
                  approval={item.approval}
                  onResolve={onResolveApproval}
                />
              );
            }
            if (isAssistantRunProcessItem(item)) return null;
            if (item.kind === 'queue') {
              const message = {
                role: 'user',
                content: item.item.message,
                timestamp: item.item.createdAt ? item.item.createdAt / 1000 : undefined,
                _attachedFiles: item.item.attachments,
              } as RawMessage;
              return (
                <article
                  key={item.id}
                  className="flex justify-end"
                  data-testid="chat-optimistic-user-message"
                  data-message-role="user"
                >
                  <div className="w-full min-w-0 text-sm">
                    <ChatMessage
                      message={message}
                      textOverride={item.item.message}
                      suppressToolCards
                      onOpenFile={onOpenFile}
                    />
                  </div>
                </article>
              );
            }
            if (item.status.phase === 'running') return null;
            return <RunStatusBar key={item.id} status={item.status} />;
          })}
        </div>
      </div>
      {shouldShowJumpToLatest && (
        <button
          type="button"
          data-testid="chat-scroll-to-latest"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-black/10 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          aria-label={t('scrollToLatest')}
          title={t('scrollToLatest')}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          <span>{t('scrollToLatest')}</span>
        </button>
      )}
    </div>
  );
}

function AssistantRunGroup({
  group,
  onOpenFile,
}: {
  group: AssistantRunGroupItem;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const thinkingItems = group.processItems.filter(
    (item): item is Extract<AssistantRunProcessItem, { kind: 'thinking' }> => item.kind === 'thinking',
  );
  const streamItems = group.processItems.filter(
    (item): item is Extract<AssistantRunProcessItem, { kind: 'stream' }> => item.kind === 'stream',
  );
  const toolItems = group.processItems.filter(
    (item): item is Extract<AssistantRunProcessItem, { kind: 'tool' }> => item.kind === 'tool',
  );
  const commandItems = group.processItems.filter(
    (item): item is Extract<AssistantRunProcessItem, { kind: 'command' }> => item.kind === 'command',
  );
  const hasProcessBlocks = group.processItems.some((item) => (
    item.kind === 'tool' || item.kind === 'command' || item.kind === 'patch'
  ));
  const followupMessages = group.followupMessages ?? [];
  const hasFollowupMessages = followupMessages.length > 0;
  const shouldRenderOrderedContent = hasProcessBlocks || hasFollowupMessages;
  const streamText = shouldRenderOrderedContent ? '' : joinProcessText(streamItems.map((item) => item.text));
  const thinkingText = joinProcessText(thinkingItems.map((item) => item.text));
  const lastStream = streamItems.at(-1);
  const mediaUrls = streamItems.flatMap((item) => item.mediaUrls ?? []);
  const thinkingCompleted = hasFollowupMessages || group.processItems.some((item) => item.kind !== 'thinking');
  const copyText = assistantRunCopyText(group);
  const afterContent = (
    shouldRenderOrderedContent
      ? (
        <div className="space-y-2" data-testid="chat-assistant-run-process">
          {group.processItems.map((item) => {
            if (item.kind === 'thinking') {
              return (
                <ThinkingBlock
                  key={item.id}
                  text={item.text}
                  completed={thinkingCompleted}
                />
              );
            }
            if (item.kind === 'stream') {
              return (
                <EmbeddedStreamMessage
                  key={item.id}
                  item={item}
                  suppressAssistantActions
                  onOpenFile={onOpenFile}
                />
              );
            }
            if (item.kind === 'tool') {
              const command = commandForTool(item, toolItems, commandItems)?.command;
              const commandFinished = isTerminalCommand(command);
              return (
                <ToolCard
                  key={item.id}
                  card={item.tool}
                  command={command}
                  defaultOpen={Boolean(command && !commandFinished)}
                  autoExpandWhen={Boolean(command && !commandFinished)}
                  autoCollapseWhen={Boolean(command && commandFinished)}
                  onOpenFile={onOpenFile}
                />
              );
            }
            if (item.kind === 'command') {
              if (commandIsMergedIntoTool(item, toolItems, commandItems)) return null;
              return <CommandCard key={item.id} command={item.command} />;
            }
            return <PatchCard key={item.id} patch={item.patch} />;
          })}
          {assistantHistoryTurnParts(followupMessages).map((part) => (
            <AssistantHistoryTurnPart
              key={part.item.id}
              part={part}
              suppressAssistantActions
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )
      : null
  );

  return (
    <StreamingGroup
      text={streamText}
      phase={lastStream?.phase ?? 'legacy'}
      mediaUrls={mediaUrls}
      thinkingText={!shouldRenderOrderedContent ? thinkingText || undefined : undefined}
      thinkingCompleted={thinkingCompleted}
      assistantCopyText={copyText || undefined}
      afterContent={afterContent}
    />
  );
}

function EmbeddedStreamMessage({
  item,
  suppressAssistantActions = false,
  onOpenFile,
}: {
  item: Extract<AssistantRunProcessItem, { kind: 'stream' }>;
  suppressAssistantActions?: boolean;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const content = [{ type: 'text', text: item.text }];
  return (
    <ChatMessage
      message={{
        role: 'assistant',
        content,
      }}
      textOverride={item.text}
      suppressToolCards
      isStreaming
      hideAssistantAvatar
      suppressAssistantActions={suppressAssistantActions}
      onOpenFile={onOpenFile}
    />
  );
}

function AssistantHistoryTurn({
  group,
  index,
  onOpenFile,
}: {
  group: AssistantHistoryTurnItem;
  index: number;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const parts = assistantHistoryTurnParts(group.messages);
  const copyText = assistantHistoryTurnCopyTextFromParts(parts);
  const thinkingContent = group.thinkingText?.trim() ? (
    <ThinkingBlock text={group.thinkingText} completed />
  ) : undefined;
  const content = (
    <div className="space-y-2" data-testid="chat-assistant-history-turn-content">
      {parts.map((part) => (
        <AssistantHistoryTurnPart
          key={part.item.id}
          part={part}
          suppressAssistantActions
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );

  return (
    <article
      id={`chat-message-${index}`}
      className="flex justify-start"
      data-testid={`chat-message-${index}`}
      data-message-role="assistant"
    >
      <div className="w-full min-w-0 text-sm text-foreground">
        <ChatMessage
          message={{ role: 'assistant', content: '' }}
          textOverride=""
          suppressToolCards
          assistantCopyText={copyText || undefined}
          assistantBeforeContent={thinkingContent}
          assistantAfterContent={content}
        />
      </div>
    </article>
  );
}

function normalizeAssistantTextKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function assistantHistoryTurnParts(messages: MessageChatItem[]): AssistantHistoryTurnPartModel[] {
  const seenText = new Set<string>();
  return messages.map((item) => {
    const text = assistantMessageText(item.message);
    const key = normalizeAssistantTextKey(text);
    const suppressText = Boolean(key && seenText.has(key));
    if (key && !suppressText) seenText.add(key);
    return { item, suppressText };
  });
}

function assistantHistoryTurnCopyTextFromParts(parts: AssistantHistoryTurnPartModel[]): string {
  return joinProcessText(parts.flatMap((part) => (
    part.suppressText ? [] : [assistantMessageText(part.item.message)]
  )));
}

function AssistantHistoryTurnPart({
  part,
  suppressAssistantActions = false,
  onOpenFile,
}: {
  part: AssistantHistoryTurnPartModel;
  suppressAssistantActions?: boolean;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const item = part.item;
  const message = item.message;
  const toolCards = extractToolCardsCached(message, String(message.id ?? item.id));
  const text = assistantMessageText(message);

  if (isToolResultLikeMessage(message) && toolCards.length === 0) return null;

  if (toolCards.length > 0) {
    return (
      <div className="space-y-2">
        {text.trim() && !part.suppressText && !isToolResultLikeMessage(message) ? (
          <ChatMessage
            message={{
              ...(message as Record<string, unknown>),
              role: 'assistant',
              content: message.content ?? text,
            }}
            textOverride={text}
            suppressToolCards
            hideAssistantAvatar
            suppressAssistantActions={suppressAssistantActions}
            onOpenFile={onOpenFile}
          />
        ) : null}
        <div className="space-y-2" data-testid="chat-tool-card-group">
          {toolCards.map((card) => (
            <ToolCard key={card.id} card={card} onOpenFile={onOpenFile} />
          ))}
        </div>
      </div>
    );
  }

  if (!text.trim() || part.suppressText) return null;
  return (
    <ChatMessage
      message={{
        ...(message as Record<string, unknown>),
        role: 'assistant',
        content: message.content ?? text,
      }}
      textOverride={text}
      suppressToolCards
      hideAssistantAvatar
      suppressAssistantActions={suppressAssistantActions}
      onOpenFile={onOpenFile}
    />
  );
}
