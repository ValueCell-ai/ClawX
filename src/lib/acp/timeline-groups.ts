import type { AcpTimelineSnapshot, MessageSegmentItem, TimelineItem } from './timeline-types';

export type AcpUserDisplayGroup = {
  kind: 'user';
  id: string;
  items: MessageSegmentItem[];
};

export type AcpAssistantTurnDisplayGroup = {
  kind: 'assistant-turn';
  id: string;
  items: TimelineItem[];
};

export type AcpTimelineDisplayGroup = AcpUserDisplayGroup | AcpAssistantTurnDisplayGroup;

function isUserMessageSegment(item: TimelineItem): item is MessageSegmentItem {
  return item.kind === 'message-segment' && item.role === 'user';
}

function appendUserItem(groups: AcpTimelineDisplayGroup[], item: MessageSegmentItem): void {
  const previous = groups[groups.length - 1];
  if (previous?.kind === 'user') {
    previous.items.push(item);
    return;
  }

  groups.push({
    kind: 'user',
    id: `user-group:${item.id}`,
    items: [item],
  });
}

function appendAssistantItem(groups: AcpTimelineDisplayGroup[], item: TimelineItem): void {
  const previous = groups[groups.length - 1];
  if (previous?.kind === 'assistant-turn') {
    previous.items.push(item);
    return;
  }

  groups.push({
    kind: 'assistant-turn',
    id: `assistant-turn:${item.id}`,
    items: [item],
  });
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
