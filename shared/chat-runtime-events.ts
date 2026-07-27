export type ChatRuntimeEventBase = {
  runId: string;
  sessionKey?: string;
  seq?: number;
  ts?: number;
};

export type ChatRuntimeEvent =
  | (ChatRuntimeEventBase & {
      type: 'run.started';
      startedAt?: number;
    })
  | (ChatRuntimeEventBase & {
      type: 'run.ended';
      status: 'completed' | 'error' | 'aborted';
      endedAt?: number;
      error?: string;
      livenessState?: string;
      replayInvalid?: boolean;
      stopReason?: string;
    })
  | (ChatRuntimeEventBase & {
      type: 'assistant.delta';
      text?: string;
      delta?: string;
      replace?: boolean;
      phase?: string;
      mediaUrls?: string[];
    })
  | (ChatRuntimeEventBase & {
      type: 'thinking.delta';
      text?: string;
      delta?: string;
    })
  | (ChatRuntimeEventBase & {
      type: 'tool.started';
      toolCallId: string;
      name: string;
      args?: unknown;
    })
  | (ChatRuntimeEventBase & {
      type: 'tool.updated';
      toolCallId: string;
      name: string;
      partialResult?: unknown;
    })
  | (ChatRuntimeEventBase & {
      type: 'tool.completed';
      toolCallId: string;
      name: string;
      result?: unknown;
      meta?: unknown;
      isError?: boolean;
    })
  | (ChatRuntimeEventBase & {
      type: 'command.output';
      itemId?: string;
      toolCallId?: string;
      name?: string;
      title?: string;
      output?: string;
      status?: string;
      phase?: string;
      exitCode?: number;
      durationMs?: number;
      cwd?: string;
    })
  | (ChatRuntimeEventBase & {
      type: 'patch.completed';
      itemId?: string;
      toolCallId?: string;
      name?: string;
      title?: string;
      summary?: string;
      added?: number;
      modified?: number;
      deleted?: number;
    })
  | (ChatRuntimeEventBase & {
      type: 'approval.updated';
      itemId?: string;
      toolCallId?: string;
      title?: string;
      kind?: string;
      phase?: string;
      status?: string;
      message?: string;
    });
