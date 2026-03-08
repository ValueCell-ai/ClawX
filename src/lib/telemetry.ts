type TelemetryPayload = Record<string, unknown>;

const counters = new Map<string, number>();

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

  const logPayload = {
    ...payload,
    count,
    ts: new Date().toISOString(),
  };

  // Local-only telemetry for UX diagnostics.
  console.info(`[ui-metric] ${event} ${safeStringify(logPayload)}`);
}

export function getUiCounter(event: string): number {
  return counters.get(event) ?? 0;
}
