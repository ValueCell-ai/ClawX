import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

type ChatRuntimeEventType = ChatRuntimeEvent['type'];
type ChatRuntimeEventFor<T extends ChatRuntimeEventType> = Extract<ChatRuntimeEvent, { type: T }>;
type ChatRuntimeEventBaseFor<T extends ChatRuntimeEventType> = Pick<
  ChatRuntimeEventFor<T>,
  'type' | 'runId' | 'sessionKey' | 'seq' | 'ts'
>;

function withBase<T extends ChatRuntimeEventType>(
  type: T,
  payload: Record<string, unknown>,
): ChatRuntimeEventBaseFor<T> | null {
  const runId = readString(payload.runId);
  if (!runId) return null;
  return {
    type,
    runId,
    sessionKey: readString(payload.sessionKey),
    seq: readNumber(payload.seq),
    ts: readNumber(payload.ts),
  } as ChatRuntimeEventBaseFor<T>;
}

export function normalizeGatewayChatRuntimeEvent(payload: unknown): ChatRuntimeEvent | null {
  const raw = asRecord(payload);
  if (!raw) return null;

  const stream = readString(raw.stream);
  const data = asRecord(raw.data) ?? raw;

  if (stream === 'lifecycle') {
    const phase = readString(data.phase);
    if (phase === 'start') {
      const base = withBase('run.started', raw);
      return base
        ? {
            ...base,
            startedAt: readNumber(data.startedAt),
          }
        : null;
    }

    if (phase === 'completed' || phase === 'done' || phase === 'finished') {
      const base = withBase('run.ended', raw);
      return base
        ? {
            ...base,
            status: 'completed',
            endedAt: readNumber(data.endedAt),
            livenessState: readString(data.livenessState),
            replayInvalid: typeof data.replayInvalid === 'boolean' ? data.replayInvalid : undefined,
            stopReason: readString(data.stopReason),
          }
        : null;
    }

    if (phase === 'error' || phase === 'failed') {
      const base = withBase('run.ended', raw);
      return base
        ? {
            ...base,
            status: 'error',
            endedAt: readNumber(data.endedAt),
            error: readString(data.error),
            livenessState: readString(data.livenessState),
            replayInvalid: typeof data.replayInvalid === 'boolean' ? data.replayInvalid : undefined,
            stopReason: readString(data.stopReason),
          }
        : null;
    }

    if (phase === 'aborted' || phase === 'cancelled') {
      const base = withBase('run.ended', raw);
      return base
        ? {
            ...base,
            status: 'aborted',
            endedAt: readNumber(data.endedAt),
            error: readString(data.error),
            stopReason: readString(data.stopReason),
          }
        : null;
    }

    return null;
  }

  if (stream === 'assistant') {
    const base = withBase('assistant.delta', raw);
    return base
      ? {
          ...base,
          text: readString(data.text),
          delta: readString(data.delta),
          replace: typeof data.replace === 'boolean' ? data.replace : undefined,
          phase: readString(data.phase),
          mediaUrls: Array.isArray(data.mediaUrls)
            ? data.mediaUrls.filter((value): value is string => typeof value === 'string' && value.length > 0)
            : undefined,
        }
      : null;
  }

  if (stream === 'thinking') {
    const base = withBase('thinking.delta', raw);
    return base
      ? {
          ...base,
          text: readString(data.text),
          delta: readString(data.delta),
        }
      : null;
  }

  if (stream === 'tool') {
    const phase = readString(data.phase);
    const toolCallId = readString(data.toolCallId);
    const name = readString(data.name);
    if (!toolCallId || !name) return null;

    if (phase === 'start') {
      const base = withBase('tool.started', raw);
      return base ? { ...base, toolCallId, name, args: data.args } : null;
    }
    if (phase === 'update') {
      const base = withBase('tool.updated', raw);
      return base ? { ...base, toolCallId, name, partialResult: data.partialResult } : null;
    }
    if (phase === 'result' || phase === 'end') {
      const base = withBase('tool.completed', raw);
      return base
        ? {
            ...base,
            toolCallId,
            name,
            result: data.result,
            meta: data.meta,
            isError: typeof data.isError === 'boolean' ? data.isError : undefined,
          }
        : null;
    }
    return null;
  }

  if (stream === 'command_output') {
    const base = withBase('command.output', raw);
    return base
      ? {
          ...base,
          itemId: readString(data.itemId),
          toolCallId: readString(data.toolCallId),
          name: readString(data.name),
          title: readString(data.title),
          output: readString(data.output),
          status: readString(data.status),
          phase: readString(data.phase),
          exitCode: readNumber(data.exitCode),
          durationMs: readNumber(data.durationMs),
          cwd: readString(data.cwd),
        }
      : null;
  }

  if (stream === 'patch') {
    const base = withBase('patch.completed', raw);
    return base
      ? {
          ...base,
          itemId: readString(data.itemId),
          toolCallId: readString(data.toolCallId),
          name: readString(data.name),
          title: readString(data.title),
          summary: readString(data.summary),
          added: readNumber(data.added),
          modified: readNumber(data.modified),
          deleted: readNumber(data.deleted),
        }
      : null;
  }

  if (stream === 'approval') {
    const base = withBase('approval.updated', raw);
    return base
      ? {
          ...base,
          itemId: readString(data.itemId),
          toolCallId: readString(data.toolCallId),
          title: readString(data.title),
          kind: readString(data.kind),
          phase: readString(data.phase),
          status: readString(data.status),
          message: readString(data.message),
        }
      : null;
  }

  return null;
}
