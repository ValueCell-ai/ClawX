import type {
  ContentBlock,
  PlanEntry,
  SessionConfigOption,
  SessionNotification,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { contentBlockToRenderPart, contentBlocksToRenderParts, toolContentToRenderPart, toolContentToRenderParts } from './content-blocks';
import { dedupeTimelineAttachments } from './attachments';
import { openClawPromptTextBlocks } from './openclaw-prompt-compat';
import type { AcpTimelineSnapshot, AttachmentRenderPart, MessageSegmentItem, RenderPart, TimelineItem, ToolCallItem } from './timeline-types';

type UpdateRecord = Record<string, unknown> & {
  sessionUpdate?: unknown;
};

type ApplyUpdateOptions = {
  historical?: boolean;
};

type Role = MessageSegmentItem['role'];

export function createEmptyAcpTimeline(sessionId: string, loadGeneration: number): AcpTimelineSnapshot {
  return {
    sessionId,
    loadGeneration,
    itemOrder: [],
    itemsById: {},
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

function appendItem(state: AcpTimelineSnapshot, item: TimelineItem): AcpTimelineSnapshot {
  const hasItem = item.id in state.itemsById;
  return {
    ...state,
    itemOrder: hasItem ? state.itemOrder : [...state.itemOrder, item.id],
    itemsById: { ...state.itemsById, [item.id]: item },
  };
}

function closeAllMessageSegments(state: AcpTimelineSnapshot): AcpTimelineSnapshot {
  if (Object.keys(state.openMessageSegments).length === 0) return state;
  return { ...state, openMessageSegments: {} };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toolKindValue(value: unknown): ToolKind | undefined {
  return typeof value === 'string' ? value as ToolKind : undefined;
}

function objectValue(value: unknown): UpdateRecord | undefined {
  return value && typeof value === 'object' ? value as UpdateRecord : undefined;
}

function contentArray(value: unknown): ContentBlock[] {
  return Array.isArray(value) ? value as ContentBlock[] : [];
}

function toolContentArray(value: unknown): ToolCallContent[] {
  return Array.isArray(value) ? value as ToolCallContent[] : [];
}

function toolLocations(value: unknown): ToolCallLocation[] {
  return Array.isArray(value) ? value as ToolCallLocation[] : [];
}

function configOptions(value: unknown): SessionConfigOption[] {
  return Array.isArray(value) ? value as SessionConfigOption[] : [];
}

function propertyExists(record: UpdateRecord, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function fallbackMessageId(state: AcpTimelineSnapshot, role: Role): string {
  const lastId = state.itemOrder[state.itemOrder.length - 1];
  const lastItem = lastId ? state.itemsById[lastId] : undefined;
  if (
    lastItem?.kind === 'message-segment'
    && lastItem.role === role
    && state.openMessageSegments[lastItem.messageId] === lastItem.id
  ) {
    return lastItem.messageId;
  }
  return `${role}:message:${state.itemOrder.length}`;
}

function getMessageId(state: AcpTimelineSnapshot, update: UpdateRecord, role: Role): string {
  return stringValue(update.messageId) ?? fallbackMessageId(state, role);
}

function nextMessageSegment(
  state: AcpTimelineSnapshot,
  role: Role,
  messageId: string,
): { state: AcpTimelineSnapshot; item: MessageSegmentItem } {
  const openId = state.openMessageSegments[messageId];
  if (openId) {
    const existing = state.itemsById[openId];
    if (existing?.kind === 'message-segment' && existing.role === role) return { state, item: existing };
  }

  const segmentIndex = state.segmentCounts[messageId] ?? 0;
  const id = `${messageId}:${segmentIndex}`;
  const item: MessageSegmentItem = {
    kind: 'message-segment', id, role, messageId, segmentIndex, parts: [], blockCount: 0,
  };

  return {
    state: {
      ...state,
      itemOrder: [...state.itemOrder, id],
      itemsById: { ...state.itemsById, [id]: item },
      openMessageSegments: { ...state.openMessageSegments, [messageId]: id },
      segmentCounts: { ...state.segmentCounts, [messageId]: segmentIndex + 1 },
    },
    item,
  };
}

function appendRenderPart(parts: RenderPart[], nextPart: RenderPart): RenderPart[] {
  const previous = parts[parts.length - 1];
  if (previous?.kind === 'markdown' && nextPart.kind === 'markdown') {
    return [
      ...parts.slice(0, -1),
      { ...previous, text: previous.text + nextPart.text },
    ];
  }
  return [...parts, nextPart];
}

function preserveAvailableAttachment(
  previous: Extract<RenderPart, { kind: 'attachment' }>,
  next: Extract<RenderPart, { kind: 'attachment' }>,
): RenderPart {
  const sameReference = previous.reference.uri === next.reference.uri
    && previous.reference.stagingId === next.reference.stagingId;
  return sameReference && previous.access.status === 'available'
    ? {
        ...next,
        reference: {
          ...next.reference,
          ...(previous.reference.displayPath ? { displayPath: previous.reference.displayPath } : {}),
        },
        access: previous.access,
      }
    : next;
}

function appendMessageRenderPart(role: Role, parts: RenderPart[], nextPart: RenderPart): RenderPart[] {
  if (nextPart.kind === 'attachment') {
    const existingIndex = parts.findIndex((part) => (
      part.kind === 'attachment' && part.attachmentId === nextPart.attachmentId
    ));
    if (existingIndex >= 0) {
      return parts.map((part, index) => (
        index === existingIndex && part.kind === 'attachment'
          ? preserveAvailableAttachment(part, nextPart)
          : part
      ));
    }
  }
  if (role === 'user' && nextPart.kind === 'markdown') {
    const markdownIndex = parts.findIndex((part) => part.kind === 'markdown');
    if (markdownIndex >= 0 && markdownIndex !== parts.length - 1) {
      return parts.map((part, index) => (
        index === markdownIndex && part.kind === 'markdown'
          ? { ...part, text: part.text + nextPart.text }
          : part
      ));
    }
  }
  return appendRenderPart(parts, nextPart);
}

function renderPartKey(part: RenderPart): string | null {
  if (part.kind === 'attachment') {
    return `attachment:${part.reference.uri}:${part.reference.name}:${part.reference.mimeType ?? ''}:${part.reference.stagingId ?? ''}`;
  }
  if (part.kind === 'image') return `image:${part.source}:${part.mimeType ?? ''}`;
  if (part.kind === 'error') return `error:${part.message}`;
  return null;
}

function mergeOptimisticUserEchoParts(optimisticParts: RenderPart[], echoParts: RenderPart[]): RenderPart[] {
  const reconciledEchoParts = echoParts.map((echoPart) => {
    if (echoPart.kind !== 'attachment') return echoPart;
    const previous = optimisticParts.find((part) => (
      part.kind === 'attachment' && renderPartKey(part) === renderPartKey(echoPart)
    ));
    return previous?.kind === 'attachment'
      ? preserveAvailableAttachment(previous, echoPart)
      : echoPart;
  });
  const echoPartKeys = new Set(reconciledEchoParts.map(renderPartKey).filter((key): key is string => Boolean(key)));
  const missingOptimisticMedia = optimisticParts.filter((part) => {
    if (part.kind === 'markdown') return false;
    const key = renderPartKey(part);
    return !key || !echoPartKeys.has(key);
  });
  return [...reconciledEchoParts, ...missingOptimisticMedia];
}

function findMessageSegmentId(state: AcpTimelineSnapshot, role: Role, messageId: string): string | undefined {
  return state.itemOrder.find((itemId) => {
    const item = state.itemsById[itemId];
    return item?.kind === 'message-segment' && item.role === role && item.messageId === messageId;
  });
}

function appendMessageChunk(
  state: AcpTimelineSnapshot,
  role: Role,
  update: UpdateRecord,
): AcpTimelineSnapshot {
  const content = update.content as ContentBlock | undefined;
  if (!content) return state;
  const messageId = getMessageId(state, update, role);
  const result = nextMessageSegment(state, role, messageId);
  const blockIndex = result.item.blockCount ?? result.item.parts.length;
  const nextPart = contentBlockToRenderPart(content, {
    role,
    messageId,
    segmentIndex: result.item.segmentIndex,
    blockIndex,
  });
  const parts = result.item.optimistic && role === 'user'
    ? mergeOptimisticUserEchoParts(result.item.parts, [nextPart])
    : appendMessageRenderPart(role, result.item.parts, nextPart);
  const nextItem: MessageSegmentItem = {
    ...result.item,
    blockCount: blockIndex + 1,
    optimistic: false,
    parts,
    ...(role === 'user'
      ? {
          userPromptTextBlocks: result.item.userPromptTextBlocksOptimistic
            ? result.item.userPromptTextBlocks
            : [
                ...(result.item.userPromptTextBlocks ?? []),
                ...openClawPromptTextBlocks([content]),
              ],
          ...(result.item.userPromptTextBlocksOptimistic
            ? { userPromptTextBlocksOptimistic: true }
            : {}),
        }
      : {}),
  };

  return {
    ...result.state,
    itemsById: { ...result.state.itemsById, [nextItem.id]: nextItem },
  };
}

function replaceMessage(
  state: AcpTimelineSnapshot,
  role: Role,
  messageId: string,
  content: unknown,
): AcpTimelineSnapshot {
  if (role === 'user') {
    const existingId = findMessageSegmentId(state, role, messageId);
    const existing = existingId ? state.itemsById[existingId] : undefined;
    if (existing?.kind === 'message-segment') {
      const blocks = contentArray(content);
      const parts = contentBlocksToRenderParts(blocks, {
        role,
        messageId,
        segmentIndex: existing.segmentIndex,
      });
      const item: MessageSegmentItem = {
        ...existing,
        blockCount: blocks.length,
        optimistic: false,
        parts: existing.optimistic ? mergeOptimisticUserEchoParts(existing.parts, parts) : parts,
        userPromptTextBlocks: existing.userPromptTextBlocksOptimistic
          ? existing.userPromptTextBlocks
          : openClawPromptTextBlocks(blocks),
        userPromptTextBlocksOptimistic: undefined,
      };
      return {
        ...state,
        itemsById: { ...state.itemsById, [item.id]: item },
      };
    }
  }

  const result = nextMessageSegment(state, role, messageId);
  const blocks = contentArray(content);
  const item: MessageSegmentItem = {
    ...result.item,
    blockCount: blocks.length,
    optimistic: false,
    parts: contentBlocksToRenderParts(blocks, {
      role,
      messageId,
      segmentIndex: result.item.segmentIndex,
    }),
    ...(role === 'user' ? { userPromptTextBlocks: openClawPromptTextBlocks(blocks) } : {}),
  };

  return {
    ...result.state,
    itemsById: { ...result.state.itemsById, [item.id]: item },
  };
}

export function appendSyntheticAssistantMessage(
  snapshot: AcpTimelineSnapshot,
  input: {
    messageId: string;
    evidenceId: string;
    parts: RenderPart[];
    afterItemId?: string;
  },
): AcpTimelineSnapshot {
  const id = `${input.messageId}:0`;
  const item: MessageSegmentItem = {
    kind: 'message-segment',
    id,
    role: 'assistant',
    messageId: input.messageId,
    segmentIndex: 0,
    blockCount: 0,
    parts: input.parts,
    compat: { source: 'image-generation', evidenceId: input.evidenceId },
  };

  const closed = closeAllMessageSegments(snapshot);
  const nextOrder = (() => {
    if (closed.itemOrder.includes(id)) return closed.itemOrder;
    const anchorIndex = input.afterItemId ? closed.itemOrder.indexOf(input.afterItemId) : -1;
    if (anchorIndex < 0) return [...closed.itemOrder, id];
    return [
      ...closed.itemOrder.slice(0, anchorIndex + 1),
      id,
      ...closed.itemOrder.slice(anchorIndex + 1),
    ];
  })();

  return dedupeTimelineAttachments({
    ...closed,
    itemOrder: nextOrder,
    itemsById: { ...closed.itemsById, [id]: item },
    segmentCounts: { ...closed.segmentCounts, [input.messageId]: 1 },
  });
}

export function upsertSyntheticTurnAttachments(
  snapshot: AcpTimelineSnapshot,
  input: {
    turnId: string;
    evidenceId: string;
    attachments: AttachmentRenderPart[];
    source: 'openclaw-media';
  },
): AcpTimelineSnapshot {
  const messageId = `compat:openclaw-media:${input.evidenceId}`;
  const id = `${messageId}:0`;
  const existingId = snapshot.itemOrder.find((itemId) => {
    const item = snapshot.itemsById[itemId];
    return item?.kind === 'message-segment'
      && item.compat?.source === input.source
      && item.compat.evidenceId === input.evidenceId;
  });
  const anchorIndex = snapshot.itemOrder.findIndex((itemId) => {
    const item = snapshot.itemsById[itemId];
    return item?.kind === 'message-segment' && item.role === 'user' && item.messageId === input.turnId;
  });
  if (anchorIndex < 0) return snapshot;

  const item: MessageSegmentItem = {
    kind: 'message-segment',
    id,
    role: 'assistant',
    messageId,
    segmentIndex: 0,
    blockCount: 0,
    parts: input.attachments,
    compat: { source: input.source, evidenceId: input.evidenceId },
  };
  const itemsById = { ...snapshot.itemsById };
  if (existingId && existingId !== id) delete itemsById[existingId];
  itemsById[id] = item;

  let itemOrder = snapshot.itemOrder.filter((itemId) => itemId !== existingId && itemId !== id);
  const nextUserIndex = itemOrder.findIndex((itemId, index) => {
    if (index <= anchorIndex) return false;
    const nextItem = itemsById[itemId];
    return nextItem?.kind === 'message-segment' && nextItem.role === 'user';
  });
  const insertionIndex = nextUserIndex < 0 ? itemOrder.length : nextUserIndex;
  itemOrder = [...itemOrder.slice(0, insertionIndex), id, ...itemOrder.slice(insertionIndex)];

  return dedupeTimelineAttachments({
    ...snapshot,
    itemOrder,
    itemsById,
    segmentCounts: { ...snapshot.segmentCounts, [messageId]: 1 },
  });
}

function normalizeToolStatus(status: ToolCallStatus | null | undefined): ToolCallItem['status'] {
  if (status === 'in_progress') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function existingToolCall(state: AcpTimelineSnapshot, id: string): ToolCallItem | undefined {
  const existing = state.itemsById[id];
  return existing?.kind === 'tool-call' ? existing : undefined;
}

function upsertToolCall(
  state: AcpTimelineSnapshot,
  update: UpdateRecord,
  options: ApplyUpdateOptions = {},
): AcpTimelineSnapshot {
  const toolCallId = stringValue(update.toolCallId);
  if (!toolCallId) return state;

  const id = `tool:${toolCallId}`;
  const prev = existingToolCall(state, id);
  const hasContent = propertyExists(update, 'content');
  const hasLocations = propertyExists(update, 'locations');
  const hasKind = propertyExists(update, 'kind');
  const hasRawInput = propertyExists(update, 'rawInput');
  const hasRawOutput = propertyExists(update, 'rawOutput');
  const rawStatus = update.status as ToolCallStatus | null | undefined;
  const rawTitle = stringValue(update.title);
  const rawError = stringValue(update.error);

  return appendItem(closeAllMessageSegments(state), {
    kind: 'tool-call',
    id,
    toolCallId,
    title: rawTitle ?? prev?.title ?? toolCallId,
    toolKind: hasKind ? toolKindValue(update.kind) : prev?.toolKind,
    status: propertyExists(update, 'status') ? normalizeToolStatus(rawStatus) : prev?.status ?? 'pending',
    input: hasRawInput ? update.rawInput : prev?.input,
    output: hasRawOutput ? update.rawOutput : prev?.output,
    outputParts: hasContent
      ? toolContentToRenderParts(toolContentArray(update.content), {
          role: 'assistant', messageId: `tool:${toolCallId}`, segmentIndex: 0,
        })
      : prev?.outputParts ?? [],
    locations: hasLocations ? toolLocations(update.locations) : prev?.locations ?? [],
    error: rawError ?? prev?.error,
    historical: !!prev?.historical || !!options.historical,
  });
}

function appendToolContentChunk(
  state: AcpTimelineSnapshot,
  update: UpdateRecord,
  options: ApplyUpdateOptions = {},
): AcpTimelineSnapshot {
  const toolCallId = stringValue(update.toolCallId);
  if (!toolCallId) return state;

  const id = `tool:${toolCallId}`;
  const prev = existingToolCall(state, id);
  const rawContent = objectValue(update.content);
  const nextPart = rawContent
    ? toolContentToRenderPart(rawContent as ToolCallContent, {
        role: 'assistant',
        messageId: `tool:${toolCallId}`,
        segmentIndex: 0,
        blockIndex: prev?.outputParts.length ?? 0,
      })
    : { kind: 'error' as const, message: 'Unsupported ACP tool content chunk' };

  return appendItem(closeAllMessageSegments(state), {
    kind: 'tool-call',
    id,
    toolCallId,
    title: prev?.title ?? toolCallId,
    toolKind: prev?.toolKind,
    status: prev?.status ?? 'running',
    input: prev?.input,
    output: prev?.output,
    outputParts: [...(prev?.outputParts ?? []), nextPart],
    locations: prev?.locations ?? [],
    error: prev?.error,
    historical: !!prev?.historical || !!options.historical,
  });
}

function appendThoughtChunk(state: AcpTimelineSnapshot, update: UpdateRecord): AcpTimelineSnapshot {
  const content = update.content as ContentBlock | undefined;
  if (!content) return state;
  const messageId = getMessageId(state, update, 'assistant');
  const id = `thought:${messageId}`;
  const existing = state.itemsById[id];
  const parts = existing?.kind === 'thought' ? existing.parts : [];

  return appendItem(closeAllMessageSegments(state), {
    kind: 'thought',
    id,
    messageId,
    parts: [...parts, contentBlockToRenderPart(content, {
      role: 'assistant',
      messageId: `thought:${messageId}`,
      segmentIndex: 0,
      blockIndex: parts.length,
    })],
  });
}

function updateSessionInfoMetadata(state: AcpTimelineSnapshot, update: UpdateRecord): AcpTimelineSnapshot {
  return {
    ...state,
    metadata: {
      ...state.metadata,
      ...(propertyExists(update, 'title') ? { title: update.title as string | null | undefined } : {}),
      ...(propertyExists(update, 'updatedAt') ? { updatedAt: update.updatedAt as string | null | undefined } : {}),
    },
  };
}

function usageMetadata(update: UpdateRecord): unknown {
  const { sessionUpdate: _sessionUpdate, ...usage } = update;
  return usage;
}

export function applyAcpSessionUpdate(
  snapshot: AcpTimelineSnapshot,
  notification: SessionNotification,
  options: ApplyUpdateOptions = {},
): AcpTimelineSnapshot {
  if (notification.sessionId !== snapshot.sessionId) return snapshot;

  const update = notification.update as unknown as UpdateRecord;
  switch (update.sessionUpdate) {
    case 'user_message': {
      const messageId = stringValue(update.messageId);
      return messageId ? replaceMessage(snapshot, 'user', messageId, update.content) : snapshot;
    }
    case 'agent_message': {
      const messageId = stringValue(update.messageId);
      return messageId ? replaceMessage(snapshot, 'assistant', messageId, update.content) : snapshot;
    }
    case 'tool_call_content_chunk':
      return appendToolContentChunk(snapshot, update, options);
    case 'user_message_chunk':
      return appendMessageChunk(snapshot, 'user', update);
    case 'agent_message_chunk':
      return appendMessageChunk(snapshot, 'assistant', update);
    case 'agent_thought_chunk':
      return appendThoughtChunk(snapshot, update);
    case 'tool_call':
    case 'tool_call_update':
      return upsertToolCall(snapshot, update, options);
    case 'plan':
      return appendItem(closeAllMessageSegments(snapshot), {
        kind: 'plan',
        id: 'plan:current',
        entries: Array.isArray(update.entries) ? update.entries as PlanEntry[] : [],
      });
    case 'available_commands_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, availableCommands: Array.isArray(update.availableCommands) ? update.availableCommands : [] } };
    case 'config_option_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, configOptions: configOptions(update.configOptions) } };
    case 'current_mode_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, currentModeId: stringValue(update.currentModeId) } };
    case 'session_info_update':
      return updateSessionInfoMetadata(snapshot, update);
    case 'usage_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, usage: usageMetadata(update) } };
    default:
      return snapshot;
  }
}
