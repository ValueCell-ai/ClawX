import { createHash, randomBytes } from 'crypto';
import { createServer, type Server } from 'http';
import { proxyAwareFetch } from './proxy-fetch';

export const TOKENDANCE_APP_URL = 'https://clawx.com.cn';
export const TOKENDANCE_AUTH_URL = 'https://tokendance.space/auth';
export const TOKENDANCE_KEY_EXCHANGE_URL = 'https://tokendance.space/portal/api/v1/auth/keys';
export const TOKENDANCE_GATEWAY_BASE_URL = 'https://tokendance.space/gateway/v1';
export const TOKENDANCE_DEFAULT_MODEL = 'qwen3.8-max';
export const TOKENDANCE_APP_HEADER = { 'X-App-URL': TOKENDANCE_APP_URL } as const;

const OAUTH_TIMEOUT_MS = 10 * 60 * 1_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type TokenDanceOAuthResult = {
  apiKey: string;
};

export type TokenDanceOAuthOptions = {
  openUrl: (url: string) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  onAuthorizationUrl?: (url: string) => void;
  onProgress?: (message: string) => void;
};

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createTokenDancePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash('sha256').update(verifier, 'ascii').digest());
  return { verifier, challenge };
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function abortError(message = 'tokendanceOAuth.cancelled'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

type CallbackCopy = {
  lang: string;
  title: string;
  description: string;
  closeHint: string;
};

const CALLBACK_COPY: Record<string, CallbackCopy> = {
  en: {
    lang: 'en',
    title: 'Authorization successful',
    description: 'TokenDance has been connected to ClawX.',
    closeHint: 'You can close this page and return to ClawX.',
  },
  zh: {
    lang: 'zh-CN',
    title: '授权成功',
    description: 'TokenDance 已成功连接到 ClawX。',
    closeHint: '现在可以关闭此页面并返回 ClawX。',
  },
  ja: {
    lang: 'ja',
    title: '認証が完了しました',
    description: 'TokenDance が ClawX に接続されました。',
    closeHint: 'このページを閉じて ClawX に戻ることができます。',
  },
  ru: {
    lang: 'ru',
    title: 'Авторизация выполнена',
    description: 'TokenDance успешно подключён к ClawX.',
    closeHint: 'Можно закрыть эту страницу и вернуться в ClawX.',
  },
};

function renderSuccessPage(acceptLanguage: string | string[] | undefined): string {
  const requestedLanguage = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  const language = requestedLanguage?.trim().toLowerCase() || 'en';
  const locale = language.startsWith('zh')
    ? 'zh'
    : language.startsWith('ja')
      ? 'ja'
      : language.startsWith('ru')
        ? 'ru'
        : 'en';
  const copy = CALLBACK_COPY[locale];

  return `<!doctype html>
<html lang="${copy.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ClawX · TokenDance</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f7f7f5; color: #171717; }
    main { width: min(420px, calc(100vw - 48px)); padding: 40px; text-align: center; border-radius: 24px; background: #fff; box-shadow: 0 18px 60px rgba(0,0,0,.12); }
    .mark { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 50%; background: #18181b; color: #fff; font-size: 30px; }
    h1 { margin: 0 0 12px; font-size: 26px; font-weight: 650; }
    p { margin: 6px 0; color: #52525b; line-height: 1.6; }
    @media (prefers-color-scheme: dark) { body { background: #111; color: #fafafa; } main { background: #1c1c1e; } p { color: #b3b3b8; } .mark { background: #fafafa; color: #18181b; } }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">✓</div>
    <h1>${copy.title}</h1>
    <p>${copy.description}</p>
    <p>${copy.closeHint}</p>
  </main>
  <script>window.setTimeout(() => window.close(), 3000)</script>
</body>
</html>`;
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('tokendanceOAuth.callbackUnavailable');
  }
  return address.port;
}

export async function loginTokenDanceOAuth(
  options: TokenDanceOAuthOptions,
): Promise<TokenDanceOAuthResult> {
  if (options.signal?.aborted) throw abortError();

  const { verifier, challenge } = createTokenDancePkce();
  const flowId = base64Url(randomBytes(24));
  let settleCode: ((code: string) => void) | null = null;
  let rejectCode: ((error: Error) => void) | null = null;
  let settled = false;

  const codePromise = new Promise<string>((resolve, reject) => {
    settleCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const code = requestUrl.searchParams.get('code')?.trim();
      const callbackFlowId = requestUrl.searchParams.get('flow_id');
      if (requestUrl.pathname !== '/callback' || callbackFlowId !== flowId || !code) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end();
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      });
      response.end(renderSuccessPage(request.headers['accept-language']));
      if (!settled) {
        settled = true;
        options.onProgress?.('TokenDance authorization callback received');
        settleCode?.(code);
      }
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end();
      if (!settled) {
        settled = true;
        rejectCode?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  const timeoutMs = options.timeoutMs ?? OAUTH_TIMEOUT_MS;
  let timeout: NodeJS.Timeout | undefined;
  const onAbort = () => {
    if (!settled) {
      settled = true;
      rejectCode?.(abortError());
    }
  };

  try {
    const port = await listenOnLoopback(server);
    const callbackUrl = new URL(`http://127.0.0.1:${port}/callback`);
    callbackUrl.searchParams.set('flow_id', flowId);

    const authorizationUrl = new URL(TOKENDANCE_AUTH_URL);
    authorizationUrl.searchParams.set('callback_url', callbackUrl.toString());
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('app_url', TOKENDANCE_APP_URL);
    authorizationUrl.searchParams.set('key_name', 'ClawX');

    options.signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectCode?.(new Error('tokendanceOAuth.timedOut'));
      }
    }, timeoutMs);

    options.onAuthorizationUrl?.(authorizationUrl.toString());
    await options.openUrl(authorizationUrl.toString());
    const code = await codePromise;

    const fetchImpl = options.fetchImpl ?? proxyAwareFetch;
    const exchangeStartedAt = Date.now();
    const exchangeResponse = await fetchImpl(TOKENDANCE_KEY_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
      signal: options.signal,
    });

    if (!exchangeResponse.ok) {
      throw new Error(`tokendanceOAuth.exchangeFailed:${exchangeResponse.status}`);
    }

    const payload = await exchangeResponse.json().catch(() => null) as { key?: unknown } | null;
    const apiKey = typeof payload?.key === 'string' ? payload.key.trim() : '';
    if (!apiKey) {
      throw new Error('tokendanceOAuth.missingKey');
    }
    options.onProgress?.(`TokenDance API key exchange completed in ${Date.now() - exchangeStartedAt}ms`);
    return { apiKey };
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
    await closeServer(server);
  }
}
