/*
 * Vendored from OpenClaw Web UI on 2026-06-19.
 * Local ClawX changes must stay adapter-oriented and must not add Renderer
 * direct Gateway access.
 */

import type { LiveToolEntry } from './types';

export type ToolCard = {
  id: string;
  toolName?: string;
  inputText?: string;
  outputText?: string;
  isError?: boolean;
  preview?: {
    kind: 'text' | 'json' | 'image' | 'unknown';
    label?: string;
    text?: string;
    url?: string;
  };
  transcriptMessageId?: string;
};

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
  );
}

function resolveTranscriptMessageId(message: Record<string, unknown>): string | undefined {
  if (typeof message.messageId === 'string' && message.messageId.trim()) {
    return message.messageId;
  }
  const openClawMeta = message.__openclaw;
  if (!openClawMeta || typeof openClawMeta !== 'object' || Array.isArray(openClawMeta)) {
    return undefined;
  }
  const id = (openClawMeta as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) {
    const parts = record.content.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const text = (entry as Record<string, unknown>).text;
      return typeof text === 'string' ? [text] : [];
    });
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  return undefined;
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  return extractText(item);
}

function readToolErrorFlag(value: Record<string, unknown>): boolean | undefined {
  const raw = value.isError ?? value.is_error;
  return typeof raw === 'boolean' ? raw : undefined;
}

const TOOL_NOT_FOUND_PATTERN = /^tool not found\.?$/i;
const COMMAND_EXIT_CODE_PATTERN = /\(Command exited with code (-?\d+)\)\s*$/i;
const MAX_ERROR_DETECT_CHARS = 20_000;
const TOOL_ERROR_STATUSES = new Set(['error', 'failed', 'timeout']);

function hasToolErrorStatus(value: unknown): boolean {
  return typeof value === 'string' && TOOL_ERROR_STATUSES.has(value.trim().toLowerCase());
}

export function isToolErrorOutput(outputText: string | undefined): boolean {
  if (!outputText) return false;
  const trimmed = outputText.trim();
  if (!trimmed) return false;
  if (TOOL_NOT_FOUND_PATTERN.test(trimmed)) return true;
  const commandExitCode = COMMAND_EXIT_CODE_PATTERN.exec(trimmed);
  if (commandExitCode) return Number(commandExitCode[1]) !== 0;
  if (trimmed.length > MAX_ERROR_DETECT_CHARS) return false;
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

  const obj = parsed as Record<string, unknown>;
  const explicitErrorFlag = readToolErrorFlag(obj);
  if (explicitErrorFlag !== undefined) return explicitErrorFlag;
  if ('error' in obj) {
    const value = obj.error;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'boolean') return value;
    if (value && typeof value === 'object') return true;
  }
  return hasToolErrorStatus(obj.status);
}

export function isToolCardError(card: ToolCard): boolean {
  if (card.isError === true) return true;
  return isToolErrorOutput(card.outputText);
}

function serializeToolInput(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    if (typeof args === 'number' || typeof args === 'boolean' || typeof args === 'bigint') {
      return String(args);
    }
    if (typeof args === 'symbol') {
      return args.description ? `Symbol(${args.description})` : 'Symbol()';
    }
    return Object.prototype.toString.call(args);
  }
}

function resolveToolCardId(
  item: Record<string, unknown>,
  message: Record<string, unknown>,
  index: number,
  prefix: string,
): string {
  const explicitId =
    (typeof item.id === 'string' && item.id.trim())
    || (typeof item.toolCallId === 'string' && item.toolCallId.trim())
    || (typeof item.tool_call_id === 'string' && item.tool_call_id.trim())
    || (typeof item.toolUseId === 'string' && item.toolUseId.trim())
    || (typeof item.tool_use_id === 'string' && item.tool_use_id.trim())
    || (typeof item.callId === 'string' && item.callId.trim())
    || (typeof message.toolCallId === 'string' && message.toolCallId.trim())
    || (typeof message.tool_call_id === 'string' && message.tool_call_id.trim())
    || '';
  if (explicitId) return `${prefix}:${explicitId}`;

  const name =
    (typeof item.name === 'string' && item.name.trim())
    || (typeof message.toolName === 'string' && message.toolName.trim())
    || (typeof message.tool_name === 'string' && message.tool_name.trim())
    || 'tool';
  return `${prefix}:${name}:${index}`;
}

function resolveToolName(item: Record<string, unknown>, message: Record<string, unknown>): string {
  return (
    (typeof item.name === 'string' && item.name.trim())
    || (typeof message.toolName === 'string' && message.toolName.trim())
    || (typeof message.tool_name === 'string' && message.tool_name.trim())
    || 'tool'
  );
}

function buildPreview(outputText: string | undefined): ToolCard['preview'] | undefined {
  const text = outputText?.trim();
  if (!text) return undefined;
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(text)) {
    return { kind: 'image', url: text, label: 'Image' };
  }
  try {
    const parsed = JSON.parse(text);
    return { kind: 'json', text: JSON.stringify(parsed, null, 2), label: 'JSON' };
  } catch {
    return { kind: 'text', text: text.slice(0, 4_000), label: 'Text' };
  }
}

function nonBlankText(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

export function toolCardFromLiveEntry(entry: LiveToolEntry): ToolCard {
  const outputText = nonBlankText(entry.output) ?? entry.errorText;
  return {
    id: `live:${entry.id}`,
    toolName: entry.name,
    inputText: serializeToolInput(entry.args),
    outputText,
    ...(entry.isError !== undefined ? { isError: entry.isError } : {}),
    preview: buildPreview(outputText),
  };
}

function findFirstUnmatchedCard(
  cards: ToolCard[],
  id: string,
  toolName: string,
  fallbackMatchedCards: WeakSet<ToolCard>,
): ToolCard | undefined {
  let nameOnlyCandidate: ToolCard | undefined;
  for (const card of cards) {
    if (card.id === id) return card;
    if (
      !nameOnlyCandidate
      && card.toolName === toolName
      && card.outputText === undefined
      && !fallbackMatchedCards.has(card)
    ) {
      nameOnlyCandidate = card;
    }
  }
  return nameOnlyCandidate;
}

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.replace(/[_-]/g, '').toLowerCase() : '';
}

function isStandaloneToolMessage(message: Record<string, unknown>): boolean {
  const role = normalizeRole(message.role);
  return (
    role === 'tool'
    || role === 'toolresult'
    || role === 'function'
    || typeof message.toolName === 'string'
    || typeof message.tool_name === 'string'
    || typeof message.toolCallId === 'string'
    || typeof message.tool_call_id === 'string'
    || typeof message.toolUseId === 'string'
    || typeof message.tool_use_id === 'string'
  );
}

export function extractToolCards(message: unknown, prefix = 'tool'): ToolCard[] {
  if (!message || typeof message !== 'object') return [];
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const messageIsError = readToolErrorFlag(m);
  const cards: ToolCard[] = [];
  const fallbackMatchedCards = new WeakSet<ToolCard>();
  const transcriptMessageId = resolveTranscriptMessageId(m);

  for (let index = 0; index < content.length; index++) {
    const item = content[index] ?? {};
    const kind = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    const isToolCall =
      ['toolcall', 'tool_call', 'tooluse', 'tool_use'].includes(kind)
      || (typeof item.name === 'string'
        && (item.arguments != null || item.args != null || item.input != null));

    if (isToolCall) {
      const args = coerceArgs(item.arguments ?? item.args ?? item.input);
      cards.push({
        id: resolveToolCardId(item, m, index, prefix),
        toolName: resolveToolName(item, m),
        inputText: serializeToolInput(args),
        transcriptMessageId,
      });
      continue;
    }

    if (kind === 'toolresult' || kind === 'tool_result') {
      const toolName = resolveToolName(item, m);
      const cardId = resolveToolCardId(item, m, index, prefix);
      const existing = findFirstUnmatchedCard(cards, cardId, toolName, fallbackMatchedCards);
      const outputText = extractToolText(item);
      const preview = buildPreview(outputText);
      const isError = readToolErrorFlag(item) ?? messageIsError;
      if (existing) {
        fallbackMatchedCards.add(existing);
        existing.outputText = outputText;
        existing.preview = preview;
        if (isError !== undefined) existing.isError = isError;
        continue;
      }
      cards.push({
        id: cardId,
        toolName,
        outputText,
        transcriptMessageId,
        ...(isError !== undefined ? { isError } : {}),
        preview,
      });
    }
  }

  if (isStandaloneToolMessage(m) && cards.length === 0) {
    const toolName = resolveToolName({}, m);
    const outputText = extractText(message);
    cards.push({
      id: resolveToolCardId({}, m, 0, prefix),
      toolName,
      outputText,
      transcriptMessageId,
      ...(messageIsError !== undefined ? { isError: messageIsError } : {}),
      preview: buildPreview(outputText),
    });
  }

  return cards;
}

const toolCardsByMessage = new WeakMap<object, Map<string, ToolCard[]>>();

export function extractToolCardsCached(message: unknown, prefix = 'tool'): ToolCard[] {
  if (!message || typeof message !== 'object') return extractToolCards(message, prefix);
  let byPrefix = toolCardsByMessage.get(message);
  if (!byPrefix) {
    byPrefix = new Map();
    toolCardsByMessage.set(message, byPrefix);
  }
  const cached = byPrefix.get(prefix);
  if (cached) return cached;
  const cards = extractToolCards(message, prefix);
  byPrefix.set(prefix, cards);
  return cards;
}
