import type {
  AcpTimelineSnapshot,
  AttachmentRenderPart,
  MessageSegmentItem,
  RenderPart,
  TimelineItem,
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

function isUserMessageSegment(item: TimelineItem): item is MessageSegmentItem {
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
  group.items.push({ ...item, parts: remaining });
  group.attachments.push(...attachments);
}

function extractAttachments(parts: RenderPart[]): {
  attachments: AttachmentRenderPart[];
  remaining: RenderPart[];
} {
  const attachments: AttachmentRenderPart[] = [];
  const remaining: RenderPart[] = [];
  for (const part of parts) {
    if (part.kind === 'attachment') attachments.push(part);
    else remaining.push(part);
  }
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
    if (remaining.length > 0) group.items.push({ ...item, parts: remaining });
    return;
  }
  if (item.kind === 'thought') {
    const { attachments, remaining } = extractAttachments(item.parts);
    group.attachments.push(...attachments);
    group.items.push({ ...item, parts: remaining });
    return;
  }
  if (item.kind === 'tool-call') {
    const { attachments, remaining } = extractAttachments(item.outputParts);
    group.attachments.push(...attachments);
    group.items.push({ ...item, outputParts: remaining });
    return;
  }
  group.items.push(item);
}

export function groupAcpTimelineItems(snapshot: AcpTimelineSnapshot): AcpTimelineDisplayGroup[] {
  const groups: AcpTimelineDisplayGroup[] = [];

  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (!item) continue;

    if (isUserMessageSegment(item)) {
      appendUserItem(groups, item);
      continue;
    }

    appendAssistantItem(groups, item);
  }

  return groups;
}
