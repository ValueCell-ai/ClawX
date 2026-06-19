import { hostEvents } from '@/lib/host-events';
import { actionsFromAgentEvent } from '@/chat-core/openclaw-port/events';
import type { ChatCoreAction } from '@/chat-core/openclaw-port/actions';
import { extractMessageText } from '@/chat-core/openclaw-port/history';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type {
  ChatRunUiStatus,
  OpenClawAgentEvent,
  RawOpenClawMessage,
} from '@/chat-core/openclaw-port/types';

type Dispatch = (action: ChatCoreAction) => void;

function normalizeChatMessagePayload(payload: Record<string, unknown>): ChatCoreAction | null {
  const state = typeof payload.state === 'string' ? payload.state : undefined;
  const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
  const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined;
  const message = payload.message as RawOpenClawMessage | undefined;
  const messageText = extractMessageText(message ?? {});
  const deltaText = typeof payload.deltaText === 'string' ? payload.deltaText : undefined;
  const replace = payload.replace === true;
  if (!state || !runId) return null;

  if (state === 'delta') {
    const hasMessageText = messageText.trim().length > 0;
    const hasDeltaText = deltaText !== undefined;
    const text = hasMessageText ? messageText : deltaText ?? '';
    return {
      type: 'chat.delta',
      sessionKey,
      runId,
      text,
      mode: hasMessageText || replace ? 'replace' : hasDeltaText ? 'append' : 'replace',
      ts: Date.now(),
    };
  }
  if (state === 'final') return { type: 'chat.final', sessionKey, runId };
  if (state === 'error') {
    return {
      type: 'chat.error',
      sessionKey,
      runId,
      error: typeof payload.errorMessage === 'string' ? payload.errorMessage : 'Chat run failed',
    };
  }
  if (state === 'aborted') {
    return { type: 'chat.error', sessionKey, runId, error: 'aborted' };
  }
  return null;
}

function actionsFromChatRuntimeEvent(event: ChatRuntimeEvent): ChatCoreAction[] {
  if (event.type === 'run.started') {
    return [{
      type: 'run.status',
      ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
      status: {
        phase: 'running',
        runId: event.runId,
        ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
      },
    }];
  }

  if (event.type === 'run.ended') {
    const phase: ChatRunUiStatus['phase'] = event.status === 'aborted'
      ? 'interrupted'
      : event.status === 'error'
        ? 'error'
        : 'done';

    return [{
      type: 'run.status',
      ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
      status: {
        phase,
        runId: event.runId,
        ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
        ...(event.error ? { message: event.error } : {}),
        ...(event.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
        ...(event.livenessState ? { livenessState: event.livenessState } : {}),
        ...(event.replayInvalid !== undefined ? { replayInvalid: event.replayInvalid } : {}),
      },
    }];
  }

  if (event.type !== 'approval.updated') return [];

  return actionsFromAgentEvent({
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    runId: event.runId,
    seq: event.seq,
    stream: 'approval',
    ts: event.ts,
    data: {
      approvalId: event.approvalId,
      approvalSlug: event.approvalSlug,
      itemId: event.itemId,
      toolCallId: event.toolCallId,
      title: event.title,
      kind: event.kind,
      phase: event.phase,
      status: event.status,
      message: event.message,
      detail: event.detail,
      command: event.command,
      agentId: event.agentId,
      expiresAtMs: event.expiresAtMs,
      allowedDecisions: event.allowedDecisions,
    },
  });
}

export function subscribeOpenClawChatHostEvents(dispatch: Dispatch): () => void {
  const cleanups = [
    hostEvents.onGatewayChatMessage((payload) => {
      const action = normalizeChatMessagePayload(payload as Record<string, unknown>);
      if (action) dispatch(action);
    }),
    hostEvents.onGatewayAgentEvent((payload) => {
      for (const action of actionsFromAgentEvent(payload as OpenClawAgentEvent)) {
        dispatch(action);
      }
    }),
    hostEvents.onChatRuntimeEvent((payload) => {
      for (const action of actionsFromChatRuntimeEvent(payload as ChatRuntimeEvent)) {
        dispatch(action);
      }
    }),
  ];

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
