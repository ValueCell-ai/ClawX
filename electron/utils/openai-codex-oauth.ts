/**
 * OpenAI Codex OAuth PKCE flow.
 *
 * Implements the same flow as OpenClaw's openai-codex auth extension
 * but runs natively in Electron's main process (no TTY required).
 *
 * Client ID and endpoints are hardcoded to match the upstream extension
 * in @mariozechner/pi-ai.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { shell } from 'electron';
import { logger } from './logger';

// ── OAuth constants (matches openclaw/extensions/openai-codex) ──
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const REDIRECT_PORT = 1455;
const SCOPES = 'openid profile email offline_access';
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── PKCE ──

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── Callback server ──

function waitForLocalCallback(
  expectedState: string,
  timeoutMs: number,
): Promise<{ code: string; server: Server }> {
  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    let settled = false;

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);
        if (requestUrl.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code')?.trim();
        const state = requestUrl.searchParams.get('state')?.trim();

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body><h2>Authentication Failed</h2><p>${error}</p></body></html>`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h2>Missing code or state</h2></body></html>');
          finish(new Error('Missing OAuth code or state'));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h2>Invalid state</h2></body></html>');
          finish(new Error('OAuth state mismatch'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><html><body>' +
          '<h2>Authentication successful!</h2>' +
          '<p>You can close this window and return to ClawX.</p>' +
          '</body></html>'
        );
        finish(undefined, code);
      } catch (err) {
        finish(err instanceof Error ? err : new Error('OAuth callback failed'));
      }
    });

    const finish = (err?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (err) {
        try { server.close(); } catch { /* ignore */ }
        reject(err);
      } else if (code) {
        resolve({ code, server });
      }
    };

    server.once('error', (err) => {
      finish(err instanceof Error ? err : new Error('OAuth callback server error'));
    });

    server.listen(REDIRECT_PORT, 'localhost', () => {
      logger.info(`OpenAI Codex OAuth callback server listening on ${REDIRECT_URI}`);
    });

    timeout = setTimeout(() => {
      finish(new Error('OAuth timeout: no browser response within 5 minutes'));
    }, timeoutMs);
  });
}

// ── Token exchange ──

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!data.access_token) {
    throw new Error('No access token received');
  }

  return data;
}

// ── JWT decode (extract accountId from access token) ──

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function extractAccountId(accessToken: string): string | undefined {
  try {
    const payload = decodeJwtPayload(accessToken);
    const authClaim = payload['https://api.openai.com/auth'] as
      | { chatgpt_account_id?: string }
      | undefined;
    return authClaim?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

// ── Auth profile persistence ──

function writeAuthProfile(credential: {
  access: string;
  refresh?: string;
  expires: number;
  accountId?: string;
}): void {
  const openclawDir = join(homedir(), '.openclaw', 'agents', 'main', 'agent');
  const authProfilesPath = join(openclawDir, 'auth-profiles.json');
  mkdirSync(openclawDir, { recursive: true });

  let store: { version?: number; profiles?: Record<string, unknown> } = { version: 1, profiles: {} };
  if (existsSync(authProfilesPath)) {
    try {
      store = JSON.parse(readFileSync(authProfilesPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  if (!store.profiles || typeof store.profiles !== 'object') {
    store.profiles = {};
  }

  const profileId = 'openai-codex:default';

  store.profiles[profileId] = {
    type: 'oauth',
    provider: 'openai-codex',
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
    accountId: credential.accountId,
  };

  writeFileSync(authProfilesPath, JSON.stringify(store, null, 2), 'utf-8');
}

// ── Public API ──

export async function runOpenAICodexOAuthFlow(): Promise<{
  success: boolean;
  error?: string;
}> {
  // 1. Generate PKCE
  logger.info('Starting OpenAI Codex OAuth PKCE flow');
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString('hex');

  // 2. Build auth URL
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Extra params required by the Codex flow
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
    originator: 'pi',
  });
  const authUrl = `${AUTH_URL}?${params}`;

  // 3. Start callback server, then open browser
  const callbackPromise = waitForLocalCallback(state, CALLBACK_TIMEOUT_MS);

  // Small delay to ensure server is listening before opening browser
  await new Promise((r) => setTimeout(r, 300));
  logger.info('Opening browser for OpenAI Codex OAuth consent');
  await shell.openExternal(authUrl);

  // 4. Wait for callback
  const { code, server } = await callbackPromise;
  server.close();
  logger.info('Received OAuth callback with authorization code');

  // 5. Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code, verifier);
  logger.info('Token exchange successful');

  // 6. Extract accountId from JWT
  const accountId = extractAccountId(tokens.access_token);
  logger.info(`OpenAI Codex account: ${accountId || 'unknown'}`);

  // 7. Write auth profile
  const expires = Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000;
  writeAuthProfile({
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires,
    accountId,
  });
  logger.info('OpenAI Codex OAuth credentials saved to auth-profiles.json');

  return { success: true };
}
