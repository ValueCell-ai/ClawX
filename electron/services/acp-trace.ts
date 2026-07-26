import type {
  AcpTraceEntry,
  AcpTraceRecordPayload,
  AcpTraceSnapshot,
  AttachmentAccessError,
} from '@shared/host-api/contract';
import { isRecord } from './payload-utils';

type AcpTraceRecordInput = Omit<AcpTraceEntry, 'seq' | 'timestamp'>;

const MAX_ACP_TRACE_ENTRIES = 500;
const MAX_STRING_LENGTH = 300;
const SENSITIVE_KEY_RE = /(authorization|api[_-]?key|token|secret|password|bearer)/i;
const OPENCLAW_MEDIA_DETAIL_KEYS = new Set([
  'source',
  'reason',
  'candidateCount',
  'matchedCount',
  'rejectedCount',
  'attachmentCount',
  'imageCount',
  'missingCount',
  'previewCount',
  'evidenceHash',
  'identityHash',
  'operationId',
  'latestGeneration',
  'error',
]);

let sequence = 0;
let entries: AcpTraceEntry[] = [];

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/bearer\s+\S+/i.test(value) || /^sk-[A-Za-z0-9_-]{8,}/.test(value)) return '[redacted]';
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }
  if (depth >= 4) return '[max-depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitize(item, depth + 1));
    return value.length > 20 ? { type: 'array', length: value.length, items } : items;
  }
  if (!isRecord(value)) return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitize(nested, depth + 1);
  }
  return output;
}

function optionalString(value: unknown, maxLength = 120): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

export function recordAcpTrace(input: AcpTraceRecordInput): AcpTraceEntry {
  const entry: AcpTraceEntry = {
    seq: sequence += 1,
    timestamp: new Date().toISOString(),
    source: input.source,
    event: input.event.slice(0, 120),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(typeof input.generation === 'number' ? { generation: input.generation } : {}),
    ...(input.details !== undefined ? { details: sanitize(input.details) } : {}),
  };
  entries.push(entry);
  if (entries.length > MAX_ACP_TRACE_ENTRIES) entries = entries.slice(-MAX_ACP_TRACE_ENTRIES);
  return entry;
}

export function getAcpTraceSnapshot(): AcpTraceSnapshot {
  return {
    capturedAt: Date.now(),
    maxSize: MAX_ACP_TRACE_ENTRIES,
    size: entries.length,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

export function normalizeRendererAcpTracePayload(payload: unknown): AcpTraceRecordInput | null {
  if (!isRecord(payload)) return null;
  const event = optionalString(payload.event);
  if (!event) return null;
  const sessionKey = optionalString(payload.sessionKey, 200);
  const direction = optionalString(payload.direction, 80) ?? 'projection';
  const generation = typeof payload.generation === 'number' && Number.isFinite(payload.generation)
    ? payload.generation
    : undefined;
  const details = event.startsWith('openclaw-media:') && isRecord(payload.details)
    ? Object.fromEntries(Object.entries(payload.details).filter(([key]) => OPENCLAW_MEDIA_DETAIL_KEYS.has(key)))
    : payload.details;
  return {
    source: 'renderer',
    event,
    direction,
    ...(sessionKey ? { sessionKey } : {}),
    ...(generation != null ? { generation } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

export function recordRendererAcpTrace(payload: AcpTraceRecordPayload): { success: boolean; error?: string } {
  const normalized = normalizeRendererAcpTracePayload(payload);
  if (!normalized) return { success: false, error: 'Invalid ACP trace payload' };
  recordAcpTrace(normalized);
  return { success: true };
}

export function recordAttachmentOpenTrace(input: {
  ok: boolean;
  reason: AttachmentAccessError | 'success';
  sourceKind: 'local' | 'remote' | 'invalid';
  sessionKey: string;
  generation: number;
  identity: string;
}): AcpTraceEntry {
  return recordAcpTrace({
    source: 'main',
    event: `attachment/open:${input.ok ? 'success' : 'failure'}`,
    direction: 'open',
    sessionKey: input.sessionKey,
    generation: input.generation,
    details: {
      reason: input.reason,
      sourceKind: input.sourceKind,
      identity: input.identity.slice(0, 64),
    },
  });
}

export function clearAcpTraceForTests(): void {
  sequence = 0;
  entries = [];
}
