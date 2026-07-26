export const WEB_BROWSER_PARTITION = 'persist:clawx-web-browser' as const;
export const WEB_BROWSER_INITIAL_URL = 'about:blank' as const;
export const WEB_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36' as const;

export type WebBrowserAddressErrorCode =
  | 'empty'
  | 'absolute-path'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'reserved-url';

export type WebBrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; reason: WebBrowserAddressErrorCode };

export type WebBrowserNavigatePayload = { url: string };

const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const HOST_WITH_NUMERIC_PORT_PATTERN = /^[^/?#:\s]+:\d+(?:[/?#]|$)/;

function isAbsoluteFilesystemPath(input: string): boolean {
  return /^[\\/]/.test(input)
    || /^[a-z]:[\\/]/i.test(input)
    || /^~/.test(input);
}

function normalizeExplicitUrl(input: string): WebBrowserAddressResult {
  if (/^file:/i.test(input) && !input.startsWith('file:///')) {
    return { ok: false, reason: 'invalid-url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.href === WEB_BROWSER_INITIAL_URL) {
    return { ok: false, reason: 'reserved-url' };
  }

  if (parsed.protocol === 'file:') {
    return parsed.hostname === ''
      ? { ok: true, url: parsed.href }
      : { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  return { ok: true, url: parsed.href };
}

export function parseWebBrowserAddress(input: string): WebBrowserAddressResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }
  if (isAbsoluteFilesystemPath(trimmed)) {
    return { ok: false, reason: 'absolute-path' };
  }

  const hasExplicitScheme = SCHEME_PATTERN.test(trimmed)
    && !HOST_WITH_NUMERIC_PORT_PATTERN.test(trimmed);
  return normalizeExplicitUrl(hasExplicitScheme ? trimmed : `https://${trimmed}`);
}

export function normalizeWebBrowserTopLevelUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || isAbsoluteFilesystemPath(trimmed) || !SCHEME_PATTERN.test(trimmed)) {
    return null;
  }

  const result = normalizeExplicitUrl(trimmed);
  return result.ok ? result.url : null;
}

export function canOpenWebBrowserExternally(input: string): boolean {
  return normalizeWebBrowserTopLevelUrl(input) !== null;
}
