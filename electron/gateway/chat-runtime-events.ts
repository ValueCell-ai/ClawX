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

function readFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const next = readString(value);
    if (next) return next;
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length > 0 ? entries : undefined;
}

function readApprovalDecisions(value: unknown): Array<'allow-once' | 'allow-always' | 'deny'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const decisions = value.filter((entry): entry is 'allow-once' | 'allow-always' | 'deny' => (
    entry === 'allow-once' || entry === 'allow-always' || entry === 'deny'
  ));
  return decisions.length > 0 ? Array.from(new Set(decisions)) : undefined;
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

function approvalNotificationKind(method: string): 'exec' | 'plugin' | null {
  if (method.startsWith('exec.approval.')) return 'exec';
  if (method.startsWith('plugin.approval.')) return 'plugin';
  return null;
}

function approvalNotificationPhase(method: string): 'requested' | 'resolved' | null {
  if (method.endsWith('.requested')) return 'requested';
  if (method.endsWith('.resolved')) return 'resolved';
  return null;
}

function approvalResolvedStatus(decision: string | undefined): string {
  if (decision === 'deny' || decision === 'denied') return 'denied';
  if (decision === 'allow' || decision === 'allow-once' || decision === 'allow-always' || decision === 'approved') {
    return 'approved';
  }
  return 'failed';
}

function readCommandFromApprovalRequest(request: Record<string, unknown>): string | undefined {
  const command = readString(request.command);
  if (command) return command;

  const argv = readStringArray(request.commandArgv);
  if (argv) return argv.join(' ');

  const systemRunPlan = asRecord(request.systemRunPlan);
  return readFirstString(
    systemRunPlan?.commandText,
    systemRunPlan?.command,
  );
}

function readApprovalDetail(
  kind: 'exec' | 'plugin',
  raw: Record<string, unknown>,
  request: Record<string, unknown>,
): string | undefined {
  if (kind === 'exec') {
    return readFirstString(
      readCommandFromApprovalRequest(request),
      raw.detail,
      request.warningText,
      raw.message,
    );
  }

  return readFirstString(
    raw.detail,
    request.description,
    request.title,
    request.toolName,
    raw.message,
  );
}

export function normalizeGatewayChatRuntimeNotification(
  method: string,
  payload: unknown,
): ChatRuntimeEvent | null {
  const kind = approvalNotificationKind(method);
  const phase = approvalNotificationPhase(method);
  if (!kind || !phase) return null;

  const raw = asRecord(payload);
  if (!raw) return null;

  const request = asRecord(raw.request) ?? {};
  const approvalId = readFirstString(raw.id, raw.approvalId, raw.approval_id, request.id);
  if (!approvalId) return null;

  const decision = readString(raw.decision);
  const command = readCommandFromApprovalRequest(request);
  const detail = readApprovalDetail(kind, raw, request);

  return {
    type: 'approval.updated',
    runId: readFirstString(raw.runId, request.runId) ?? `approval:${approvalId}`,
    sessionKey: readFirstString(raw.sessionKey, request.sessionKey),
    seq: readNumber(raw.seq),
    ts: readNumber(raw.ts) ?? readNumber(raw.createdAtMs),
    approvalId,
    approvalSlug: readFirstString(raw.approvalSlug, raw.approval_slug, request.approvalSlug, request.approval_slug),
    itemId: readFirstString(raw.itemId, raw.item_id, request.itemId, request.item_id),
    toolCallId: readFirstString(raw.toolCallId, raw.tool_call_id, request.toolCallId, request.tool_call_id),
    title: readFirstString(raw.title, request.title),
    kind,
    phase,
    status: phase === 'requested'
      ? readFirstString(raw.status, request.status) ?? 'pending'
      : readFirstString(raw.status, request.status) ?? approvalResolvedStatus(decision),
    message: readFirstString(raw.message, request.message, request.warningText),
    detail,
    command,
    agentId: readFirstString(raw.agentId, request.agentId),
    expiresAtMs: readNumber(raw.expiresAtMs),
    allowedDecisions: readApprovalDecisions(raw.allowedDecisions) ?? readApprovalDecisions(request.allowedDecisions),
  };
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
          approvalId: readString(data.approvalId) ?? readString(data.approval_id),
          approvalSlug: readString(data.approvalSlug) ?? readString(data.approval_slug),
          itemId: readString(data.itemId) ?? readString(data.item_id),
          toolCallId: readString(data.toolCallId) ?? readString(data.tool_call_id),
          title: readString(data.title),
          kind: readString(data.kind),
          phase: readString(data.phase),
          status: readString(data.status),
          message: readString(data.message),
          detail: readString(data.detail),
          command: readString(data.command),
          agentId: readString(data.agentId) ?? readString(raw.agentId),
          expiresAtMs: readNumber(data.expiresAtMs),
          allowedDecisions: readApprovalDecisions(data.allowedDecisions),
        }
      : null;
  }

  return null;
}
