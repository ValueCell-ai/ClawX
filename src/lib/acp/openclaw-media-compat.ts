import { stripAcpWorkingDirectoryPrefix } from '@shared/chat/session-title';
import type { RawMessage } from '@shared/chat/types';
import type { AcpTimelineSnapshot, MessageSegmentItem } from './timeline-types';

const MAX_MEDIA_REFERENCE_LENGTH = 4096;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export type OpenClawMediaCandidate = {
  evidenceId: string;
  transcriptMessageId?: string;
  uri: string;
  order: number;
};

export type OpenClawMediaTurnSupplement = {
  acpTurnId: string;
  candidates: OpenClawMediaCandidate[];
};

export type TranscriptMediaTurn = {
  normalizedUserText: string;
  userOccurrenceFromTail: number;
  candidates: OpenClawMediaCandidate[];
};

type MutableTranscriptTurn = Omit<TranscriptMediaTurn, 'userOccurrenceFromTail'>;
type PendingMediaCandidate = Omit<OpenClawMediaCandidate, 'evidenceId'> & { evidenceSeed: string };
type PendingTranscriptTurn = Omit<MutableTranscriptTurn, 'candidates'> & { candidates: PendingMediaCandidate[] };

export type AcpUserTurn = {
  turnId: string;
  messageIds: Set<string>;
  normalizedUserText: string;
  userOccurrenceFromTail: number;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const block = entry as Record<string, unknown>;
      return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeUserText(text: string): string {
  return stripAcpWorkingDirectoryPrefix(text)
    .replace(/\r\n/g, '\n')
    .trim();
}

function isInternalInterSessionUser(message: RawMessage): boolean {
  if (typeof message.role !== 'string' || message.role.toLowerCase() !== 'user') return false;
  const provenance = message as RawMessage & { provenance?: unknown };
  if (provenance.provenance && typeof provenance.provenance === 'object') {
    const kind = (provenance.provenance as Record<string, unknown>).kind;
    if (typeof kind === 'string' && kind.toLowerCase() === 'inter_session') return true;
  }
  return /^\[Inter-session message\]\s/.test(textFromContent(message.content));
}

function parseDirectiveReference(line: string, executionCwd: string): string | null {
  const match = line.match(/^\s*MEDIA:\s*(.*?)\s*$/i);
  if (!match) return null;
  const raw = match[1] ?? '';
  if (!raw) return null;

  let reference = raw;
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    if (raw.length < 2 || raw[raw.length - 1] !== quote) return null;
    reference = raw.slice(1, -1);
  } else if (/\s/.test(raw)) {
    return null;
  }

  if (!reference || reference.length > MAX_MEDIA_REFERENCE_LENGTH) return null;
  if (/^[`*_[(<{]/.test(reference) || /[\]>)}`*]$/.test(reference)) return null;
  if (/^https?:\/\//i.test(reference)) {
    try {
      const url = new URL(reference);
      return url.protocol === 'http:' || url.protocol === 'https:' ? reference : null;
    } catch {
      return null;
    }
  }
  if (/^file:\/\//i.test(reference)) return reference;
  if (URI_SCHEME_RE.test(reference) && !WINDOWS_ABSOLUTE_RE.test(reference)) return null;
  if (reference.startsWith('/') || reference.startsWith('~/') || WINDOWS_ABSOLUTE_RE.test(reference)) {
    return reference;
  }
  return executionCwd.trim() ? reference : null;
}

function mediaReferences(text: string): Array<{ uri: string; line: number }> {
  const references: Array<{ uri: string; line: number }> = [];
  let fence: { marker: string; length: number } | null = null;
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (fence) {
      const closeMatch = line.match(FENCE_CLOSE_RE);
      const delimiter = closeMatch?.[1] ?? '';
      const marker = delimiter[0];
      if (marker === fence.marker && delimiter.length >= fence.length) fence = null;
      continue;
    }

    const openMatch = line.match(FENCE_OPEN_RE);
    const delimiter = openMatch?.[1] ?? '';
    const marker = delimiter[0];
    const info = openMatch?.[2] ?? '';
    if (marker && !(marker === '`' && info.includes('`'))) {
      fence = { marker, length: delimiter.length };
      continue;
    }
    references.push({ uri: line, line: lineIndex });
  }
  return references;
}

function assignOccurrencesFromTail<T extends { normalizedUserText: string }>(turns: T[]): Array<T & { userOccurrenceFromTail: number }> {
  const occurrences = new Map<string, number>();
  const result = new Array<T & { userOccurrenceFromTail: number }>(turns.length);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const occurrence = (occurrences.get(turn.normalizedUserText) ?? 0) + 1;
    occurrences.set(turn.normalizedUserText, occurrence);
    result[index] = { ...turn, userOccurrenceFromTail: occurrence };
  }
  return result;
}

export function extractOpenClawMediaTurns(
  messages: RawMessage[],
  input: { executionCwd: string; suppressedUris: ReadonlySet<string> },
): TranscriptMediaTurn[] {
  const turns: PendingTranscriptTurn[] = [];
  let current: PendingTranscriptTurn | null = null;

  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
    if (role === 'user') {
      if (isInternalInterSessionUser(message)) continue;
      current = {
        normalizedUserText: normalizeUserText(textFromContent(message.content)),
        candidates: [],
      };
      turns.push(current);
      continue;
    }
    if (role !== 'assistant' || !current) continue;

    const text = textFromContent(message.content);
    for (const reference of mediaReferences(text)) {
      const uri = parseDirectiveReference(reference.uri, input.executionCwd);
      if (!uri || input.suppressedUris.has(uri)) continue;
      const order = current.candidates.length;
      const messageIdentity = message.id
        ? `id:${message.id}`
        : message.timestamp != null
          ? `timestamp:${message.timestamp}`
          : `content:${stableHash(text)}`;
      current.candidates.push({
        evidenceSeed: `${messageIdentity}:${reference.line}:${uri}`,
        ...(message.id ? { transcriptMessageId: message.id } : {}),
        uri,
        order,
      });
    }
  }

  return assignOccurrencesFromTail(turns).map((turn) => ({
    normalizedUserText: turn.normalizedUserText,
    userOccurrenceFromTail: turn.userOccurrenceFromTail,
    candidates: turn.candidates.map(({ evidenceSeed, ...candidate }) => ({
      ...candidate,
      evidenceId: `openclaw-media:${stableHash(JSON.stringify([
        turn.normalizedUserText,
        turn.userOccurrenceFromTail,
        evidenceSeed,
      ]))}`,
    })),
  }));
}

function userPromptText(item: MessageSegmentItem): string {
  // OpenClaw ACP does not project assistant MEDIA attachments, so ClawX reads a
  // bounded transcript supplement. Use the prompt text OpenClaw flattened from
  // structured ACP blocks to align that evidence without parsing user prose.
  if (item.userPromptTextBlocks) return item.userPromptTextBlocks.join('\n');
  return item.parts
    .flatMap((part) => part.kind === 'markdown' ? [part.text] : [])
    .join('');
}

export function acpUserTurns(snapshot: AcpTimelineSnapshot): AcpUserTurn[] {
  const turns: Array<Omit<AcpUserTurn, 'userOccurrenceFromTail'>> = [];
  let current: Omit<AcpUserTurn, 'userOccurrenceFromTail'> | null = null;

  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (item?.kind === 'message-segment' && item.role === 'user') {
      if (!current || !current.messageIds.has(item.messageId)) {
        current = { turnId: item.messageId, messageIds: new Set(), normalizedUserText: '' };
        turns.push(current);
      }
      current.messageIds.add(item.messageId);
      current.normalizedUserText += userPromptText(item);
      continue;
    }
    current = null;
  }

  return assignOccurrencesFromTail(turns.map((turn) => ({
    ...turn,
    normalizedUserText: normalizeUserText(turn.normalizedUserText),
  })));
}

export function turnMatchKey(turn: { normalizedUserText: string; userOccurrenceFromTail: number }): string {
  return JSON.stringify([turn.normalizedUserText, turn.userOccurrenceFromTail]);
}

export function selectOpenClawTranscriptTurn(
  messages: RawMessage[],
  snapshot: AcpTimelineSnapshot,
  liveUserMessageId: string,
): RawMessage[] {
  const acpMatches = acpUserTurns(snapshot).filter((turn) => turn.messageIds.has(liveUserMessageId));
  if (acpMatches.length !== 1) return [];
  const targetKey = turnMatchKey(acpMatches[0]!);
  const rawTurns: Array<{ normalizedUserText: string; messages: RawMessage[] }> = [];
  let current: { normalizedUserText: string; messages: RawMessage[] } | null = null;
  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
    if (role === 'user' && !isInternalInterSessionUser(message)) {
      current = {
        normalizedUserText: normalizeUserText(textFromContent(message.content)),
        messages: [message],
      };
      rawTurns.push(current);
    } else if (current) {
      current.messages.push(message);
    }
  }
  const matches = assignOccurrencesFromTail(rawTurns)
    .filter((turn) => turnMatchKey(turn) === targetKey);
  return matches.length === 1 ? matches[0]!.messages : [];
}

export function alignOpenClawMediaTurns(
  snapshot: AcpTimelineSnapshot,
  transcriptTurns: TranscriptMediaTurn[],
  input: { liveUserMessageId?: string },
): OpenClawMediaTurnSupplement[] {
  const acpTurns = acpUserTurns(snapshot);
  const eligibleAcpTurns = input.liveUserMessageId
    ? acpTurns.filter((turn) => turn.messageIds.has(input.liveUserMessageId!))
    : acpTurns;
  if (input.liveUserMessageId && eligibleAcpTurns.length !== 1) return [];

  const acpByKey = new Map<string, AcpUserTurn>();
  const ambiguousKeys = new Set<string>();
  for (const turn of eligibleAcpTurns) {
    const key = turnMatchKey(turn);
    if (acpByKey.has(key)) ambiguousKeys.add(key);
    else acpByKey.set(key, turn);
  }

  const supplements: OpenClawMediaTurnSupplement[] = [];
  for (const transcriptTurn of transcriptTurns) {
    if (transcriptTurn.candidates.length === 0) continue;
    const key = turnMatchKey(transcriptTurn);
    if (ambiguousKeys.has(key)) continue;
    const acpTurn = acpByKey.get(key);
    if (!acpTurn) continue;
    supplements.push({ acpTurnId: acpTurn.turnId, candidates: transcriptTurn.candidates });
  }
  return supplements;
}

export function hashOpenClawMediaDiagnostic(value: string): string {
  return stableHash(value);
}
