import type { RawMessage } from '@shared/chat/types';
import type { SessionTurnTimingCandidate } from '@shared/host-api/contract';
import type { ImageGenerationCompletionEvidence, ImageGenerationTranscriptSupplement } from './image-generation-compat';
import { extractImageGenerationTranscriptSupplement } from './image-generation-compat';
import { hostApi } from '../host-api';
import {
  alignOpenClawMediaTurns,
  extractOpenClawMediaTurns,
  selectOpenClawTranscriptTurn,
  type OpenClawMediaTurnSupplement,
} from './openclaw-media-compat';
import type { AcpTimelineSnapshot } from './timeline-types';

export type CoordinatedImageGenerationCompletion = ImageGenerationCompletionEvidence & {
  transcriptMessageId?: string;
};

export type CoordinatedImageGenerationSupplement = Omit<ImageGenerationTranscriptSupplement, 'completions'> & {
  completions: CoordinatedImageGenerationCompletion[];
};

export type TranscriptSupplementResult = {
  imageGeneration: CoordinatedImageGenerationSupplement;
  media: OpenClawMediaTurnSupplement[];
  transcriptMediaTurnCount: number;
  turnTimings: SessionTurnTimingCandidate[];
};

type TranscriptSupplementInput = {
  sessionKey: string;
  generation: number;
  executionCwd: string;
  snapshot: AcpTimelineSnapshot | (() => AcpTimelineSnapshot);
  liveUserMessageId?: string;
  isCurrent: () => boolean;
};

function recordTrace(input: TranscriptSupplementInput, event: string, details: Record<string, unknown>): void {
  void hostApi.diagnostics.recordAcpTrace({
    event,
    direction: 'projection',
    sessionKey: input.sessionKey,
    generation: input.generation,
    details,
  }).catch(() => undefined);
}

function transcriptMessageId(
  completion: ImageGenerationCompletionEvidence,
  messages: RawMessage[],
  sessionKey: string,
): string | undefined {
  if (completion.source !== 'transcript-history') return undefined;
  const prefix = `transcript:${sessionKey}:`;
  return messages
    .filter((message): message is RawMessage & { id: string } => typeof message.id === 'string' && message.id.length > 0)
    .sort((left, right) => right.id.length - left.id.length)
    .find((message) => completion.evidenceId.startsWith(`${prefix}${message.id}:`))
    ?.id;
}

// OpenClaw ACP currently projects only assistant text/thought content and strips MEDIA
// directives from the visible reply. This bounded transcript read recovers only missing
// resource blocks; it is not a second Chat history source. Remove it when distributed
// OpenClaw ACP emits assistant resource_link/resource content. Architecture rationale:
// harness/reference/acp-generated-media-and-diagnostics.md
export async function fetchOpenClawTranscriptSupplement(
  input: TranscriptSupplementInput,
): Promise<TranscriptSupplementResult | null> {
  recordTrace(input, 'openclaw-media:history-request-started', {
    source: 'openclaw-media',
    reason: input.liveUserMessageId ? 'live' : 'historical',
  });

  const [historyResult, timingResult] = await Promise.allSettled([
    hostApi.sessions.history({ sessionKey: input.sessionKey, limit: 1000 }),
    input.liveUserMessageId
      ? Promise.resolve(null)
      : hostApi.sessions.turnTimings({ sessionKey: input.sessionKey, limit: 1000 }),
  ]);
  const response = historyResult.status === 'fulfilled' ? historyResult.value : null;
  const timingResponse = timingResult.status === 'fulfilled' ? timingResult.value : null;
  const turnTimings = timingResponse?.success && Array.isArray(timingResponse.timings)
    ? timingResponse.timings
    : [];
  if (!response?.success || !Array.isArray(response.messages)) {
    if (input.isCurrent()) {
      recordTrace(input, 'openclaw-media:history-request-failed', {
        source: 'openclaw-media',
        reason: 'request-failed',
      });
    } else {
      recordTrace(input, 'openclaw-media:projection-stale', {
        source: 'openclaw-media',
        reason: 'history-failure-stale',
      });
    }
    if (turnTimings.length === 0 || !input.isCurrent()) return null;
  }

  if (!input.isCurrent()) {
    recordTrace(input, 'openclaw-media:projection-stale', {
      source: 'openclaw-media',
      reason: 'history-response-stale',
    });
    return null;
  }
  const messages = response?.success && Array.isArray(response.messages) ? response.messages : [];
  const snapshot = typeof input.snapshot === 'function' ? input.snapshot() : input.snapshot;
  const imageMessages = input.liveUserMessageId
    ? selectOpenClawTranscriptTurn(messages, snapshot, input.liveUserMessageId)
    : messages;
  const extractedImages = extractImageGenerationTranscriptSupplement(imageMessages, input.sessionKey);
  const imageGeneration: CoordinatedImageGenerationSupplement = {
    starts: extractedImages.starts,
    completions: extractedImages.completions.map((completion) => {
      const messageId = transcriptMessageId(completion, imageMessages, input.sessionKey);
      return { ...completion, ...(messageId ? { transcriptMessageId: messageId } : {}) };
    }),
  };
  const suppressedUris = new Set(
    imageGeneration.completions.flatMap((completion) => completion.candidates.map((candidate) => candidate.key)),
  );
  const transcriptMediaTurns = extractOpenClawMediaTurns(messages, {
    executionCwd: input.executionCwd,
    suppressedUris,
  });
  const media = alignOpenClawMediaTurns(snapshot, transcriptMediaTurns, {
    ...(input.liveUserMessageId ? { liveUserMessageId: input.liveUserMessageId } : {}),
  });
  const transcriptMediaTurnCount = transcriptMediaTurns.filter((turn) => turn.candidates.length > 0).length;

  recordTrace(input, 'openclaw-media:history-request-succeeded', {
    source: 'openclaw-media',
    candidateCount: transcriptMediaTurns.reduce((count, turn) => count + turn.candidates.length, 0),
    matchedCount: media.length,
    rejectedCount: Math.max(0, transcriptMediaTurnCount - media.length),
  });
  if (transcriptMediaTurnCount > media.length) {
    recordTrace(input, 'openclaw-media:turn-rejected', {
      source: 'openclaw-media',
      reason: 'unmatched-user-anchor',
      rejectedCount: transcriptMediaTurnCount - media.length,
    });
  }
  for (const supplement of media) {
    recordTrace(input, 'openclaw-media:turn-matched', {
      source: 'openclaw-media',
      reason: input.liveUserMessageId ? 'live-user-identity' : 'reverse-user-occurrence',
      candidateCount: supplement.candidates.length,
    });
  }

  return { imageGeneration, media, transcriptMediaTurnCount, turnTimings };
}
