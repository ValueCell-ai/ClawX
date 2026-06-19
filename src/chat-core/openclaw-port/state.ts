import type { ChatCoreState } from './types';

export function createInitialChatCoreState(input: {
  sessionKey: string;
  selectedAgentId?: string;
}): ChatCoreState {
  return {
    sessionKey: input.sessionKey,
    ...(input.selectedAgentId ? { selectedAgentId: input.selectedAgentId } : {}),
    history: {
      messages: [],
      loading: false,
      hasMore: false,
      requestVersion: 0,
    },
    live: {
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
    },
    send: {
      sending: false,
      queue: [],
      activeRunId: null,
      canAbort: false,
      lastError: null,
      abortedRunIds: [],
    },
    runtime: {
      runStatus: null,
      compactionStatus: null,
      fallbackStatus: null,
      approvals: [],
      resolvedApprovalIds: [],
    },
  };
}
