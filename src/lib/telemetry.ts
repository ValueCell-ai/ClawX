type TelemetryPayload = Record<string, unknown>;
export type UiTelemetryEntry = {
  id: number;
  event: string;
  payload: TelemetryPayload;
  count: number;
  ts: string;
};

const counters = new Map<string, number>();
const history: UiTelemetryEntry[] = [];
const listeners = new Set<(entry: UiTelemetryEntry) => void>();
let nextEntryId = 1;
const MAX_HISTORY = 500;

function safeStringify(payload: TelemetryPayload): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '{}';
  }
}

export function trackUiEvent(event: string, payload: TelemetryPayload = {}): void {
  const count = (counters.get(event) ?? 0) + 1;
  counters.set(event, count);

  const normalizedPayload = {
    ...payload,
  };
  const ts = new Date().toISOString();
  const entry: UiTelemetryEntry = {
    id: nextEntryId,
    event,
    payload: normalizedPayload,
    count,
    ts,
  };
  nextEntryId += 1;

  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  listeners.forEach((listener) => listener(entry));

  const logPayload = {
    ...normalizedPayload,
    count,
    ts,
  };

  // Local-only telemetry for UX diagnostics.
  console.info(`[ui-metric] ${event} ${safeStringify(logPayload)}`);
}

export function getUiCounter(event: string): number {
  return counters.get(event) ?? 0;
}

export function trackUiTiming(
  event: string,
  durationMs: number,
  payload: TelemetryPayload = {},
): void {
  trackUiEvent(event, {
    ...payload,
    durationMs: Math.round(durationMs),
  });
}

export function startUiTiming(
  event: string,
  payload: TelemetryPayload = {},
): (nextPayload?: TelemetryPayload) => number {
  const start = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  return (nextPayload: TelemetryPayload = {}): number => {
    const end = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const durationMs = Math.max(0, end - start);
    trackUiTiming(event, durationMs, { ...payload, ...nextPayload });
    return durationMs;
  };
}

export function getUiTelemetrySnapshot(limit = 200): UiTelemetryEntry[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  if (limit >= history.length) {
    return [...history];
  }
  return history.slice(-limit);
}

export function clearUiTelemetry(): void {
  counters.clear();
  history.length = 0;
}

export function subscribeUiTelemetry(listener: (entry: UiTelemetryEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
