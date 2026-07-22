import type { RawMessage } from '@shared/chat/types';
import type { ImageGenerationCompletionEvidence, ImageGenerationTaskStart } from './image-generation-compat';
import { extractImageGenerationTranscriptSupplement } from './image-generation-compat';
import { hostApi } from '../host-api';
import {
  alignOpenClawMediaTurns,
  alignOpenClawTranscriptTurns,
  extractOpenClawMediaTurns,
  selectOpenClawTranscriptBoundaryPredecessor,
  type OpenClawMediaTurnSupplement,
} from './openclaw-media-compat';
import type { AcpTimelineSnapshot } from './timeline-types';

export type CoordinatedImageGenerationTaskStart = ImageGenerationTaskStart & {
  acpTurnId?: string;
  beforeAcpTurnId?: string;
};

export type CoordinatedImageGenerationCompletion = ImageGenerationCompletionEvidence & {
  acpTurnId?: string;
  beforeAcpTurnId?: string;
  transcriptMessageId?: string;
};

export type CoordinatedImageGenerationSupplement = {
  starts: CoordinatedImageGenerationTaskStart[];
  completions: CoordinatedImageGenerationCompletion[];
};

export type TranscriptSupplementResult = {
  imageGeneration: CoordinatedImageGenerationSupplement;
  media: OpenClawMediaTurnSupplement[];
  transcriptMediaTurnCount: number;
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

  let response: Awaited<ReturnType<typeof hostApi.sessions.history>>;
  try {
    response = await hostApi.sessions.history({ sessionKey: input.sessionKey, limit: 1000 });
  } catch {
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
    return null;
  }

  if (!input.isCurrent()) {
    recordTrace(input, 'openclaw-media:projection-stale', {
      source: 'openclaw-media',
      reason: 'history-response-stale',
    });
    return null;
  }
  if (!response.success || !Array.isArray(response.messages)) {
    recordTrace(input, 'openclaw-media:history-request-failed', {
      source: 'openclaw-media',
      reason: 'invalid-response',
    });
    return null;
  }

  const messages = response.messages;
  const snapshot = typeof input.snapshot === 'function' ? input.snapshot() : input.snapshot;
  const alignedImageTurns = alignOpenClawTranscriptTurns(messages, snapshot, {
    ...(input.liveUserMessageId ? { liveUserMessageId: input.liveUserMessageId } : {}),
  });
  const sourceMessages = input.liveUserMessageId
    ? alignedImageTurns.length === 1 ? alignedImageTurns[0]!.messages : []
    : messages;
  const extractedImages = extractImageGenerationTranscriptSupplement(sourceMessages, input.sessionKey);
  const acpTurnIdByTaskId = new Map<string, string>();
  for (const turn of alignedImageTurns) {
    const extracted = extractImageGenerationTranscriptSupplement(turn.messages, input.sessionKey);
    for (const start of extracted.starts) acpTurnIdByTaskId.set(start.taskId, turn.acpTurnId);
  }
  const beforeAcpTurnIdByTaskId = new Map<string, string>();
  if (!input.liveUserMessageId) {
    const boundary = selectOpenClawTranscriptBoundaryPredecessor(messages, snapshot);
    if (
      boundary
      && ![...acpTurnIdByTaskId.values()].includes(boundary.beforeAcpTurnId)
    ) {
      const extracted = extractImageGenerationTranscriptSupplement(boundary.messages, input.sessionKey);
      for (const start of extracted.starts) {
        beforeAcpTurnIdByTaskId.set(start.taskId, boundary.beforeAcpTurnId);
      }
    }
  }
  const imageGeneration: CoordinatedImageGenerationSupplement = {
    starts: extractedImages.starts.map((start) => {
      const acpTurnId = acpTurnIdByTaskId.get(start.taskId);
      const beforeAcpTurnId = beforeAcpTurnIdByTaskId.get(start.taskId);
      return {
        ...start,
        ...(acpTurnId ? { acpTurnId } : {}),
        ...(beforeAcpTurnId ? { beforeAcpTurnId } : {}),
      };
    }),
    completions: extractedImages.completions.map((completion) => {
      const messageId = transcriptMessageId(completion, sourceMessages, input.sessionKey);
      const acpTurnId = completion.taskId ? acpTurnIdByTaskId.get(completion.taskId) : undefined;
      const beforeAcpTurnId = completion.taskId
        ? beforeAcpTurnIdByTaskId.get(completion.taskId)
        : undefined;
      return {
        ...completion,
        ...(acpTurnId ? { acpTurnId } : {}),
        ...(beforeAcpTurnId ? { beforeAcpTurnId } : {}),
        ...(messageId ? { transcriptMessageId: messageId } : {}),
      };
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

  return { imageGeneration, media, transcriptMediaTurnCount };
}
