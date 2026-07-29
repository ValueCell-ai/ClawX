export const WEB_BROWSER_PARTITION = 'persist:clawx-web-browser' as const;
export const WEB_BROWSER_INITIAL_URL = 'about:blank' as const;
export const WEB_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.236 Electron/40.8.4 Safari/537.36' as const;

export type WebBrowserNavigatePayload = { url: string };

export function normalizeWebBrowserHtmlFileUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('file:///')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== 'file:'
    || parsed.hostname !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !/\.html?$/i.test(parsed.href)
  ) {
    return null;
  }

  return parsed.href;
}
