/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */

import type { ChatCoreAction } from './actions';
import type { AssistantStreamPhase, ChatRunUiStatus, OpenClawAgentEvent } from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function eventData(event: OpenClawAgentEvent): Record<string, unknown> {
  return asRecord(event.data) ?? {};
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanField(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key];
  return typeof value === 'boolean' ? value : undefined;
}

function stringArrayField(data: Record<string, unknown>, key: string): string[] | undefined {
  const value = data[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => (
    typeof item === 'string' && item.trim().length > 0
  ));
  return strings.length > 0 ? strings : undefined;
}

function mediaUrlsField(data: Record<string, unknown>): string[] | undefined {
  const urls = [
    stringField(data, 'mediaUrl'),
    ...(stringArrayField(data, 'mediaUrls') ?? []),
  ].filter((url): url is string => typeof url === 'string');
  const uniqueUrls = Array.from(new Set(urls));
  return uniqueUrls.length > 0 ? uniqueUrls : undefined;
}

function firstStringArrayField(data: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = stringArrayField(data, key);
    if (value) return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value)) {
      const nested = firstString(value);
      if (nested) return nested;
    }
  }
  return undefined;
}

function firstNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberField(data, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstValue(data: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
  }
  return undefined;
}

function firstStringField(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(data, key);
    if (value) return value;
  }
  return undefined;
}

function serializeEventValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function serializedField(data: Record<string, unknown>, keys: string[]): string | undefined {
  return serializeEventValue(firstValue(data, keys));
}

function firstThinkingContent(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstThinkingContent(item);
      if (nested) return nested;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  return firstStringField(record, [
    'thinking',
    'reasoning',
    'reasoningText',
    'reasoning_text',
    'reasoningContent',
    'reasoning_content',
    'summary',
    'summaryText',
    'summary_text',
    'text',
    'content',
  ]);
}

function normalizeKind(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[_-]/g, '').toLowerCase() : '';
}

function firstReasoningContent(value: unknown, acceptBareString = false): string | undefined {
  if (typeof value === 'string' && value.trim()) return acceptBareString ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstReasoningContent(item);
      if (nested) return nested;
    }
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;

  const reasoningKeys = [
    'thinking',
    'reasoning',
    'reasoningText',
    'reasoning_text',
    'reasoningContent',
    'reasoning_content',
    'summary',
    'summaryText',
    'summary_text',
  ];
  const direct = firstStringField(record, reasoningKeys);
  if (direct) return direct;
  for (const key of reasoningKeys) {
    const nested = firstReasoningContent(record[key], true);
    if (nested) return nested;
  }

  const kind = normalizeKind(record.type);
  if (
    (kind === 'thinking' || kind === 'reasoning' || kind === 'reasoningcontent')
    && typeof record.text === 'string'
    && record.text.trim()
  ) {
    return record.text;
  }

  for (const key of [
    'delta',
    'deltaContent',
    'delta_content',
    'thinkingDelta',
    'thinking_delta',
    'reasoningDelta',
    'reasoning_delta',
    'content',
    'message',
    'payload',
  ]) {
    const nested = firstReasoningContent(record[key]);
    if (nested) return nested;
  }

  return undefined;
}

function debugMissingThinkingText(
  event: OpenClawAgentEvent,
  data: Record<string, unknown>,
): void {
  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  if (!env?.DEV) return;
  console.debug('[ClawX Chat] thinking event had no displayable text', {
    stream: event.stream,
    runId: event.runId,
    keys: Object.keys(data),
  });
}

function reasoningTokensForEventData(data: Record<string, unknown>): number | undefined {
  const direct = firstNumber(data, ['reasoningTokens', 'reasoning_tokens']);
  if (direct !== undefined) return direct;
  const usage = asRecord(data.usage);
  return usage ? firstNumber(usage, ['reasoningTokens', 'reasoning_tokens']) : undefined;
}

function debugMissingAssistantReasoningText(
  event: OpenClawAgentEvent,
  data: Record<string, unknown>,
): void {
  const reasoningTokens = reasoningTokensForEventData(data);
  if (!reasoningTokens) return;
  const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
  if (!env?.DEV) return;
  console.debug('[ClawX Chat] assistant event has reasoning tokens but no displayable thinking', {
    stream: event.stream,
    runId: event.runId,
    reasoningTokens,
    keys: Object.keys(data),
  });
}

function compactCandidateIds(values: Array<unknown>): string[] {
  return values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  ));
}

function toolCallIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['toolCallId', 'tool_call_id', 'toolUseId', 'tool_use_id']);
}

function callIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['callId', 'call_id']);
}

function itemIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['itemId', 'item_id']);
}

function toolIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['toolId', 'tool_id']);
}

function toolItemIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['toolItemId', 'tool_item_id']);
}

function parentIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['parentId', 'parent_id', 'parentToolId', 'parent_tool_id']);
}

function parentItemIdField(data: Record<string, unknown>): string | undefined {
  return firstStringField(data, ['parentItemId', 'parent_item_id', 'parentToolItemId', 'parent_tool_item_id']);
}

function timestampField(data: Record<string, unknown>, keys: string[]): number | undefined {
  return firstNumber(data, keys);
}

let fallbackToolIdCounter = 0;
let fallbackStreamEntryIdCounter = 0;

function stableStreamEntryId(
  prefix: string,
  event: OpenClawAgentEvent,
  data: Record<string, unknown>,
  ts: number,
): string {
  const explicitId = stringField(data, 'id');
  if (explicitId) return `${prefix}:${explicitId}`;
  const itemId = itemIdField(data);
  if (itemId) return `${prefix}:${itemId}`;
  const eventPart = event.seq
    ?? `${numberField(event, 'ts') ?? ts}:${++fallbackStreamEntryIdCounter}`;
  return `${prefix}:${event.runId ?? 'event'}:${eventPart}`;
}

function stableToolIdentity(
  event: OpenClawAgentEvent,
  data: Record<string, unknown>,
  ts: number,
): { id: string; identitySource: 'explicit' | 'fallback' } {
  const explicitId = firstStringField(data, ['id'])
    ?? itemIdField(data)
    ?? toolIdField(data)
    ?? toolCallIdField(data)
    ?? callIdField(data);
  if (explicitId) return { id: explicitId, identitySource: 'explicit' };

  const eventPart = event.seq !== undefined
    ? event.seq
    : `${numberField(event, 'ts') ?? ts}:${++fallbackToolIdCounter}`;
  return {
    id: `tool:${event.runId ?? 'event'}:${eventPart}`,
    identitySource: 'fallback',
  };
}

function toolFingerprint(data: Record<string, unknown>): string {
  const fingerprint = {
    name: firstStringField(data, ['name', 'toolName', 'tool_name']) ?? 'tool',
    title: stringField(data, 'title') ?? null,
    args: firstValue(data, ['args', 'arguments', 'input']) ?? null,
  };
  try {
    return JSON.stringify(fingerprint);
  } catch {
    return `${fingerprint.name}:${fingerprint.title ?? ''}:${String(fingerprint.args)}`;
  }
}

function approvalIds(event: OpenClawAgentEvent, data: Record<string, unknown>): string[] {
  return compactCandidateIds([
    data.approvalId,
    data.approval_id,
    data.approvalSlug,
    data.approval_slug,
    data.id,
    data.itemId,
    data.item_id,
    data.toolCallId,
    data.tool_call_id,
    event.runId,
  ]);
}

function approvalDecisions(value: unknown): Array<'allow-once' | 'allow-always' | 'deny'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const decisions = value.filter((entry): entry is 'allow-once' | 'allow-always' | 'deny' => (
    entry === 'allow-once' || entry === 'allow-always' || entry === 'deny'
  ));
  return decisions.length > 0 ? Array.from(new Set(decisions)) : undefined;
}

function normalizeAssistantPhase(value: string | undefined): AssistantStreamPhase {
  if (value === 'commentary' || value === 'final_answer') return value;
  return 'legacy';
}

function lifecycleMetadata(data: Record<string, unknown>): Partial<ChatRunUiStatus> {
  const endedAt = numberField(data, 'endedAt');
  const stopReason = stringField(data, 'stopReason');
  const livenessState = stringField(data, 'livenessState');
  const replayInvalid = booleanField(data, 'replayInvalid');

  return {
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(livenessState ? { livenessState } : {}),
    ...(replayInvalid !== undefined ? { replayInvalid } : {}),
  };
}

function fallbackStepStatus(data: Record<string, unknown>): { phase: 'active' | 'cleared' | 'error'; message?: string } {
  const outcome = stringField(data, 'fallbackStepFinalOutcome');
  const fromModel = stringField(data, 'fallbackStepFromModel');
  const toModel = stringField(data, 'fallbackStepToModel');
  const prefix = fromModel && toModel
    ? `${fromModel} -> ${toModel}`
    : toModel ?? fromModel;
  const detail = firstString([
    data.fallbackStepFromFailureDetail,
    data.fallbackStepFromFailureReason,
    data.message,
    data.reason,
  ]);
  const message = prefix && detail
    ? `${prefix}: ${detail}`
    : prefix ?? detail;

  return {
    phase: outcome === 'chain_exhausted'
      ? 'error'
      : outcome === 'succeeded'
        ? 'cleared'
        : 'active',
    ...(message ? { message } : {}),
  };
}

function sessionOperationPayload(
  event: OpenClawAgentEvent,
  data: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (event.stream !== 'session.operation' && event.event !== 'session.operation') {
    return undefined;
  }

  return asRecord(event.payload)
    ?? (Object.keys(data).length > 0 ? data : event);
}

function runStatusAction(
  event: OpenClawAgentEvent,
  status: ChatRunUiStatus,
): ChatCoreAction {
  return {
    type: 'run.status',
    ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
    status: {
      ...status,
      ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
    },
  };
}

export function actionsFromAgentEvent(event: OpenClawAgentEvent): ChatCoreAction[] {
  const actions: ChatCoreAction[] = [{ type: 'agent.event', event }];
  const data = eventData(event);
  const phase = stringField(data, 'phase');

  if (event.stream === 'assistant' && event.runId) {
    const text = stringField(data, 'text');
    const delta = stringField(data, 'delta');
    const replace = booleanField(data, 'replace') === true;
    const visibleText = text ?? delta;
    const mediaUrls = mediaUrlsField(data);
    const reasoningText = firstReasoningContent(data);
    if (visibleText || mediaUrls?.length) {
      actions.push({
        type: 'assistant.delta',
        sessionKey: event.sessionKey,
        runId: event.runId,
        text: visibleText ?? '',
        phase: normalizeAssistantPhase(phase),
        ...(mediaUrls ? { mediaUrls } : {}),
        mode: text || replace ? 'replace' : 'append',
        ts: numberField(event, 'ts') ?? Date.now(),
      });
    }
    if (reasoningText) {
      actions.push({
        type: 'thinking.delta',
        sessionKey: event.sessionKey,
        runId: event.runId,
        text: reasoningText,
        mode: 'replace',
        ts: numberField(event, 'ts') ?? Date.now(),
      });
    } else {
      debugMissingAssistantReasoningText(event, data);
    }
  }

  if ((event.stream === 'thinking' || event.stream === 'plan' || event.stream === 'reasoning') && event.runId) {
    const text = firstStringField(data, [
      'text',
      'thinking',
      'reasoning',
      'reasoningText',
      'reasoning_text',
      'reasoningContent',
      'reasoning_content',
      'content',
    ])
      ?? firstThinkingContent(firstValue(data, ['content', 'message', 'payload']));
    const delta = firstStringField(data, [
      'delta',
      'deltaContent',
      'delta_content',
      'thinkingDelta',
      'thinking_delta',
      'reasoningDelta',
      'reasoning_delta',
    ])
      ?? firstThinkingContent(firstValue(data, [
        'delta',
        'deltaContent',
        'delta_content',
        'thinkingDelta',
        'thinking_delta',
        'reasoningDelta',
        'reasoning_delta',
      ]));
    const replace = booleanField(data, 'replace') === true;
    const visibleText = text ?? delta;
    if (visibleText) {
      actions.push({
        type: 'thinking.delta',
        sessionKey: event.sessionKey,
        runId: event.runId,
        text: visibleText,
        mode: text || replace ? 'replace' : 'append',
        ts: numberField(event, 'ts') ?? Date.now(),
      });
    } else {
      debugMissingThinkingText(event, data);
    }
  }

  if (event.stream === 'tool' && event.runId) {
    const toolCallId = toolCallIdField(data);
    const ts = numberField(event, 'ts') ?? Date.now();
    const identity = stableToolIdentity(event, data, ts);
    if (identity.id) {
      const normalizedPhase = phase?.toLowerCase();
      const callId = callIdField(data);
      const itemId = itemIdField(data);
      const explicitToolId = toolIdField(data);
      const output = serializedField(data, ['output', 'result', 'partialResult', 'partial_result']);
      const errorText = firstStringField(data, ['error', 'errorText', 'error_text', 'errorExcerpt', 'error_excerpt', 'message']);
      const tool = {
        id: identity.id,
        ...(itemId ? { itemId } : {}),
        ...(explicitToolId ? { toolId: explicitToolId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(callId && callId !== toolCallId ? { callId } : {}),
        runId: event.runId,
        sessionKey: event.sessionKey,
        name: firstStringField(data, ['name', 'toolName', 'tool_name']) ?? 'tool',
        ...(stringField(data, 'title') ? { title: stringField(data, 'title') } : {}),
        status: stringField(data, 'status') ?? normalizedPhase,
        args: firstValue(data, ['args', 'arguments', 'input']),
        ...(output !== undefined ? { output } : {}),
        ...(booleanField(data, 'isError') !== undefined ? { isError: booleanField(data, 'isError') } : {}),
        ...(booleanField(data, 'is_error') !== undefined ? { isError: booleanField(data, 'is_error') } : {}),
        ...(errorText ? { errorText } : {}),
        rawPayload: data,
        identitySource: identity.identitySource,
        fingerprint: toolFingerprint(data),
        startedAt: timestampField(data, ['startedAt', 'started_at', 'startTime', 'start_time']) ?? ts,
        updatedAt: timestampField(data, ['updatedAt', 'updated_at', 'updatedTime', 'updated_time']) ?? ts,
      };

      if (normalizedPhase === 'start' || normalizedPhase === 'started' || normalizedPhase === 'begin') {
        actions.push({ type: 'tool.started', sessionKey: event.sessionKey, tool });
      } else if (
        normalizedPhase === 'result'
        || normalizedPhase === 'end'
        || normalizedPhase === 'completed'
        || normalizedPhase === 'done'
        || normalizedPhase === 'finished'
      ) {
        actions.push({ type: 'tool.completed', sessionKey: event.sessionKey, tool });
      } else if (
        normalizedPhase === 'update'
        || normalizedPhase === 'updated'
        || normalizedPhase === 'delta'
        || normalizedPhase === 'partial'
        || output !== undefined
      ) {
        actions.push({ type: 'tool.updated', sessionKey: event.sessionKey, tool });
      }
    }
  }

  if (event.stream === 'command_output' && event.runId) {
    const ts = numberField(event, 'ts') ?? Date.now();
    const toolCallId = toolCallIdField(data);
    const itemId = itemIdField(data);
    const toolId = toolIdField(data);
    const toolItemId = toolItemIdField(data);
    const callId = callIdField(data);
    const parentId = parentIdField(data);
    const parentItemId = parentItemIdField(data);
    const command = firstStringField(data, ['command', 'cmd', 'commandText', 'command_text']);
    const stdout = serializedField(data, ['stdout']);
    const stderr = serializedField(data, ['stderr']);
    const stdoutExcerpt = serializedField(data, ['stdoutExcerpt', 'stdout_excerpt']);
    const stderrExcerpt = serializedField(data, ['stderrExcerpt', 'stderr_excerpt']);
    const output = serializedField(data, ['output', 'text', 'content'])
      ?? stdout
      ?? stdoutExcerpt
      ?? stderr
      ?? stderrExcerpt;
    actions.push({
      type: 'command.output',
      sessionKey: event.sessionKey,
      output: {
        id: stableStreamEntryId('command', event, data, ts),
        runId: event.runId,
        ...(itemId ? { itemId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolId ? { toolId } : {}),
        ...(toolItemId ? { toolItemId } : {}),
        ...(callId ? { callId } : {}),
        ...(parentId ? { parentId } : {}),
        ...(parentItemId ? { parentItemId } : {}),
        ...(firstStringField(data, ['name', 'commandName']) ? { name: firstStringField(data, ['name', 'commandName']) } : {}),
        ...(stringField(data, 'title') ? { title: stringField(data, 'title') } : {}),
        ...(command ? { command } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(stdout !== undefined ? { stdout } : {}),
        ...(stderr !== undefined ? { stderr } : {}),
        ...(stdoutExcerpt !== undefined ? { stdoutExcerpt } : {}),
        ...(stderrExcerpt !== undefined ? { stderrExcerpt } : {}),
        ...(stringField(data, 'status') ? { status: stringField(data, 'status') } : {}),
        ...(phase ? { phase } : {}),
        ...(firstNumber(data, ['exitCode', 'exit_code']) !== undefined
          ? { exitCode: firstNumber(data, ['exitCode', 'exit_code']) }
          : {}),
        ...(firstNumber(data, ['durationMs', 'duration_ms']) !== undefined
          ? { durationMs: firstNumber(data, ['durationMs', 'duration_ms']) }
          : {}),
        ...(stringField(data, 'cwd') ? { cwd: stringField(data, 'cwd') } : {}),
        rawPayload: data,
        ...(timestampField(data, ['startedAt', 'started_at', 'startTime', 'start_time']) !== undefined
          ? { startedAt: timestampField(data, ['startedAt', 'started_at', 'startTime', 'start_time']) }
          : {}),
        ...(timestampField(data, ['updatedAt', 'updated_at', 'updatedTime', 'updated_time']) !== undefined
          ? { updatedAt: timestampField(data, ['updatedAt', 'updated_at', 'updatedTime', 'updated_time']) }
          : {}),
        ...(timestampField(data, ['endedAt', 'ended_at', 'endTime', 'end_time', 'completedAt', 'completed_at']) !== undefined
          ? { endedAt: timestampField(data, ['endedAt', 'ended_at', 'endTime', 'end_time', 'completedAt', 'completed_at']) }
          : {}),
        ts,
      },
    });
  }

  if (event.stream === 'patch' && event.runId) {
    const ts = numberField(event, 'ts') ?? Date.now();
    const toolCallId = toolCallIdField(data);
    const itemId = itemIdField(data);
    const toolId = toolIdField(data);
    const toolItemId = toolItemIdField(data);
    const callId = callIdField(data);
    const parentId = parentIdField(data);
    const parentItemId = parentItemIdField(data);
    const filePaths = firstStringArrayField(data, ['filePaths', 'file_paths', 'files', 'paths']);
    const fileCount = firstNumber(data, ['fileCount', 'file_count', 'filesCount', 'files_count'])
      ?? filePaths?.length;
    actions.push({
      type: 'patch.completed',
      sessionKey: event.sessionKey,
      patch: {
        id: stableStreamEntryId('patch', event, data, ts),
        runId: event.runId,
        ...(itemId ? { itemId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolId ? { toolId } : {}),
        ...(toolItemId ? { toolItemId } : {}),
        ...(callId ? { callId } : {}),
        ...(parentId ? { parentId } : {}),
        ...(parentItemId ? { parentItemId } : {}),
        ...(firstStringField(data, ['name', 'patchName']) ? { name: firstStringField(data, ['name', 'patchName']) } : {}),
        ...(stringField(data, 'title') ? { title: stringField(data, 'title') } : {}),
        ...(firstStringField(data, ['summary', 'message']) ? { summary: firstStringField(data, ['summary', 'message']) } : {}),
        ...(stringField(data, 'status') ? { status: stringField(data, 'status') } : {}),
        ...(filePaths ? { filePaths, files: filePaths } : {}),
        ...(fileCount !== undefined ? { fileCount } : {}),
        ...(numberField(data, 'added') !== undefined ? { added: numberField(data, 'added') } : {}),
        ...(numberField(data, 'modified') !== undefined ? { modified: numberField(data, 'modified') } : {}),
        ...(numberField(data, 'deleted') !== undefined ? { deleted: numberField(data, 'deleted') } : {}),
        rawPayload: data,
        ts,
      },
    });
  }

  if (event.stream === 'lifecycle') {
    if (phase === 'start') {
      actions.push(runStatusAction(event, { phase: 'running', runId: event.runId }));
    }
    if (phase === 'fallback_step') {
      actions.push({
        type: 'runtime.fallback',
        sessionKey: event.sessionKey,
        status: fallbackStepStatus(data),
      });
    }
    if (phase === 'end' || phase === 'completed' || phase === 'done' || phase === 'finished') {
      actions.push(runStatusAction(event, { phase: 'done', runId: event.runId }));
    }
    if (phase === 'error' || phase === 'failed') {
      actions.push(
        runStatusAction(event, {
          phase: 'error',
          runId: event.runId,
          message: stringField(data, 'error') ?? stringField(data, 'message'),
        }),
      );
    }
    if (phase === 'aborted' || phase === 'cancelled' || phase === 'canceled') {
      actions.push(
        runStatusAction(event, {
          phase: 'interrupted',
          runId: event.runId,
          ...lifecycleMetadata(data),
        }),
      );
    }
  }

  if (event.stream === 'compaction') {
    if (phase === 'start' || phase === 'before') {
      actions.push({
        type: 'runtime.compaction',
        sessionKey: event.sessionKey,
        status: {
          phase: 'active',
          message: firstString([data.message, data.reason, data.messages]),
        },
      });
    }
    if (phase === 'end' || phase === 'after' || phase === 'completed') {
      const willRetry = booleanField(data, 'willRetry') === true;
      const completed = booleanField(data, 'completed');
      actions.push({
        type: 'runtime.compaction',
        sessionKey: event.sessionKey,
        status: {
          phase: willRetry ? 'retrying' : completed === false ? 'error' : 'complete',
          message: firstString([data.message, data.reason, data.messages]),
        },
      });
    }
  }

  const sessionOperation = sessionOperationPayload(event, data);
  if (sessionOperation?.operation === 'compact') {
    const operationPhase = stringField(sessionOperation, 'phase');
    const sessionKey = stringField(sessionOperation, 'sessionKey') ?? event.sessionKey;
    if (operationPhase === 'start') {
      actions.push({
        type: 'runtime.compaction',
        sessionKey,
        status: { phase: 'active' },
      });
    }
    if (operationPhase === 'end') {
      const completed = booleanField(sessionOperation, 'completed');
      actions.push({
        type: 'runtime.compaction',
        sessionKey,
        status: {
          phase: completed === false ? 'error' : 'complete',
          message: firstString([sessionOperation.message, sessionOperation.reason]),
        },
      });
    }
  }

  if (event.stream === 'fallback' || event.stream === 'failover') {
    const resolvedPhase = phase === 'end' || phase === 'done' || phase === 'cleared'
      ? 'cleared'
      : phase === 'error' || phase === 'failed'
        ? 'error'
        : 'active';
    actions.push({
      type: 'runtime.fallback',
      sessionKey: event.sessionKey,
      status: {
        phase: resolvedPhase,
        message: firstString([
          data.message,
          data.reason,
          data.decision,
          data.action,
        ]),
      },
    });
  }

  if (event.stream === 'approval') {
    const ids = approvalIds(event, data);
    if (
      phase === 'resolved'
      || data.status === 'approved'
      || data.status === 'denied'
      || data.status === 'failed'
    ) {
      actions.push({ type: 'approval.resolved', sessionKey: event.sessionKey, ids });
      return actions;
    }

    if (phase === 'requested' || data.status === 'pending' || data.status === 'unavailable') {
      const id = ids[0] ?? `${event.runId ?? 'approval'}:${event.seq ?? 'pending'}`;
      const kind = data.kind === 'plugin' || data.kind === 'exec' ? data.kind : 'exec';
      const status = data.status === 'unavailable' ? 'unavailable' : 'pending';
      const detail = stringField(data, 'command')
        ?? stringField(data, 'detail')
        ?? stringField(data, 'reason')
        ?? stringField(data, 'message')
        ?? JSON.stringify(data);
      actions.push({
        type: 'approval.upserted',
        approval: {
          id,
          kind,
          status,
          title: stringField(data, 'title') ?? '',
          detail,
          approvalId: firstStringField(data, ['approvalId', 'approval_id']),
          approvalSlug: firstStringField(data, ['approvalSlug', 'approval_slug']),
          itemId: itemIdField(data),
          toolCallId: toolCallIdField(data),
          message: stringField(data, 'message'),
          sessionKey: event.sessionKey,
          agentId: event.agentId,
          expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : undefined,
          allowedDecisions: approvalDecisions(data.allowedDecisions),
        },
      });
    }
  }

  return actions;
}
