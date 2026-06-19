import type { ToolCard } from './tool-cards';

export type ChatCoreClient = {
  request<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
};

export type RawOpenClawMessage = Record<string, unknown> & {
  id?: string;
  role?: string;
  content?: unknown;
  text?: string;
  timestamp?: number;
};

export type OpenClawAgentEvent = Record<string, unknown> & {
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  seq?: number;
  stream?: string;
  data?: Record<string, unknown>;
};

export type ChatRunUiStatus = {
  phase: 'idle' | 'running' | 'done' | 'interrupted' | 'error';
  runId?: string;
  sessionKey?: string;
  message?: string;
  endedAt?: number;
  stopReason?: string;
  livenessState?: string;
  replayInvalid?: boolean;
};

export type AssistantStreamPhase = 'commentary' | 'final_answer' | 'legacy';

export type LiveAssistantSegment = {
  id: string;
  runId: string;
  text: string;
  phase: AssistantStreamPhase;
  ts: number;
  order?: number;
  mediaUrls?: string[];
};

export type LiveThinkingSegment = {
  id: string;
  runId: string;
  text: string;
  ts: number;
  order?: number;
};

export type LiveToolEntry = {
  id: string;
  itemId?: string;
  toolId?: string;
  toolCallId?: string;
  callId?: string;
  runId: string;
  sessionKey?: string;
  name: string;
  title?: string;
  status?: string;
  args?: unknown;
  output?: string;
  isError?: boolean;
  errorText?: string;
  rawPayload?: Record<string, unknown>;
  identitySource?: 'explicit' | 'fallback';
  fingerprint?: string;
  commandOutputIds?: string[];
  patchSummaryIds?: string[];
  startedAt: number;
  updatedAt: number;
  order?: number;
};

export type CommandOutputEntry = {
  id: string;
  runId: string;
  itemId?: string;
  toolCallId?: string;
  toolId?: string;
  toolItemId?: string;
  callId?: string;
  parentId?: string;
  parentItemId?: string;
  name?: string;
  title?: string;
  command?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  status?: string;
  phase?: string;
  exitCode?: number;
  durationMs?: number;
  cwd?: string;
  rawPayload?: Record<string, unknown>;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  ts: number;
  order?: number;
};

export type PatchSummaryEntry = {
  id: string;
  runId: string;
  itemId?: string;
  toolCallId?: string;
  toolId?: string;
  toolItemId?: string;
  callId?: string;
  parentId?: string;
  parentItemId?: string;
  name?: string;
  title?: string;
  summary?: string;
  status?: string;
  filePaths?: string[];
  files?: string[];
  fileCount?: number;
  added?: number;
  modified?: number;
  deleted?: number;
  rawPayload?: Record<string, unknown>;
  ts: number;
  order?: number;
};

export type ChatQueueItem = {
  id: string;
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  createdAt?: number;
  historyMessageCountAtEnqueue?: number;
  attachments?: ChatQueueAttachment[];
  state: 'queued' | 'sending' | 'waiting-reconnect' | 'failed';
  error?: string;
};

export type ChatQueueAttachment = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  filePath?: string;
  source?: 'user-upload' | 'tool-result' | 'message-ref' | 'gateway-media';
  gatewayUrl?: string;
};

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type ApprovalStatus = 'pending' | 'unavailable' | 'approved' | 'denied' | 'failed';

export type ApprovalRequest = {
  id: string;
  kind: 'exec' | 'plugin' | 'unknown';
  status: ApprovalStatus;
  title: string;
  detail: string;
  approvalId?: string;
  approvalSlug?: string;
  itemId?: string;
  toolCallId?: string;
  message?: string;
  sessionKey?: string;
  agentId?: string;
  expiresAtMs?: number;
  allowedDecisions?: ApprovalDecision[];
};

export type CompactionStatus = {
  phase: 'active' | 'retrying' | 'complete' | 'error';
  message?: string;
};

export type FallbackStatus = {
  phase: 'active' | 'cleared' | 'error';
  message?: string;
};

export type RuntimeIndicatorStatus =
  | ({ kind: 'compaction' } & CompactionStatus)
  | ({ kind: 'fallback' } & FallbackStatus);

export type VisibleChatItem =
  | { kind: 'message'; id: string; message: RawOpenClawMessage }
  | {
    kind: 'stream';
    id: string;
    runId: string;
    text: string;
    phase: AssistantStreamPhase;
    mediaUrls?: string[];
  }
  | { kind: 'thinking'; id: string; runId: string; text: string }
  | { kind: 'tool'; id: string; runId: string; toolCallId?: string; tool: ToolCard; status: ChatRunUiStatus }
  | { kind: 'command'; id: string; command: CommandOutputEntry; status: ChatRunUiStatus }
  | { kind: 'patch'; id: string; patch: PatchSummaryEntry; status: ChatRunUiStatus }
  | { kind: 'queue'; id: string; item: ChatQueueItem }
  | { kind: 'runtime'; id: string; status: RuntimeIndicatorStatus }
  | { kind: 'approval'; id: string; approval: ApprovalRequest }
  | { kind: 'status'; id: string; status: ChatRunUiStatus };

export type ChatCoreState = {
  sessionKey: string;
  selectedAgentId?: string;
  currentSessionId?: string;
  history: {
    messages: RawOpenClawMessage[];
    loading: boolean;
    hasMore: boolean;
    requestVersion: number;
  };
  live: {
    runId: string | null;
    currentAssistant: LiveAssistantSegment | null;
    assistantSegments: LiveAssistantSegment[];
    currentThinking: LiveThinkingSegment | null;
    thinkingSegments: LiveThinkingSegment[];
    toolMessages: RawOpenClawMessage[];
    toolStreamById: Record<string, LiveToolEntry>;
    toolStreamOrder: string[];
    commandOutputs: CommandOutputEntry[];
    patchSummaries: PatchSummaryEntry[];
  };
  send: {
    sending: boolean;
    queue: ChatQueueItem[];
    activeRunId: string | null;
    canAbort: boolean;
    lastError: string | null;
    abortedRunIds: string[];
  };
  runtime: {
    runStatus: ChatRunUiStatus | null;
    compactionStatus: CompactionStatus | null;
    fallbackStatus: FallbackStatus | null;
    approvals: ApprovalRequest[];
    resolvedApprovalIds: string[];
  };
};
