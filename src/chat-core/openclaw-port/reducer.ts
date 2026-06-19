import type { ChatCoreAction, ToolStreamActionPayload } from './actions';
import type {
  ChatCoreState,
  ChatRunUiStatus,
  ApprovalRequest,
  CommandOutputEntry,
  LiveAssistantSegment,
  LiveThinkingSegment,
  LiveToolEntry,
  PatchSummaryEntry,
  RawOpenClawMessage,
} from './types';
import {
  extractDisplayMessageText,
  queueItemHasMatchingHistoryMessage,
} from './history';
import {
  extractAssistantCommentaryText,
  stripHeartbeatTokenForDisplay,
} from './message-extraction';

function eventMatchesSession(state: ChatCoreState, sessionKey?: string): boolean {
  return !sessionKey || sessionKey === state.sessionKey;
}

function approvalMatchesAnyId(approval: { id: string; approvalId?: string; approvalSlug?: string; itemId?: string; toolCallId?: string }, ids: string[]): boolean {
  const candidates = [
    approval.id,
    approval.approvalId,
    approval.approvalSlug,
    approval.itemId,
    approval.toolCallId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return candidates.some((candidate) => ids.includes(candidate));
}

function approvalCandidateIds(approval: { id: string; approvalId?: string; approvalSlug?: string; itemId?: string; toolCallId?: string }): string[] {
  return [
    approval.id,
    approval.approvalId,
    approval.approvalSlug,
    approval.itemId,
    approval.toolCallId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
}

const MAX_RESOLVED_APPROVAL_IDS = 500;

function appendResolvedApprovalIds(existing: string[], ids: string[]): string[] {
  const next = uniqueIds([...existing, ...ids]);
  return next.slice(Math.max(0, next.length - MAX_RESOLVED_APPROVAL_IDS));
}

function appendId(ids: string[] | undefined, id: string): string[] {
  if (ids?.includes(id)) return ids;
  return [...(ids ?? []), id];
}

function compactIds(values: Array<string | undefined>): string[] {
  return uniqueIds(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  )));
}

function entryOrder(entry: { order?: number } | null | undefined): number | undefined {
  return typeof entry?.order === 'number' && Number.isFinite(entry.order)
    ? entry.order
    : undefined;
}

function maxEntryOrder(entries: Array<{ order?: number } | null | undefined>): number {
  return entries.reduce((max, entry) => {
    const order = entryOrder(entry);
    return order === undefined ? max : Math.max(max, order);
  }, -1);
}

function nextLiveOrder(live: ChatCoreState['live']): number {
  return maxEntryOrder([
    live.currentAssistant,
    ...live.assistantSegments,
    live.currentThinking,
    ...live.thinkingSegments,
    ...Object.values(live.toolStreamById),
    ...live.commandOutputs,
    ...live.patchSummaries,
  ]) + 1;
}

function keepRunStatusAfterHistoryLoad(status: ChatRunUiStatus | null): ChatRunUiStatus | null {
  if (!status) return null;
  return status.phase === 'running' || status.phase === 'error' ? status : null;
}

function createEmptyLiveState(): ChatCoreState['live'] {
  return {
    runId: null,
    currentAssistant: null,
    assistantSegments: [],
    currentThinking: null,
    thinkingSegments: [],
    toolMessages: [],
    toolStreamById: {},
    toolStreamOrder: [],
    commandOutputs: [],
    patchSummaries: [],
  };
}

function normalizeKind(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[_-]/g, '').toLowerCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function streamFallbackRecord(message: RawOpenClawMessage): Record<string, unknown> | null {
  const fallback = message.openclawStreamFallback;
  return isRecord(fallback) ? fallback : null;
}

function normalizeAssistantTextForMatch(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function isAssistantLikeHistoryMessage(message: RawOpenClawMessage): boolean {
  const role = normalizeKind(message.role);
  return role === '' || role === 'assistant';
}

function messageReplacesAssistantStreamFallback(
  message: RawOpenClawMessage,
  fallbackText: string,
): boolean {
  if (!isAssistantLikeHistoryMessage(message)) return false;
  const expected = normalizeAssistantTextForMatch(fallbackText);
  if (!expected) return false;
  const actualCandidates = [
    extractDisplayMessageText(message),
    extractAssistantCommentaryText(message) ?? '',
  ]
    .map(normalizeAssistantTextForMatch)
    .filter(Boolean);
  return actualCandidates.some((actual) => (
    actual === expected || actual.startsWith(expected)
  ));
}

function historyHasAssistantStreamFallbackReplacement(
  messages: RawOpenClawMessage[],
  fallbackText: string,
): boolean {
  return messages.some((message) => messageReplacesAssistantStreamFallback(message, fallbackText));
}

function messageToolReferenceIds(message: RawOpenClawMessage): string[] {
  const ids = compactIds([
    typeof message.id === 'string' ? message.id : undefined,
    typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
    typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined,
    typeof message.toolUseId === 'string' ? message.toolUseId : undefined,
    typeof message.tool_use_id === 'string' ? message.tool_use_id : undefined,
    typeof message.callId === 'string' ? message.callId : undefined,
    typeof message.call_id === 'string' ? message.call_id : undefined,
  ]);

  if (!Array.isArray(message.content)) return ids;
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    ids.push(...compactIds([
      typeof block.id === 'string' ? block.id : undefined,
      typeof block.toolCallId === 'string' ? block.toolCallId : undefined,
      typeof block.tool_call_id === 'string' ? block.tool_call_id : undefined,
      typeof block.toolUseId === 'string' ? block.toolUseId : undefined,
      typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
      typeof block.callId === 'string' ? block.callId : undefined,
      typeof block.call_id === 'string' ? block.call_id : undefined,
    ]));
  }
  return uniqueIds(ids);
}

function liveToolReferenceIds(tool: LiveToolEntry): string[] {
  return compactIds([
    tool.toolCallId,
    tool.itemId,
    tool.toolId,
    tool.callId,
    tool.id,
  ]);
}

function fallbackAnchorIdsFromLive(
  live: ChatCoreState['live'],
  order: number | undefined,
): string[] {
  if (order === undefined) return [];
  const laterTools = live.toolStreamOrder
    .map((toolId) => live.toolStreamById[toolId])
    .filter((tool): tool is LiveToolEntry => Boolean(tool))
    .filter((tool) => {
      const toolOrder = entryOrder(tool);
      return toolOrder !== undefined && toolOrder > order;
    })
    .sort((left, right) => (entryOrder(left) ?? 0) - (entryOrder(right) ?? 0));
  return laterTools.length > 0 ? liveToolReferenceIds(laterTools[0]) : [];
}

type AssistantFallbackSeed = {
  message: RawOpenClawMessage;
  text: string;
  anchorIds: string[];
};

function fallbackSeedFromLiveSegment(
  live: ChatCoreState['live'],
  segment: LiveAssistantSegment,
): AssistantFallbackSeed | null {
  const display = stripHeartbeatTokenForDisplay(segment.text);
  if (display.shouldSkip) return null;

  const anchorIds = fallbackAnchorIdsFromLive(live, segment.order);
  return {
    text: display.text,
    anchorIds,
    message: {
      role: 'assistant',
      runId: segment.runId,
      timestamp: segment.ts,
      content: [{ type: 'text', text: display.text }],
      openclawStreamFallback: {
        replacementText: segment.text,
        phase: segment.phase,
        runId: segment.runId,
        order: segment.order,
        ...(anchorIds.length > 0 ? { beforeToolIds: anchorIds } : {}),
      },
    },
  };
}

function fallbackSeedFromHistoryMessage(message: RawOpenClawMessage): AssistantFallbackSeed | null {
  const fallback = streamFallbackRecord(message);
  if (!fallback) return null;
  const text = typeof fallback.replacementText === 'string'
    ? fallback.replacementText
    : extractDisplayMessageText(message);
  const display = stripHeartbeatTokenForDisplay(text);
  if (display.shouldSkip) return null;
  return {
    message,
    text: display.text,
    anchorIds: arrayOfStrings(fallback.beforeToolIds),
  };
}

function liveAssistantFallbackSeeds(live: ChatCoreState['live']): AssistantFallbackSeed[] {
  return [
    ...live.assistantSegments,
    ...(live.currentAssistant ? [live.currentAssistant] : []),
  ]
    .sort((left, right) => (entryOrder(left) ?? 0) - (entryOrder(right) ?? 0))
    .flatMap((segment) => {
      const seed = fallbackSeedFromLiveSegment(live, segment);
      return seed ? [seed] : [];
    });
}

function historyAssistantFallbackSeeds(messages: RawOpenClawMessage[]): AssistantFallbackSeed[] {
  return messages.flatMap((message) => {
    const seed = fallbackSeedFromHistoryMessage(message);
    return seed ? [seed] : [];
  });
}

function insertIndexForAssistantFallback(
  messages: RawOpenClawMessage[],
  anchorIds: string[],
): number {
  if (anchorIds.length > 0) {
    const anchorSet = new Set(anchorIds);
    const anchorIndex = messages.findIndex((message) => (
      messageToolReferenceIds(message).some((id) => anchorSet.has(id))
    ));
    if (anchorIndex >= 0) return anchorIndex;
  }
  return messages.length;
}

function mergeMissingAssistantFallbacks(
  messages: RawOpenClawMessage[],
  seeds: AssistantFallbackSeed[],
): RawOpenClawMessage[] {
  let nextMessages = messages;
  for (const seed of seeds) {
    if (historyHasAssistantStreamFallbackReplacement(nextMessages, seed.text)) continue;
    const insertIndex = insertIndexForAssistantFallback(nextMessages, seed.anchorIds);
    nextMessages = [
      ...nextMessages.slice(0, insertIndex),
      seed.message,
      ...nextMessages.slice(insertIndex),
    ];
  }
  return nextMessages;
}

function reconcileHistoryWithLiveAssistantFallbacks(
  incomingMessages: RawOpenClawMessage[],
  state: ChatCoreState,
): RawOpenClawMessage[] {
  const seeds = [
    ...historyAssistantFallbackSeeds(state.history.messages),
    ...liveAssistantFallbackSeeds(state.live),
  ];
  return seeds.length > 0 ? mergeMissingAssistantFallbacks(incomingMessages, seeds) : incomingMessages;
}

function clearLiveStreams(live: ChatCoreState['live']): ChatCoreState['live'] {
  return {
    ...live,
    runId: null,
    currentAssistant: null,
    assistantSegments: [],
    currentThinking: null,
    thinkingSegments: [],
    toolStreamById: {},
    toolStreamOrder: [],
    commandOutputs: [],
    patchSummaries: [],
  };
}

function hasVisibleLiveContent(live: ChatCoreState['live']): boolean {
  return Boolean(
    live.currentAssistant
    || live.assistantSegments.length > 0
    || live.currentThinking
    || live.thinkingSegments.length > 0
    || live.toolStreamOrder.length > 0
    || live.commandOutputs.length > 0
    || live.patchSummaries.length > 0
  );
}

function isPendingQueueItemForSession(
  item: ChatCoreState['send']['queue'][number],
  sessionKey: string,
): boolean {
  return item.sessionKey === sessionKey && (
    item.state === 'queued'
    || item.state === 'sending'
    || item.state === 'waiting-reconnect'
  );
}

function shouldDeferHistoryHydrationForLiveTurn(
  state: ChatCoreState,
  incomingMessages: RawOpenClawMessage[],
): boolean {
  if (!hasVisibleLiveContent(state.live)) return false;
  return state.send.queue.some((item) => (
    isPendingQueueItemForSession(item, state.sessionKey)
    && !queueItemHasMatchingHistoryMessage(item, incomingMessages)
  ));
}

function liveAfterTerminalRunStatus(
  state: ChatCoreState,
  status: ChatRunUiStatus,
): ChatCoreState['live'] {
  if (status.phase !== 'done') return clearLiveStreams(state.live);
  const runId = nonEmptyRunId(status.runId);
  if (state.live.runId && runId && state.live.runId !== runId) return clearLiveStreams(state.live);
  return state.live;
}

function isAbortedRun(state: ChatCoreState, runId: string | null | undefined): boolean {
  const value = nonEmptyRunId(runId);
  if (!value) return state.send.abortedRunIds.includes('*');
  return state.send.abortedRunIds.includes('*') || state.send.abortedRunIds.includes(value);
}

function appendAbortedRunId(ids: string[], runId: string): string[] {
  if (ids.includes(runId)) return ids;
  return [...ids, runId].slice(-20);
}

function liveStateForDelta(
  live: ChatCoreState['live'],
  runId: string,
): ChatCoreState['live'] {
  return live.runId && live.runId !== runId ? clearLiveStreams(live) : live;
}

function assistantSegmentId(action: Extract<ChatCoreAction, { type: 'assistant.delta' }>): string {
  return `assistant-${action.runId}-${action.phase}-${action.ts}`;
}

function thinkingSegmentId(action: Extract<ChatCoreAction, { type: 'thinking.delta' }>): string {
  return `thinking-${action.runId}-${action.ts}`;
}

function optionalMediaUrls(
  mediaUrls: string[] | undefined,
): Pick<LiveAssistantSegment, 'mediaUrls'> {
  return mediaUrls && mediaUrls.length > 0 ? { mediaUrls } : {};
}

function commitCurrentAssistant(live: ChatCoreState['live']): ChatCoreState['live'] {
  if (!live.currentAssistant) return live;
  return {
    ...live,
    assistantSegments: [...live.assistantSegments, live.currentAssistant],
    currentAssistant: null,
  };
}

function liveToolEntryFromAction(
  existing: LiveToolEntry | undefined,
  tool: ToolStreamActionPayload,
  order: number,
): LiveToolEntry {
  const id = existing?.id ?? (tool.id.trim() || tool.toolCallId || 'tool');
  const entry: LiveToolEntry = {
    id,
    runId: tool.runId,
    name: tool.name || existing?.name || 'tool',
    startedAt: existing?.startedAt ?? tool.startedAt,
    updatedAt: tool.updatedAt,
    order: existing?.order ?? order,
  };

  const sessionKey = tool.sessionKey ?? existing?.sessionKey;
  if (sessionKey) entry.sessionKey = sessionKey;
  if (tool.toolCallId !== undefined) {
    entry.toolCallId = tool.toolCallId;
  } else if (existing?.toolCallId !== undefined) {
    entry.toolCallId = existing.toolCallId;
  }
  if (tool.itemId !== undefined) {
    entry.itemId = tool.itemId;
  } else if (existing?.itemId !== undefined) {
    entry.itemId = existing.itemId;
  }
  if (tool.toolId !== undefined) {
    entry.toolId = tool.toolId;
  } else if (existing?.toolId !== undefined) {
    entry.toolId = existing.toolId;
  }
  if (tool.callId !== undefined) {
    entry.callId = tool.callId;
  } else if (existing?.callId !== undefined) {
    entry.callId = existing.callId;
  }
  if (tool.title !== undefined) {
    entry.title = tool.title;
  } else if (existing?.title !== undefined) {
    entry.title = existing.title;
  }
  if (tool.status !== undefined) {
    entry.status = tool.status;
  } else if (existing?.status !== undefined) {
    entry.status = existing.status;
  }
  if (tool.args !== undefined) {
    entry.args = tool.args;
  } else if (existing && 'args' in existing) {
    entry.args = existing.args;
  }
  if (tool.output !== undefined) {
    entry.output = tool.output;
  } else if (existing?.output !== undefined) {
    entry.output = existing.output;
  }
  if (tool.isError !== undefined) {
    entry.isError = tool.isError;
  } else if (existing?.isError !== undefined) {
    entry.isError = existing.isError;
  }
  if (tool.errorText !== undefined) {
    entry.errorText = tool.errorText;
  } else if (existing?.errorText !== undefined) {
    entry.errorText = existing.errorText;
  }
  if (tool.rawPayload !== undefined) {
    entry.rawPayload = tool.rawPayload;
  } else if (existing?.rawPayload !== undefined) {
    entry.rawPayload = existing.rawPayload;
  }
  if (tool.identitySource !== undefined) {
    entry.identitySource = tool.identitySource;
  } else if (existing?.identitySource !== undefined) {
    entry.identitySource = existing.identitySource;
  }
  if (tool.fingerprint !== undefined) {
    entry.fingerprint = tool.fingerprint;
  } else if (existing?.fingerprint !== undefined) {
    entry.fingerprint = existing.fingerprint;
  }
  if (existing?.commandOutputIds) entry.commandOutputIds = existing.commandOutputIds;
  if (existing?.patchSummaryIds) entry.patchSummaryIds = existing.patchSummaryIds;

  return entry;
}

const TERMINAL_TOOL_STATUSES = new Set(['end', 'result', 'completed', 'done', 'finished']);

function isTerminalToolEntry(entry: LiveToolEntry): boolean {
  return typeof entry.status === 'string' && TERMINAL_TOOL_STATUSES.has(entry.status.toLowerCase());
}

function fallbackToolKeyForUpdate(
  live: ChatCoreState['live'],
  tool: ToolStreamActionPayload,
): string | undefined {
  if (tool.identitySource !== 'fallback' || !tool.fingerprint) return undefined;
  let exactMatch: string | undefined;
  let exactMatchCount = 0;
  let weakMatch: string | undefined;
  let weakMatchCount = 0;
  for (let index = live.toolStreamOrder.length - 1; index >= 0; index--) {
    const key = live.toolStreamOrder[index];
    const entry = live.toolStreamById[key];
    if (!entry) continue;
    if (entry.identitySource !== 'fallback') continue;
    if (entry.runId !== tool.runId) continue;
    if (isTerminalToolEntry(entry)) continue;
    if (entry.fingerprint === tool.fingerprint) {
      exactMatch ??= key;
      exactMatchCount += 1;
      continue;
    }
    if (
      tool.args === undefined
      && entry.name === tool.name
      && (tool.title === undefined || entry.title === undefined || entry.title === tool.title)
    ) {
      weakMatch ??= key;
      weakMatchCount += 1;
    }
  }
  if (exactMatchCount === 1) return exactMatch;
  if (exactMatchCount > 1) return undefined;
  return weakMatchCount === 1 ? weakMatch : undefined;
}

function upsertLiveTool(
  live: ChatCoreState['live'],
  tool: ToolStreamActionPayload,
  options: { commitAssistant?: boolean; commitAssistantOnInsert?: boolean; matchFallback?: boolean } = {},
): ChatCoreState['live'] {
  const toolKey = live.toolStreamById[tool.id]
    ? tool.id
    : options.matchFallback
      ? fallbackToolKeyForUpdate(live, tool) ?? tool.id
      : tool.id;
  const shouldCommitAssistant = options.commitAssistant
    || (options.commitAssistantOnInsert && !live.toolStreamById[toolKey]);
  const baseLive = shouldCommitAssistant ? commitCurrentAssistant(live) : live;
  const existing = baseLive.toolStreamById[toolKey];
  const entry = liveToolEntryFromAction(existing, tool, nextLiveOrder(baseLive));
  const hasExistingOrder = baseLive.toolStreamOrder.includes(toolKey);

  const nextLive = {
    ...baseLive,
    runId: tool.runId,
    toolStreamById: {
      ...baseLive.toolStreamById,
      [toolKey]: entry,
    },
    toolStreamOrder: hasExistingOrder
      ? baseLive.toolStreamOrder
      : [...baseLive.toolStreamOrder, toolKey],
  };
  return reconcileExistingEntriesForTool(nextLive, toolKey);
}

function upsertEntryById<T extends { id: string }>(entries: T[], entry: T): T[] {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) return [...entries, entry];
  return entries.map((item, currentIndex) => (currentIndex === index ? entry : item));
}

function toolAssociationIds(entry: LiveToolEntry): string[] {
  return compactIds([
    entry.toolCallId,
    entry.id,
    entry.itemId,
    entry.toolId,
    entry.callId,
  ]);
}

function commandAssociationIds(output: CommandOutputEntry): string[] {
  return compactIds([
    output.toolCallId,
    output.itemId,
    output.toolId,
    output.toolItemId,
    output.callId,
    output.parentId,
    output.parentItemId,
  ]);
}

function patchAssociationIds(patch: PatchSummaryEntry): string[] {
  return compactIds([
    patch.toolCallId,
    patch.itemId,
    patch.toolId,
    patch.toolItemId,
    patch.callId,
    patch.parentId,
    patch.parentItemId,
  ]);
}

function findAssociatedToolCallId(
  live: ChatCoreState['live'],
  associationIds: string[],
): string | undefined {
  if (associationIds.length === 0) return undefined;
  for (const id of associationIds) {
    if (live.toolStreamById[id]) return id;
  }
  for (const toolCallId of live.toolStreamOrder) {
    const entry = live.toolStreamById[toolCallId];
    if (!entry) continue;
    const toolIds = toolAssociationIds(entry);
    if (associationIds.some((id) => toolIds.includes(id))) return toolCallId;
  }
  return undefined;
}

function foldCommandOutputIntoTool(
  live: ChatCoreState['live'],
  output: CommandOutputEntry,
): ChatCoreState['live'] {
  const toolCallId = findAssociatedToolCallId(live, commandAssociationIds(output));
  if (!toolCallId) return live;
  const existing = live.toolStreamById[toolCallId];
  if (!existing) return live;
  return {
    ...live,
    toolStreamById: {
      ...live.toolStreamById,
      [toolCallId]: {
        ...existing,
        ...(output.output !== undefined ? { output: output.output } : {}),
        commandOutputIds: appendId(existing.commandOutputIds, output.id),
        updatedAt: Math.max(existing.updatedAt, output.ts),
      },
    },
  };
}

function foldPatchSummaryIntoTool(
  live: ChatCoreState['live'],
  patch: PatchSummaryEntry,
): ChatCoreState['live'] {
  const toolCallId = findAssociatedToolCallId(live, patchAssociationIds(patch));
  if (!toolCallId) return live;
  const existing = live.toolStreamById[toolCallId];
  if (!existing) return live;
  return {
    ...live,
    toolStreamById: {
      ...live.toolStreamById,
      [toolCallId]: {
        ...existing,
        patchSummaryIds: appendId(existing.patchSummaryIds, patch.id),
        updatedAt: Math.max(existing.updatedAt, patch.ts),
      },
    },
  };
}

function reconcileExistingEntriesForTool(
  live: ChatCoreState['live'],
  toolKey: string,
): ChatCoreState['live'] {
  const entry = live.toolStreamById[toolKey];
  if (!entry) return live;

  const hadToolOutput = entry.output !== undefined;
  let nextEntry = entry;
  for (const output of live.commandOutputs) {
    if (findAssociatedToolCallId(live, commandAssociationIds(output)) !== toolKey) continue;
    nextEntry = {
      ...nextEntry,
      ...(!hadToolOutput && output.output !== undefined ? { output: output.output } : {}),
      commandOutputIds: appendId(nextEntry.commandOutputIds, output.id),
      updatedAt: Math.max(nextEntry.updatedAt, output.ts),
    };
  }
  for (const patch of live.patchSummaries) {
    if (findAssociatedToolCallId(live, patchAssociationIds(patch)) !== toolKey) continue;
    nextEntry = {
      ...nextEntry,
      patchSummaryIds: appendId(nextEntry.patchSummaryIds, patch.id),
      updatedAt: Math.max(nextEntry.updatedAt, patch.ts),
    };
  }

  if (nextEntry === entry) return live;
  return {
    ...live,
    toolStreamById: {
      ...live.toolStreamById,
      [toolKey]: nextEntry,
    },
  };
}

function upsertApproval(
  state: ChatCoreState,
  approval: ApprovalRequest,
): ChatCoreState {
  if (!eventMatchesSession(state, approval.sessionKey)) return state;
  const approvalIds = approvalCandidateIds(approval);
  if (approvalMatchesAnyId(approval, state.runtime.resolvedApprovalIds)) return state;

  const existingIndex = state.runtime.approvals.findIndex((existing) => (
    approvalMatchesAnyId(existing, approvalIds)
  ));
  const approvals = existingIndex === -1
    ? [...state.runtime.approvals, approval]
    : state.runtime.approvals.map((existing, index) => (
      index === existingIndex ? { ...existing, ...approval } : existing
    ));

  return {
    ...state,
    runtime: { ...state.runtime, approvals },
  };
}

function applyAssistantDelta(
  state: ChatCoreState,
  action: Extract<ChatCoreAction, { type: 'assistant.delta' }>,
): ChatCoreState {
  if (!eventMatchesSession(state, action.sessionKey)) return state;
  if (isAbortedRun(state, action.runId)) return state;

  const live = liveStateForDelta(state.live, action.runId);
  const prior = live.currentAssistant;
  const canContinue = prior?.runId === action.runId && prior.phase === action.phase;
  const mediaUrls = canContinue
    ? action.mediaUrls ?? prior.mediaUrls
    : action.mediaUrls;
  const currentAssistant: LiveAssistantSegment = {
    id: canContinue ? prior.id : assistantSegmentId(action),
    runId: action.runId,
    text: action.mode === 'append' && canContinue ? `${prior.text}${action.text}` : action.text,
    phase: action.phase,
    ts: action.ts,
    order: canContinue ? prior.order : nextLiveOrder(live),
    ...optionalMediaUrls(mediaUrls),
  };

  return {
    ...state,
    live: {
      ...live,
      runId: action.runId,
      currentAssistant,
      assistantSegments: prior && !canContinue
        ? [...live.assistantSegments, prior]
        : live.assistantSegments,
    },
    send: { ...state.send, activeRunId: action.runId, canAbort: true },
  };
}

function applyThinkingDelta(
  state: ChatCoreState,
  action: Extract<ChatCoreAction, { type: 'thinking.delta' }>,
): ChatCoreState {
  if (!eventMatchesSession(state, action.sessionKey)) return state;
  if (isAbortedRun(state, action.runId)) return state;

  const live = liveStateForDelta(state.live, action.runId);
  const prior = live.currentThinking;
  const canContinue = prior?.runId === action.runId;
  const currentThinking: LiveThinkingSegment = {
    id: canContinue ? prior.id : thinkingSegmentId(action),
    runId: action.runId,
    text: action.mode === 'append' && canContinue ? `${prior.text}${action.text}` : action.text,
    ts: action.ts,
    order: canContinue ? prior.order : nextLiveOrder(live),
  };

  return {
    ...state,
    live: {
      ...live,
      runId: action.runId,
      currentThinking,
      thinkingSegments: prior && !canContinue
        ? [...live.thinkingSegments, prior]
        : live.thinkingSegments,
    },
    send: { ...state.send, activeRunId: action.runId, canAbort: true },
  };
}

function isTerminalRunStatus(status: ChatRunUiStatus | null): status is ChatRunUiStatus {
  return status?.phase === 'done' || status?.phase === 'error' || status?.phase === 'interrupted';
}

function nonEmptyRunId(runId: string | null | undefined): string | null {
  return typeof runId === 'string' && runId.trim().length > 0 ? runId : null;
}

function currentRunId(state: ChatCoreState): string | null {
  return nonEmptyRunId(state.send.activeRunId)
    ?? nonEmptyRunId(state.live.runId)
    ?? (state.runtime.runStatus?.phase === 'running'
      ? nonEmptyRunId(state.runtime.runStatus.runId)
      : null);
}

function shouldApplyTerminalRunStatus(
  state: ChatCoreState,
  status: ChatRunUiStatus,
): boolean {
  const activeRunId = currentRunId(state);
  if (!activeRunId) return true;
  return status.runId === activeRunId;
}

export function chatCoreReducer(state: ChatCoreState, action: ChatCoreAction): ChatCoreState {
  switch (action.type) {
    case 'session.changed':
      return {
        ...state,
        sessionKey: action.sessionKey,
        selectedAgentId: action.selectedAgentId,
        history: {
          ...state.history,
          messages: [],
          loading: false,
          requestVersion: state.history.requestVersion + 1,
        },
        live: createEmptyLiveState(),
        send: { ...state.send, activeRunId: null, canAbort: false, lastError: null },
        runtime: {
          runStatus: null,
          compactionStatus: null,
          fallbackStatus: null,
          approvals: [],
          resolvedApprovalIds: [],
        },
      };

    case 'history.requested':
      if (action.sessionKey !== state.sessionKey) return state;
      return {
        ...state,
        history: { ...state.history, loading: true, requestVersion: action.requestVersion },
      };

    case 'history.loaded':
      if (action.sessionKey !== state.sessionKey) return state;
      if (action.requestVersion < state.history.requestVersion) return state;
      if (shouldDeferHistoryHydrationForLiveTurn(state, action.messages)) {
        return {
          ...state,
          history: {
            ...state.history,
            loading: false,
            hasMore: action.hasMore,
            requestVersion: action.requestVersion,
          },
          runtime: {
            ...state.runtime,
            runStatus: keepRunStatusAfterHistoryLoad(state.runtime.runStatus),
          },
        };
      }
      return {
        ...state,
        history: {
          messages: reconcileHistoryWithLiveAssistantFallbacks(action.messages, state),
          loading: false,
          hasMore: action.hasMore,
          requestVersion: action.requestVersion,
        },
        live: clearLiveStreams(state.live),
        runtime: {
          ...state.runtime,
          runStatus: keepRunStatusAfterHistoryLoad(state.runtime.runStatus),
        },
      };

    case 'send.enqueued':
      return {
        ...state,
        send: {
          ...state.send,
          sending: true,
          queue: [...state.send.queue, action.item],
          lastError: null,
          abortedRunIds: state.send.abortedRunIds.filter((id) => id !== '*'),
        },
      };

    case 'send.acked':
      if (isAbortedRun(state, action.runId)) return state;
      return {
        ...state,
        send: {
          ...state.send,
          activeRunId: action.runId,
          canAbort: true,
          queue: state.send.queue.map((item) => (
            item.id === action.id ? { ...item, state: 'sending' } : item
          )),
        },
      };

    case 'send.aborted': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const runId = nonEmptyRunId(action.runId) ?? currentRunId(state) ?? '*';
      return {
        ...state,
        live: clearLiveStreams(state.live),
        send: {
          ...state.send,
          sending: false,
          activeRunId: null,
          canAbort: false,
          abortedRunIds: appendAbortedRunId(state.send.abortedRunIds, runId),
        },
        runtime: {
          ...state.runtime,
          runStatus: state.runtime.runStatus?.phase === 'running' ? null : state.runtime.runStatus,
        },
      };
    }

    case 'send.failed':
      return {
        ...state,
        send: {
          ...state.send,
          sending: action.recoverable,
          lastError: action.error,
          queue: state.send.queue.map((item) => (
            item.id === action.id
              ? {
                ...item,
                state: action.recoverable ? 'waiting-reconnect' : 'failed',
                error: action.error,
              }
              : item
          )),
        },
      };

    case 'chat.delta': {
      return applyAssistantDelta(state, {
        type: 'assistant.delta',
        sessionKey: action.sessionKey,
        runId: action.runId,
        text: action.text,
        phase: 'legacy',
        ts: action.ts,
        mode: action.mode,
      });
    }

    case 'assistant.delta': {
      return applyAssistantDelta(state, action);
    }

    case 'thinking.delta': {
      return applyThinkingDelta(state, action);
    }

    case 'tool.started': {
      if (!eventMatchesSession(state, action.sessionKey ?? action.tool.sessionKey)) return state;
      if (isAbortedRun(state, action.tool.runId)) return state;
      const live = liveStateForDelta(state.live, action.tool.runId);
      return {
        ...state,
        live: upsertLiveTool(live, action.tool, { commitAssistant: true }),
        send: { ...state.send, activeRunId: action.tool.runId, canAbort: true },
      };
    }

    case 'tool.updated': {
      if (!eventMatchesSession(state, action.sessionKey ?? action.tool.sessionKey)) return state;
      if (isAbortedRun(state, action.tool.runId)) return state;
      const live = liveStateForDelta(state.live, action.tool.runId);
      return {
        ...state,
        live: upsertLiveTool(live, action.tool, { commitAssistantOnInsert: true, matchFallback: true }),
        send: { ...state.send, activeRunId: action.tool.runId, canAbort: true },
      };
    }

    case 'tool.completed': {
      if (!eventMatchesSession(state, action.sessionKey ?? action.tool.sessionKey)) return state;
      if (isAbortedRun(state, action.tool.runId)) return state;
      const live = liveStateForDelta(state.live, action.tool.runId);
      return {
        ...state,
        live: upsertLiveTool(live, action.tool, { commitAssistantOnInsert: true, matchFallback: true }),
        send: { ...state.send, activeRunId: action.tool.runId, canAbort: true },
      };
    }

    case 'command.output': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      if (isAbortedRun(state, action.output.runId)) return state;
      const live = liveStateForDelta(state.live, action.output.runId);
      const existing = live.commandOutputs.find((entry) => entry.id === action.output.id);
      const output = {
        ...action.output,
        order: existing?.order ?? nextLiveOrder(live),
      };
      const withOutput = {
        ...live,
        runId: output.runId,
        commandOutputs: upsertEntryById(live.commandOutputs, output),
      };
      return {
        ...state,
        live: foldCommandOutputIntoTool(withOutput, output),
        send: { ...state.send, activeRunId: output.runId, canAbort: true },
      };
    }

    case 'patch.completed': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      if (isAbortedRun(state, action.patch.runId)) return state;
      const live = liveStateForDelta(state.live, action.patch.runId);
      const existing = live.patchSummaries.find((entry) => entry.id === action.patch.id);
      const patch = {
        ...action.patch,
        order: existing?.order ?? nextLiveOrder(live),
      };
      const withPatch = {
        ...live,
        runId: patch.runId,
        patchSummaries: upsertEntryById(live.patchSummaries, patch),
      };
      return {
        ...state,
        live: foldPatchSummaryIntoTool(withPatch, patch),
        send: { ...state.send, activeRunId: patch.runId, canAbort: true },
      };
    }

    case 'chat.final': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      if (isAbortedRun(state, action.runId)) return state;
      const runStatus: ChatRunUiStatus = { phase: 'done', runId: action.runId };
      if (!shouldApplyTerminalRunStatus(state, runStatus)) return state;
      return {
        ...state,
        live: state.live.runId && state.live.runId !== action.runId
          ? clearLiveStreams(state.live)
          : state.live,
        send: { ...state.send, sending: false, activeRunId: null, canAbort: false },
        runtime: {
          ...state.runtime,
          runStatus,
          compactionStatus: null,
          fallbackStatus: null,
        },
      };
    }

    case 'chat.error': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      if (action.runId && isAbortedRun(state, action.runId)) return state;
      const runStatus: ChatRunUiStatus = {
        phase: 'error',
        runId: action.runId,
        message: action.error,
      };
      if (!shouldApplyTerminalRunStatus(state, runStatus)) return state;
      return {
        ...state,
        live: clearLiveStreams(state.live),
        send: {
          ...state.send,
          sending: false,
          activeRunId: null,
          canAbort: false,
          lastError: action.error,
        },
        runtime: {
          ...state.runtime,
          runStatus,
          compactionStatus: null,
          fallbackStatus: null,
        },
      };
    }

    case 'run.status': {
      if (!eventMatchesSession(state, action.sessionKey ?? action.status?.sessionKey)) return state;
      if (action.status?.runId && isAbortedRun(state, action.status.runId)) return state;
      if (!isTerminalRunStatus(action.status)) {
        return { ...state, runtime: { ...state.runtime, runStatus: action.status } };
      }
      if (!shouldApplyTerminalRunStatus(state, action.status)) return state;
      return {
        ...state,
        live: liveAfterTerminalRunStatus(state, action.status),
        send: { ...state.send, sending: false, activeRunId: null, canAbort: false },
        runtime: { ...state.runtime, runStatus: action.status },
      };
    }

    case 'runtime.compaction':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return {
        ...state,
        runtime: { ...state.runtime, compactionStatus: action.status },
      };

    case 'runtime.fallback':
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      return {
        ...state,
        runtime: { ...state.runtime, fallbackStatus: action.status },
      };

    case 'approval.requested':
    case 'approval.upserted':
      return upsertApproval(state, action.approval);

    case 'approval.resolved': {
      if (!eventMatchesSession(state, action.sessionKey)) return state;
      const ids = uniqueIds(action.ids);
      return {
        ...state,
        runtime: {
          ...state.runtime,
          approvals: state.runtime.approvals.filter((approval) => (
            !approvalMatchesAnyId(approval, ids)
          )),
          resolvedApprovalIds: appendResolvedApprovalIds(state.runtime.resolvedApprovalIds, ids),
        },
      };
    }

    case 'agent.event':
      return state;

    default:
      return state;
  }
}
