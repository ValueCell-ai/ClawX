import type {
  AssistantStreamPhase,
  ApprovalRequest,
  CommandOutputEntry,
  CompactionStatus,
  FallbackStatus,
  ChatQueueItem,
  ChatRunUiStatus,
  LiveToolEntry,
  OpenClawAgentEvent,
  PatchSummaryEntry,
  RawOpenClawMessage,
} from './types';

export type ToolStreamActionPayload = Omit<
  LiveToolEntry,
  'commandOutputIds' | 'patchSummaryIds' | 'order'
>;

export type CommandOutputActionPayload = Omit<CommandOutputEntry, 'order'>;
export type PatchSummaryActionPayload = Omit<PatchSummaryEntry, 'order'>;

export type ChatCoreAction =
  | { type: 'session.changed'; sessionKey: string; selectedAgentId?: string }
  | { type: 'history.requested'; sessionKey: string; requestVersion: number }
  | {
    type: 'history.loaded';
    sessionKey: string;
    requestVersion: number;
    messages: RawOpenClawMessage[];
    hasMore: boolean;
  }
  | { type: 'send.enqueued'; item: ChatQueueItem }
  | { type: 'send.acked'; id: string; runId: string }
  | { type: 'send.aborted'; sessionKey?: string; runId?: string | null }
  | { type: 'send.failed'; id: string; error: string; recoverable: boolean }
  | {
    type: 'assistant.delta';
    sessionKey?: string;
    runId: string;
    text: string;
    phase: AssistantStreamPhase;
    ts: number;
    mediaUrls?: string[];
    mode?: 'replace' | 'append';
  }
  | { type: 'thinking.delta'; sessionKey?: string; runId: string; text: string; ts: number; mode?: 'replace' | 'append' }
  | { type: 'chat.delta'; sessionKey?: string; runId: string; text: string; ts: number; mode?: 'replace' | 'append' }
  | { type: 'chat.final'; sessionKey?: string; runId: string }
  | { type: 'chat.error'; sessionKey?: string; runId?: string; error: string }
  | { type: 'agent.event'; event: OpenClawAgentEvent }
  | { type: 'tool.started'; sessionKey?: string; tool: ToolStreamActionPayload }
  | { type: 'tool.updated'; sessionKey?: string; tool: ToolStreamActionPayload }
  | { type: 'tool.completed'; sessionKey?: string; tool: ToolStreamActionPayload }
  | { type: 'command.output'; sessionKey?: string; output: CommandOutputActionPayload }
  | { type: 'patch.completed'; sessionKey?: string; patch: PatchSummaryActionPayload }
  | { type: 'run.status'; sessionKey?: string; status: ChatRunUiStatus | null }
  | { type: 'runtime.compaction'; sessionKey?: string; status: CompactionStatus | null }
  | { type: 'runtime.fallback'; sessionKey?: string; status: FallbackStatus | null }
  | { type: 'approval.upserted'; approval: ApprovalRequest }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  | { type: 'approval.resolved'; sessionKey?: string; ids: string[] };
