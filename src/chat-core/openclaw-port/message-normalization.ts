import type { RawOpenClawMessage } from './types';
import { extractMessageText, stripMediaAttachmentReferences } from './history';

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeKind(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[_-]/g, '').toLowerCase()
    : '';
}

function normalizeContent(content: unknown): RawRecord[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function isToolCallBlock(block: RawRecord): boolean {
  const kind = normalizeKind(block.type);
  return (
    kind === 'toolcall'
    || kind === 'tooluse'
    || (typeof block.name === 'string'
      && (block.arguments != null || block.args != null || block.input != null))
  );
}

function isToolResultBlock(block: RawRecord): boolean {
  const kind = normalizeKind(block.type);
  return kind === 'toolresult';
}

function readToolId(block: RawRecord, message: RawOpenClawMessage): string | undefined {
  return readString(
    block.id,
    block.toolCallId,
    block.tool_call_id,
    block.toolUseId,
    block.tool_use_id,
    block.callId,
    message.toolCallId,
    message.tool_call_id,
    message.toolUseId,
    message.tool_use_id,
    message.callId,
  );
}

function readToolName(block: RawRecord, message: RawOpenClawMessage): string | undefined {
  return readString(block.name, message.toolName, message.tool_name);
}

type ToolReference = {
  id?: string;
  name?: string;
};

function collectToolCalls(message: RawOpenClawMessage): ToolReference[] {
  return normalizeContent(message.content)
    .filter(isToolCallBlock)
    .map((block) => ({
      id: readToolId(block, message),
      name: readToolName(block, message),
    }));
}

function isStandaloneToolResultMessage(message: RawOpenClawMessage): boolean {
  const role = normalizeKind(message.role);
  if (role === 'tool' || role === 'function' || role === 'toolresult') return true;
  if (
    readToolId({}, message)
    || typeof message.toolName === 'string'
    || typeof message.tool_name === 'string'
  ) {
    return true;
  }

  const content = normalizeContent(message.content);
  return content.length > 0 && content.every(isToolResultBlock);
}

function toolResultMatchesCall(
  calls: ToolReference[],
  resultMessage: RawOpenClawMessage,
): boolean {
  if (calls.length === 0) return false;

  const resultId = readToolId({}, resultMessage);
  if (resultId && calls.some((call) => call.id === resultId)) return true;

  const resultName = readToolName({}, resultMessage);
  if (resultName && calls.some((call) => call.name === resultName)) return true;

  return calls.length === 1 && !resultId && !resultName;
}

function toToolResultBlocks(message: RawOpenClawMessage): RawRecord[] {
  const id = readToolId({}, message);
  const name = readToolName({}, message);
  const existingBlocks = normalizeContent(message.content);
  const idFields = id ? { tool_use_id: id, toolCallId: id } : {};
  const nameFields = name ? { name } : {};

  if (existingBlocks.length > 0 && existingBlocks.every(isToolResultBlock)) {
    return existingBlocks.map((block) => ({
      ...block,
      ...idFields,
      ...nameFields,
      type: 'tool_result',
    }));
  }

  return [{
    type: 'tool_result',
    ...idFields,
    ...nameFields,
    content: message.content ?? message.text ?? '',
    isError: message.isError ?? message.is_error,
    details: message.details,
  }];
}

function appendToolResult(
  message: RawOpenClawMessage,
  resultMessage: RawOpenClawMessage,
): RawOpenClawMessage {
  const content = Array.isArray(message.content) ? [...message.content] : [];
  return {
    ...message,
    content: [
      ...content,
      ...toToolResultBlocks(resultMessage),
    ],
  };
}

export function mergeAdjacentToolResultMessages(
  messages: RawOpenClawMessage[],
): RawOpenClawMessage[] {
  const merged: RawOpenClawMessage[] = [];

  for (let index = 0; index < messages.length; index++) {
    let message = messages[index];
    const calls = collectToolCalls(message);

    if (calls.length === 0) {
      merged.push(message);
      continue;
    }

    while (
      index + 1 < messages.length
      && isStandaloneToolResultMessage(messages[index + 1])
      && toolResultMatchesCall(calls, messages[index + 1])
    ) {
      index += 1;
      message = appendToolResult(message, messages[index]);
    }

    merged.push(message);
  }

  return merged;
}

function hasMediaAttachmentReference(message: RawOpenClawMessage): boolean {
  return /\[media attached:/i.test(extractMessageText(message));
}

function isUserMessage(message: RawOpenClawMessage): boolean {
  return typeof message.role === 'string' && message.role.toLowerCase() === 'user';
}

function readIdempotencyKey(message: RawOpenClawMessage): string | undefined {
  return readString(message.idempotencyKey, message.idempotency_key);
}

function normalizedUserPrompt(message: RawOpenClawMessage): string {
  return stripMediaAttachmentReferences(extractMessageText(message));
}

function preferUserEcho(
  current: RawOpenClawMessage,
  candidate: RawOpenClawMessage,
): RawOpenClawMessage {
  if (!hasMediaAttachmentReference(current) && hasMediaAttachmentReference(candidate)) {
    return candidate;
  }
  return current;
}

export function collapseDuplicateIdempotentUserEchoes(
  messages: RawOpenClawMessage[],
): RawOpenClawMessage[] {
  const collapsed: RawOpenClawMessage[] = [];
  const userIndexByIdempotentPrompt = new Map<string, number>();

  for (const message of messages) {
    if (!isUserMessage(message)) {
      collapsed.push(message);
      continue;
    }

    const idempotencyKey = readIdempotencyKey(message);
    const prompt = normalizedUserPrompt(message);
    if (!idempotencyKey || !prompt) {
      collapsed.push(message);
      continue;
    }

    const dedupeKey = `${idempotencyKey}\0${prompt}`;
    const existingIndex = userIndexByIdempotentPrompt.get(dedupeKey);
    if (existingIndex !== undefined) {
      collapsed[existingIndex] = preferUserEcho(collapsed[existingIndex], message);
      continue;
    }

    collapsed.push(message);
    userIndexByIdempotentPrompt.set(dedupeKey, collapsed.length - 1);
  }

  return collapsed;
}

export function collapseDuplicateAttachmentUserEchoes(
  messages: RawOpenClawMessage[],
): RawOpenClawMessage[] {
  const collapsed: RawOpenClawMessage[] = [];
  const mediaUserIndexByPrompt = new Map<string, number>();
  const plainUserIndexByPrompt = new Map<string, number>();

  for (const message of messages) {
    if (!isUserMessage(message)) {
      collapsed.push(message);
      continue;
    }

    const prompt = normalizedUserPrompt(message);
    const hasMedia = hasMediaAttachmentReference(message);
    if (!prompt) {
      collapsed.push(message);
      continue;
    }

    const existingMediaIndex = mediaUserIndexByPrompt.get(prompt);
    if (existingMediaIndex !== undefined) {
      if (hasMedia) collapsed[existingMediaIndex] = message;
      continue;
    }

    if (hasMedia) {
      const existingPlainIndex = plainUserIndexByPrompt.get(prompt);
      if (existingPlainIndex !== undefined) {
        collapsed[existingPlainIndex] = message;
        mediaUserIndexByPrompt.set(prompt, existingPlainIndex);
        plainUserIndexByPrompt.delete(prompt);
        continue;
      }
    }

    collapsed.push(message);
    if (hasMedia) mediaUserIndexByPrompt.set(prompt, collapsed.length - 1);
    else plainUserIndexByPrompt.set(prompt, collapsed.length - 1);
  }

  return collapsed;
}
