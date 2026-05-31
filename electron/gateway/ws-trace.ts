const SECRET_KEYS = new Set([
  'token',
  'authorization',
  'apikey',
  'api_key',
  'signature',
  'cookie',
  'set-cookie',
  'accesstoken',
  'refreshtoken',
]);

export function isGatewayWsTraceEnabled(): boolean {
  return process.env.CLAWX_GATEWAY_WS_TRACE === '1';
}

export function redactGatewayFrameForTrace(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactGatewayFrameForTrace(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    result[key] = SECRET_KEYS.has(normalizedKey)
      ? '[redacted]'
      : redactGatewayFrameForTrace(item);
  }
  return result;
}

export function summarizeGatewayFrameForTrace(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;
  const frame = value as Record<string, unknown>;
  if (frame.type === 'req') {
    return `req id=${String(frame.id ?? '-')} method=${String(frame.method ?? '-')}`;
  }
  if (frame.type === 'res') {
    return `res id=${String(frame.id ?? '-')} ok=${String(frame.ok ?? !frame.error)}`;
  }
  if (frame.type === 'event') {
    return `event ${String(frame.event ?? '-')}`;
  }
  if (typeof frame.method === 'string') {
    return `jsonrpc method=${frame.method}`;
  }
  return 'unknown gateway frame';
}
