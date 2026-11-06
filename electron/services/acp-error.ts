import type { AcpChatOperationResult } from '@shared/acp-chat/types';

const MAX_ERROR_CHARS = 2000;
const REASON_FIELDS = ['message', 'details', 'error', 'cause'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: string): string {
  return value
    .replace(/("(?:api[_-]?key|(?:access|refresh|auth|gateway|bot)[_-]?token|token|secret|password|authorization|cookie|credentials?)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    .replace(/(\b(?:proxy[-_])?authorization\s*[=:]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/(\b(?:set-cookie|cookie)\s*[=:]\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',;]+/gi, '$1 [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|(?:access|refresh|auth|gateway|bot)[_-]?token|token|secret|password|credentials?)\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}\]\r\n]+)/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]*/gi, '$1[redacted]')
    .trim()
    .slice(0, MAX_ERROR_CHARS);
}

/** Read reason fields only: SDK data can also contain prompts, config or headers. */
function reasons(value: unknown, depth = 0): string[] {
  if (depth > 3) return [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (/^[{[]/.test(text)) {
      if (text.length > 16_000) return [];
      try { return reasons(JSON.parse(text), depth + 1); } catch { return []; }
    }
    return [safeText(text)];
  }
  if (!record(value)) return [];
  return REASON_FIELDS.flatMap((key) => reasons(value[key], depth + 1)).slice(0, 8);
}

export function describeAcpError(error: unknown): Pick<AcpChatOperationResult, 'error' | 'errorCode'> & { error: string } {
  const object = record(error) ? error : null;
  const message = typeof error === 'string' ? error : typeof object?.message === 'string' ? object.message : String(error);
  const code = object?.code;
  const safeCode = typeof code === 'number' && Number.isFinite(code)
    ? String(code)
    : typeof code === 'string' && /^[\w.:-]{1,80}$/.test(code) ? code : undefined;
  const primary = safeText(message);
  const details = [...new Set(reasons(object?.data))].filter((part) => part && part !== primary);
  const data = record(object?.data) ? object.data : null;
  return {
    error: `${primary}${safeCode ? ` (${safeCode})` : ''}${details.length ? `: ${details.join('; ')}` : ''}`.slice(0, MAX_ERROR_CHARS),
    ...(data?.code === 'ACP_GATEWAY_RECONNECT_TIMEOUT' ? { errorCode: 'ACP_GATEWAY_RECONNECT_TIMEOUT' as const } : {}),
  };
}
