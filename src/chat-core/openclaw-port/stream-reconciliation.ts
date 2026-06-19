/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */

export type StreamReconciliationState = {
  chatStream: string | null;
  chatStreamStartedAt: number | null;
};

type ToolStreamHost = StreamReconciliationState & {
  chatStreamSegments?: Array<{ text?: unknown; ts?: unknown; toolCallId?: unknown }>;
  chatToolMessages?: unknown[];
  toolStreamById?: Map<string, unknown>;
  toolStreamOrder?: unknown[];
};

export type AssistantMessageVisibility = (message: unknown) => boolean;
export type StreamVisibility = (stream: string) => boolean;

export type MaterializeVisibleStreamOptions = {
  includeCurrent?: boolean;
  requirePersistedTool?: boolean;
  replacementMessages?: unknown[];
  isHiddenAssistantMessage: AssistantMessageVisibility;
  isHiddenStreamText: StreamVisibility;
};

type VisibleAssistantStreamPart = {
  text: string;
  replacementText: string;
  source: 'segment' | 'current';
  timestamp: number;
  toolCallId?: string;
};

function roleOf(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const role = (message as Record<string, unknown>).role;
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function extractText(message: unknown): string | null {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) {
    const parts = record.content.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const text = (entry as Record<string, unknown>).text;
      return typeof text === 'string' ? [text] : [];
    });
    return parts.length > 0 ? parts.join('\n') : null;
  }
  return null;
}

function trimAccumulatedStreamPrefix(text: string, previousText: string | null): string {
  if (!previousText || !text.startsWith(previousText)) return text;
  return text.slice(previousText.length);
}

function extractToolMessageRefs(message: unknown): Array<{ id: string }> {
  if (!message || typeof message !== 'object') return [];
  const record = message as Record<string, unknown>;
  const refs: Array<{ id: string }> = [];
  const values = [
    record.toolCallId,
    record.tool_call_id,
    record.id,
  ];
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) refs.push({ id: value.trim() });
  }
  for (const item of Array.isArray(record.content) ? record.content : []) {
    if (!item || typeof item !== 'object') continue;
    const itemRecord = item as Record<string, unknown>;
    const id = itemRecord.toolCallId ?? itemRecord.tool_call_id ?? itemRecord.id;
    if (typeof id === 'string' && id.trim()) refs.push({ id: id.trim() });
  }
  return refs;
}

export function currentLiveToolCallIds(state: StreamReconciliationState): string[] {
  const toolHost = state as ToolStreamHost;
  return Array.isArray(toolHost.toolStreamOrder)
    ? toolHost.toolStreamOrder.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )
    : [];
}

export function lastUserMessageIndex(messages: unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (roleOf(messages[index]) === 'user') return index;
  }
  return -1;
}

export function maybeResetToolStream(
  state: StreamReconciliationState,
  opts?: { preserveStreamSegments?: boolean },
): void {
  const toolHost = state as ToolStreamHost;
  const preserved = opts?.preserveStreamSegments && Array.isArray(toolHost.chatStreamSegments)
    ? [...toolHost.chatStreamSegments]
    : null;
  toolHost.toolStreamById?.clear();
  if (Array.isArray(toolHost.toolStreamOrder)) toolHost.toolStreamOrder = [];
  if (Array.isArray(toolHost.chatToolMessages)) toolHost.chatToolMessages = [];
  if (Array.isArray(toolHost.chatStreamSegments)) toolHost.chatStreamSegments = preserved ?? [];
}

export function clearToolStreamSegments(state: StreamReconciliationState): void {
  const toolHost = state as ToolStreamHost;
  if (Array.isArray(toolHost.chatStreamSegments)) toolHost.chatStreamSegments = [];
}

export function persistedCurrentToolStreamIds(
  messages: unknown[],
  state: StreamReconciliationState,
): Set<string> {
  const liveToolIdSet = new Set(currentLiveToolCallIds(state));
  const matchedToolIds = new Set<string>();
  if (liveToolIdSet.size === 0) return matchedToolIds;
  for (const message of messages.slice(lastUserMessageIndex(messages) + 1)) {
    for (const ref of extractToolMessageRefs(message)) {
      if (liveToolIdSet.has(ref.id)) matchedToolIds.add(ref.id);
    }
  }
  return matchedToolIds;
}

function buildAssistantStreamMessage(
  stream: string,
  replacementText = stream,
  timestamp = Date.now(),
): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: stream }],
    timestamp,
    openclawStreamFallback: { replacementText },
  };
}

function streamFallbackReplacementText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const fallback = (message as Record<string, unknown>).openclawStreamFallback;
  if (!fallback || typeof fallback !== 'object') return null;
  const replacementText = (fallback as Record<string, unknown>).replacementText;
  if (typeof replacementText === 'string' && replacementText.trim()) return replacementText.trim();
  return extractText(message)?.trim() ?? null;
}

function terminalMessageReplacesStreamFallback(message: unknown, fallback: unknown): boolean {
  const fallbackText = streamFallbackReplacementText(fallback);
  if (!fallbackText) return false;
  const terminalText = extractText(message)?.trim();
  return Boolean(
    terminalText && (terminalText === fallbackText || terminalText.startsWith(fallbackText)),
  );
}

export function appendTerminalAssistantMessage(messages: unknown[], message: unknown): unknown[] {
  const retainedMessages = messages.filter((existing, index) => {
    if (index <= lastUserMessageIndex(messages)) return true;
    return !terminalMessageReplacesStreamFallback(message, existing);
  });
  return [...retainedMessages, message];
}

function visibleAssistantStreamText(
  stream: string | null,
  isHiddenStreamText: StreamVisibility,
): string | null {
  if (!stream?.trim() || isHiddenStreamText(stream)) return null;
  return stream;
}

function hasAssistantStreamReplacement(
  messages: unknown[],
  stream: string,
  isHiddenAssistantMessage: AssistantMessageVisibility,
): boolean {
  const expected = stream.trim();
  if (!expected) return false;
  return messages.slice(lastUserMessageIndex(messages) + 1).some((message) => {
    const role = roleOf(message);
    if (role && role !== 'assistant') return false;
    if (role === 'assistant' && isHiddenAssistantMessage(message)) return false;
    const text = extractText(message)?.trim();
    return Boolean(text && (text === expected || text.startsWith(expected)));
  });
}

function visibleAssistantStreamParts(
  state: StreamReconciliationState,
  opts: Pick<MaterializeVisibleStreamOptions, 'includeCurrent' | 'isHiddenStreamText'>,
): VisibleAssistantStreamPart[] {
  const streamHost = state as ToolStreamHost;
  const liveToolIds = currentLiveToolCallIds(state);
  const parts: VisibleAssistantStreamPart[] = [];
  let previousText: string | null = null;
  const segments = Array.isArray(streamHost.chatStreamSegments)
    ? streamHost.chatStreamSegments
    : [];

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (!segment || typeof segment.text !== 'string') continue;
    const visible = visibleAssistantStreamText(
      trimAccumulatedStreamPrefix(segment.text, previousText),
      opts.isHiddenStreamText,
    );
    if (visible) {
      const explicitToolCallId = typeof segment.toolCallId === 'string' && segment.toolCallId.trim()
        ? segment.toolCallId.trim()
        : undefined;
      parts.push({
        text: visible,
        replacementText: segment.text,
        source: 'segment',
        timestamp: typeof segment.ts === 'number' && Number.isFinite(segment.ts)
          ? segment.ts
          : Date.now(),
        toolCallId: explicitToolCallId ?? liveToolIds[segmentIndex],
      });
    }
    if (segment.text.trim()) previousText = segment.text;
  }

  if (opts.includeCurrent !== false && typeof state.chatStream === 'string') {
    const visible = visibleAssistantStreamText(
      trimAccumulatedStreamPrefix(state.chatStream, previousText),
      opts.isHiddenStreamText,
    );
    if (visible) {
      parts.push({
        text: visible,
        replacementText: state.chatStream,
        source: 'current',
        timestamp: state.chatStreamStartedAt ?? Date.now(),
      });
    }
  }
  return parts;
}

export function visibleCurrentAssistantStreamTail(
  state: StreamReconciliationState,
  isHiddenStreamText: StreamVisibility,
): string | null {
  if (typeof state.chatStream !== 'string') return null;
  const streamHost = state as ToolStreamHost;
  const segments = Array.isArray(streamHost.chatStreamSegments)
    ? streamHost.chatStreamSegments
    : [];
  let previousText: string | null = null;
  for (const segment of segments) {
    if (typeof segment.text === 'string' && segment.text.trim()) previousText = segment.text;
  }
  return visibleAssistantStreamText(
    trimAccumulatedStreamPrefix(state.chatStream, previousText),
    isHiddenStreamText,
  );
}

function hasAssistantStreamPartReplacement(
  messages: unknown[],
  part: VisibleAssistantStreamPart,
  isHiddenAssistantMessage: AssistantMessageVisibility,
): boolean {
  return (
    hasAssistantStreamReplacement(messages, part.replacementText, isHiddenAssistantMessage)
    || hasAssistantStreamReplacement(messages, part.text, isHiddenAssistantMessage)
  );
}

export function historyReplacedVisibleStream(
  messages: unknown[],
  state: StreamReconciliationState,
  opts: Pick<
    MaterializeVisibleStreamOptions,
    'includeCurrent' | 'isHiddenAssistantMessage' | 'isHiddenStreamText'
  >,
): boolean {
  const parts = visibleAssistantStreamParts(state, opts);
  return (
    parts.length > 0
    && parts.every((part) => (
      hasAssistantStreamPartReplacement(messages, part, opts.isHiddenAssistantMessage)
    ))
  );
}

export function hasVisibleStreamParts(
  state: StreamReconciliationState,
  opts: Pick<MaterializeVisibleStreamOptions, 'includeCurrent' | 'isHiddenStreamText'>,
): boolean {
  return visibleAssistantStreamParts(state, opts).length > 0;
}

function currentToolStreamMessageIndex(
  messages: unknown[],
  state: StreamReconciliationState,
  toolCallId?: string,
): number {
  const liveToolIds = toolCallId ? new Set([toolCallId]) : new Set(currentLiveToolCallIds(state));
  if (liveToolIds.size === 0) return -1;
  const startIndex = lastUserMessageIndex(messages) + 1;
  for (let index = startIndex; index < messages.length; index++) {
    if (extractToolMessageRefs(messages[index]).some((ref) => liveToolIds.has(ref.id))) {
      return index;
    }
  }
  return -1;
}

function messageTimestampMs(message: unknown): number | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  const timestamp = record.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;
  const ts = record.ts;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
}

function previousTimestamp(messages: unknown[], endIndex: number): number | null {
  for (let index = endIndex - 1; index >= 0; index--) {
    const timestamp = messageTimestampMs(messages[index]);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function nextTimestamp(messages: unknown[], startIndex: number): number | null {
  for (let index = startIndex; index < messages.length; index++) {
    const timestamp = messageTimestampMs(messages[index]);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function timestampForInsertedVisibleStream(
  messages: unknown[],
  index: number,
  desiredTimestamp: number,
): number {
  const prev = previousTimestamp(messages, index);
  const next = nextTimestamp(messages, index);
  if (prev != null && desiredTimestamp <= prev) {
    const afterPrevious = prev + 1;
    return next != null && afterPrevious >= next ? prev + (next - prev) / 2 : afterPrevious;
  }
  if (next != null && desiredTimestamp >= next) {
    const beforeNext = next - 1;
    return prev != null && beforeNext <= prev ? prev + (next - prev) / 2 : beforeNext;
  }
  return desiredTimestamp;
}

export function materializeVisibleStreamState(
  messages: unknown[],
  state: StreamReconciliationState,
  opts: MaterializeVisibleStreamOptions,
): unknown[] {
  let nextMessages = messages;
  for (const part of visibleAssistantStreamParts(state, opts)) {
    const replacementMessages = opts.replacementMessages ?? [];
    if (
      hasAssistantStreamPartReplacement(
        [...nextMessages, ...replacementMessages],
        part,
        opts.isHiddenAssistantMessage,
      )
    ) {
      continue;
    }
    const toolIndex = part.source === 'segment'
      ? currentToolStreamMessageIndex(nextMessages, state, part.toolCallId)
      : -1;
    if (opts.requirePersistedTool && toolIndex < 0) continue;
    const insertIndex = toolIndex >= 0 ? toolIndex : nextMessages.length;
    const streamMessage = buildAssistantStreamMessage(
      part.text,
      part.replacementText,
      timestampForInsertedVisibleStream(nextMessages, insertIndex, part.timestamp),
    );
    nextMessages = [
      ...nextMessages.slice(0, insertIndex),
      streamMessage,
      ...nextMessages.slice(insertIndex),
    ];
  }
  return nextMessages;
}

export function prunePersistedToolStreamMessages(
  state: StreamReconciliationState,
  persistedToolIds: Set<string>,
): void {
  if (persistedToolIds.size === 0) return;
  const toolHost = state as ToolStreamHost;
  toolHost.toolStreamById?.forEach((_value, id) => {
    if (persistedToolIds.has(id)) toolHost.toolStreamById?.delete(id);
  });
  if (Array.isArray(toolHost.toolStreamOrder)) {
    toolHost.toolStreamOrder = toolHost.toolStreamOrder.filter(
      (id): id is string => typeof id === 'string' && !persistedToolIds.has(id),
    );
  }
  if (Array.isArray(toolHost.chatToolMessages)) {
    toolHost.chatToolMessages = toolHost.chatToolMessages.filter((message) => (
      extractToolMessageRefs(message).every((ref) => !persistedToolIds.has(ref.id))
    ));
  }
  if (Array.isArray(toolHost.chatStreamSegments)) {
    toolHost.chatStreamSegments = toolHost.chatStreamSegments.filter((segment) => {
      const toolCallId = typeof segment.toolCallId === 'string' ? segment.toolCallId.trim() : '';
      return !toolCallId || !persistedToolIds.has(toolCallId);
    });
  }
}
