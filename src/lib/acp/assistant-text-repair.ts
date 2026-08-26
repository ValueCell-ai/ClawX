import type { AcpTimelineSnapshot, MessageSegmentItem } from './timeline-types';

// The ACP delta path between the pinned bridge and this timeline is lossy in ways the bridge
// cannot observe: the Gateway broadcasts chat deltas with `dropIfSlow`, and Main/Renderer drop
// updates whose session or generation no longer matches. A single lost `agent_message_chunk`
// therefore leaves a permanently short reply that only a reload repairs. This bounded end-of-turn
// check converges the settled turn onto the persisted transcript instead. Architecture rationale
// and removal condition: harness/reference/acp-chat.md.

export type AssistantTextRepairStatus =
  | 'repaired'
  | 'already-matching'
  | 'declined-shorter-transcript'
  | 'turn-not-found'
  | 'ambiguous-segment'
  | 'segment-count-mismatch'
  | 'no-streamed-text'
  | 'no-transcript-text';

export type AssistantTextRepairOutcome = {
  status: AssistantTextRepairStatus;
  repairedSegmentCount: number;
  /** Pairs that differed but were left alone because the transcript read was shorter. */
  declinedSegmentCount: number;
  streamedSegmentCount: number;
  transcriptTextCount: number;
  /** Total characters recovered across repaired segments; negative when the transcript is denser. */
  recoveredCharacterCount: number;
  /** Shared prefix of the first mismatching pair, to distinguish a lost tail from a diverged reply. */
  sharedPrefixLength: number;
};

export type AssistantTextRepairResult = {
  snapshot: AcpTimelineSnapshot;
  outcome: AssistantTextRepairOutcome;
};

type StreamedAssistantSegment = {
  itemId: string;
  item: MessageSegmentItem;
  partIndex: number;
  text: string;
};

function emptyOutcome(status: AssistantTextRepairStatus, overrides: Partial<AssistantTextRepairOutcome> = {}): AssistantTextRepairOutcome {
  return {
    status,
    repairedSegmentCount: 0,
    declinedSegmentCount: 0,
    streamedSegmentCount: 0,
    transcriptTextCount: 0,
    recoveredCharacterCount: 0,
    sharedPrefixLength: 0,
    ...overrides,
  };
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return index;
}

type CollectedSegments =
  | { status: 'ok'; segments: StreamedAssistantSegment[] }
  | { status: 'turn-not-found' | 'ambiguous-segment' };

/**
 * Assistant markdown segments streamed for one turn, in timeline order. A turn that cannot be
 * resolved unambiguously collects nothing, because a wrong pairing would corrupt a correct reply.
 */
function collectTurnAssistantSegments(
  snapshot: AcpTimelineSnapshot,
  liveUserMessageId: string,
): CollectedSegments {
  const startIndex = snapshot.itemOrder.findIndex((itemId) => {
    const item = snapshot.itemsById[itemId];
    return item?.kind === 'message-segment' && item.role === 'user' && item.messageId === liveUserMessageId;
  });
  if (startIndex < 0) return { status: 'turn-not-found' };

  const segments: StreamedAssistantSegment[] = [];
  for (let index = startIndex + 1; index < snapshot.itemOrder.length; index += 1) {
    const itemId = snapshot.itemOrder[index]!;
    const item = snapshot.itemsById[itemId];
    if (item?.kind !== 'message-segment') continue;
    if (item.role === 'user') {
      if (item.messageId === liveUserMessageId) continue;
      break;
    }
    // Renderer-only compatibility projections are not part of the streamed reply.
    if (item.compat) continue;

    let markdown: { partIndex: number; text: string } | null = null;
    let markdownCount = 0;
    for (const [partIndex, part] of item.parts.entries()) {
      if (part.kind !== 'markdown') continue;
      markdownCount += 1;
      markdown = { partIndex, text: part.text };
    }
    if (markdownCount > 1) return { status: 'ambiguous-segment' };
    if (!markdown) continue;
    segments.push({ itemId, item, partIndex: markdown.partIndex, text: markdown.text });
  }
  return { status: 'ok', segments };
}

/**
 * A paired segment is rewritten only when the transcript projection carries at least as much
 * content. A shorter projection means the transcript was read before the turn was fully persisted,
 * and a whitespace-only difference is churn the reader would never notice.
 */
function compareSegment(streamedText: string, transcriptText: string): 'repair' | 'decline' | 'match' {
  if (!transcriptText) return 'match';
  if (transcriptText === streamedText) return 'match';
  if (transcriptText.trim() === streamedText.trim()) return 'match';
  return transcriptText.length >= streamedText.length ? 'repair' : 'decline';
}

/**
 * Converge one settled turn's assistant text onto the persisted transcript. Pairs the turn's
 * transcript assistant texts positionally with its streamed assistant markdown segments and
 * declines every ambiguous pairing. Never creates turns, segments, or non-text content.
 */
export function repairAssistantTurnText(
  snapshot: AcpTimelineSnapshot,
  input: { liveUserMessageId: string; transcriptTexts: string[] },
): AssistantTextRepairResult {
  const transcriptTexts = input.transcriptTexts.filter((text) => text.trim().length > 0);
  if (transcriptTexts.length === 0) {
    return { snapshot, outcome: emptyOutcome('no-transcript-text') };
  }

  const collected = collectTurnAssistantSegments(snapshot, input.liveUserMessageId);
  if (collected.status !== 'ok') {
    return { snapshot, outcome: emptyOutcome(collected.status, { transcriptTextCount: transcriptTexts.length }) };
  }
  const segments = collected.segments;
  if (segments.length === 0 || segments.length !== transcriptTexts.length) {
    return {
      snapshot,
      outcome: emptyOutcome(segments.length === 0 ? 'no-streamed-text' : 'segment-count-mismatch', {
        streamedSegmentCount: segments.length,
        transcriptTextCount: transcriptTexts.length,
      }),
    };
  }

  const itemsById: Record<string, typeof snapshot.itemsById[string]> = {};
  let repairedSegmentCount = 0;
  let declinedSegmentCount = 0;
  let recoveredCharacterCount = 0;
  let firstMismatchPrefix = 0;
  for (const [index, segment] of segments.entries()) {
    const transcriptText = transcriptTexts[index]!;
    const comparison = compareSegment(segment.text, transcriptText);
    if (comparison === 'match') continue;
    if (repairedSegmentCount + declinedSegmentCount === 0) {
      firstMismatchPrefix = sharedPrefixLength(segment.text, transcriptText);
    }
    if (comparison === 'decline') {
      declinedSegmentCount += 1;
      continue;
    }
    repairedSegmentCount += 1;
    recoveredCharacterCount += transcriptText.length - segment.text.length;
    itemsById[segment.itemId] = {
      ...segment.item,
      parts: segment.item.parts.map((part, partIndex) => (
        partIndex === segment.partIndex ? { kind: 'markdown', text: transcriptText } : part
      )),
    };
  }

  const outcome: AssistantTextRepairOutcome = {
    status: repairedSegmentCount > 0
      ? 'repaired'
      : declinedSegmentCount > 0 ? 'declined-shorter-transcript' : 'already-matching',
    repairedSegmentCount,
    declinedSegmentCount,
    streamedSegmentCount: segments.length,
    transcriptTextCount: transcriptTexts.length,
    recoveredCharacterCount,
    sharedPrefixLength: firstMismatchPrefix,
  };
  if (repairedSegmentCount === 0) return { snapshot, outcome };

  return {
    snapshot: { ...snapshot, itemsById: { ...snapshot.itemsById, ...itemsById } },
    outcome,
  };
}
