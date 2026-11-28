import { imageGenerationTaskIdFromToolOutput } from './image-generation-compat';
import type { AcpTurnTiming } from './turn-timings';
import type {
  AcpTimelineSnapshot,
  AttachmentRenderPart,
  MessageSegmentItem,
  RenderPart,
  TimelineItem,
  ToolCallItem,
} from './timeline-types';

export type AcpUserDisplayGroup = {
  kind: 'user';
  id: string;
  items: MessageSegmentItem[];
  attachments: AttachmentRenderPart[];
};

export type AcpAssistantTurnDisplayGroup = {
  kind: 'assistant-turn';
  id: string;
  userMessageId?: string;
  items: TimelineItem[];
  attachments: AttachmentRenderPart[];
};

export type AcpTimelineDisplayGroup = AcpUserDisplayGroup | AcpAssistantTurnDisplayGroup;

function isPendingActivity(item: TimelineItem): boolean {
  if (item.kind === 'tool-call') return item.status === 'pending' || item.status === 'running';
  if (item.kind === 'permission') return item.status === 'pending';
  return item.kind === 'compaction' && item.status === 'in_progress';
}

function keepProcessItemVisible(item: TimelineItem): boolean {
  if (item.kind === 'compaction') return item.status === 'failed';
  if (item.kind === 'message-segment' && item.compat?.source === 'image-generation' && !item.compat.provisionalText) {
    return true;
  }
  const parts = item.kind === 'tool-call' ? item.outputParts : 'parts' in item ? item.parts : [];
  return parts.some((part) => part.kind === 'attachment' || part.kind === 'image' || part.kind === 'error');
}

export function conciseAssistantTurn(items: TimelineItem[], status?: AcpTurnTiming['status']) {
  const fullTurn = { items, processLength: 0 };
  if (status === 'running' || items.some(isPendingActivity)) return fullTurn;

  // Tool updates reuse the original timeline item. Find the boundary in display order.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const tool = items[index];
    if (tool.kind !== 'tool-call') continue;
    if (status !== 'complete' && !tool.historical) return fullTurn;

    const hasReply = items.slice(index + 1).some((item) => (
      item.kind === 'message-segment' && item.role === 'assistant' && !item.compat?.provisionalText
      && item.parts.some((part) => part.kind === 'markdown' && part.text.trim().length > 0)
    ));
    if (!hasReply) return fullTurn;
    return {
      items: items.filter((item, itemIndex) => itemIndex > index || keepProcessItemVisible(item)),
      processLength: index + 1,
    };
  }
  return fullTurn;
}

function isUserMessageSegment(item: TimelineItem): item is MessageSegmentItem & { role: 'user' } {
  return item.kind === 'message-segment' && item.role === 'user';
}

function appendUserItem(groups: AcpTimelineDisplayGroup[], item: MessageSegmentItem): void {
  const previous = groups[groups.length - 1];
  const group: AcpUserDisplayGroup = previous?.kind === 'user'
    ? previous
    : {
        kind: 'user',
        id: `user-group:${item.id}`,
        items: [],
        attachments: [],
      };
  if (previous !== group) groups.push(group);

  const { attachments, remaining } = extractAttachments(item.parts);
  group.items.push(remaining === item.parts ? item : { ...item, parts: remaining });
  group.attachments.push(...attachments);
}

function extractAttachments(parts: RenderPart[]): {
  attachments: AttachmentRenderPart[];
  remaining: RenderPart[];
} {
  const attachments: AttachmentRenderPart[] = [];
  for (const part of parts) {
    if (part.kind === 'attachment') attachments.push(part);
  }
  if (attachments.length === 0) return { attachments, remaining: parts };
  const remaining = parts.filter((part) => part.kind !== 'attachment');
  return { attachments, remaining };
}

function assistantGroupForItem(
  groups: AcpTimelineDisplayGroup[],
  item: TimelineItem,
): AcpAssistantTurnDisplayGroup {
  const previous = groups[groups.length - 1];
  if (previous?.kind === 'assistant-turn') {
    return previous;
  }

  const group: AcpAssistantTurnDisplayGroup = {
    kind: 'assistant-turn',
    id: `assistant-turn:${item.id}`,
    ...(previous?.kind === 'user' && previous.items.at(-1)?.messageId
      ? { userMessageId: previous.items.at(-1)!.messageId }
      : {}),
    items: [],
    attachments: [],
  };
  groups.push(group);
  return group;
}

function appendAssistantItem(groups: AcpTimelineDisplayGroup[], item: TimelineItem): void {
  const group = assistantGroupForItem(groups, item);
  if (item.kind === 'message-segment') {
    const { attachments, remaining } = extractAttachments(item.parts);
    group.attachments.push(...attachments);
    if (remaining.length > 0) group.items.push(remaining === item.parts ? item : { ...item, parts: remaining });
    return;
  }
  if (item.kind === 'thought') {
    const { attachments, remaining } = extractAttachments(item.parts);
    group.attachments.push(...attachments);
    group.items.push(remaining === item.parts ? item : { ...item, parts: remaining });
    return;
  }
  if (item.kind === 'tool-call') {
    const { attachments, remaining } = extractAttachments(item.outputParts);
    group.attachments.push(...attachments);
    group.items.push(remaining === item.outputParts ? item : { ...item, outputParts: remaining });
    return;
  }
  group.items.push(item);
}

function backgroundTaskForTool(tool: ToolCallItem | undefined): string | undefined {
  if (!tool || tool.status === 'failed') return undefined;
  const text = tool.outputParts.flatMap((part) => part.kind === 'markdown' ? [part.text] : []).join('\n');
  return imageGenerationTaskIdFromToolOutput(tool.output, text, tool);
}

export function groupAcpTimelineItems(snapshot: AcpTimelineSnapshot): AcpTimelineDisplayGroup[] {
  const groups: AcpTimelineDisplayGroup[] = [];
  const imageResults: MessageSegmentItem[] = [];
  let lastTool: ToolCallItem | undefined;
  const flushImageResults = () => {
    for (const result of imageResults) appendAssistantItem(groups, result);
    imageResults.length = 0;
  };

  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (!item) continue;

    if (isUserMessageSegment(item)) {
      flushImageResults();
      lastTool = undefined;
      appendUserItem(groups, item);
      continue;
    }

    // The store anchors a background result at its tool. Display the native
    // acknowledgment first, including when it arrives after the image.
    if (item.kind === 'message-segment' && item.compat?.source === 'image-generation') {
      if (item.compat.provisionalText) {
        // A message tool can deliver the acknowledgment as a separate card.
        // Replay can already have placed the correlated image at an earlier tool.
        const group = assistantGroupForItem(groups, item);
        const taskId = item.compat.taskId;
        if (taskId) {
          group.items = group.items.filter((prior) => {
            if (prior.kind !== 'message-segment' || prior.compat?.taskId !== taskId || prior.compat.provisionalText) return true;
            imageResults.push(prior);
            return false;
          });
        }
        appendAssistantItem(groups, item);
        continue;
      }
      imageResults.push(item);
      continue;
    }
    if (item.kind === 'tool-call') {
      if (imageResults.length) {
        // The dispatch wrapper and its child can be separate cards for one task.
        const taskId = backgroundTaskForTool(item);
        if (!taskId || taskId !== backgroundTaskForTool(lastTool)) flushImageResults();
      }
      lastTool = item;
    }
    appendAssistantItem(groups, item);
  }

  flushImageResults();
  return groups;
}
