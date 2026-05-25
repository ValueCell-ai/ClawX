import { loadSessionTranscriptFallback } from './history-transcript-fallback';
import {
  gatewayHistoryNeedsTranscriptHydration,
  mergeGatewayHistoryWithTranscript,
} from './history-transcript-merge';
import type { RawMessage } from './types';

export async function hydrateGatewayHistoryFromTranscript(
  sessionKey: string,
  gatewayMessages: RawMessage[],
  limit: number,
  localMessages?: RawMessage[],
): Promise<RawMessage[]> {
  if (!gatewayHistoryNeedsTranscriptHydration(gatewayMessages)) {
    return gatewayMessages;
  }

  const transcriptMessages = await loadSessionTranscriptFallback(sessionKey, limit);
  let merged = mergeGatewayHistoryWithTranscript(gatewayMessages, transcriptMessages);

  if (gatewayHistoryNeedsTranscriptHydration(merged) && localMessages?.length) {
    merged = mergeGatewayHistoryWithTranscript(merged, localMessages);
  }

  return merged;
}
