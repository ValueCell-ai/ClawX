/**
 * Build the external OpenClaw Control UI URL.
 *
 * OpenClaw 2026.3.13 imports one-time auth tokens from the URL fragment
 * (`#token=...`) and strips them after load. Query-string tokens are removed
 * by the UI bootstrap but are not imported for auth.
 */
export type OpenClawControlUiView = 'dreams';

type OpenClawControlUiUrlOptions = {
  view?: OpenClawControlUiView;
};

const CONTROL_UI_VIEW_PATHS: Record<OpenClawControlUiView, string> = {
  dreams: '/dreaming',
};

export function buildOpenClawControlUiUrl(
  port: number,
  token: string,
  options: OpenClawControlUiUrlOptions = {},
): string {
  const path = options.view ? CONTROL_UI_VIEW_PATHS[options.view] : '/';
  const url = new URL(path, `http://127.0.0.1:${port}`);
  const trimmedToken = token.trim();

  if (trimmedToken) {
    url.hash = new URLSearchParams({ token: trimmedToken }).toString();
  }

  return url.toString();
}
