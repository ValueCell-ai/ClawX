import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join } from 'node:path';
import { getClawXConfigDir } from './paths';
import { proxyAwareFetch } from './proxy-fetch';

const CLIENT_ID_KEYS = ['OPENCLAW_GEMINI_OAUTH_CLIENT_ID', 'GEMINI_CLI_OAUTH_CLIENT_ID'];
const CLIENT_SECRET_KEYS = [
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET',
];
const REDIRECT_URI = 'http://127.0.0.1:8085/oauth2callback';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
const TIER_FREE = 'free-tier';
const TIER_LEGACY = 'legacy-tier';
const TIER_STANDARD = 'standard-tier';
const LOCAL_GEMINI_DIR = join(getClawXConfigDir(), 'gemini-cli');

export type GeminiCliOAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId?: string;
};

export type GeminiCliOAuthContext = {
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  log: (msg: string) => void;
  note: (message: string, title?: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
};

export class DetailedError extends Error {
  detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = 'DetailedError';
    this.detail = detail;
  }
}

let cachedGeminiCliCredentials: { clientId: string; clientSecret: string } | null = null;

function resolveEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function findInPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) {
        return p;
      }
    }
  }
  return null;
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth <= 0) {
    return null;
  }

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isFile() && entry.name === name) {
        return next;
      }
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = findFile(next, name, depth - 1);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function extractGeminiCliCredentials(): { clientId: string; clientSecret: string } | null {
  if (cachedGeminiCliCredentials) {
    return cachedGeminiCliCredentials;
  }

  try {
    const geminiPath = findInPath('gemini');
    if (!geminiPath) {
      return null;
    }

    const resolvedPath = realpathSync(geminiPath);
    const geminiCliDir = dirname(dirname(resolvedPath));
    const searchPaths = [
      join(
        geminiCliDir,
        'node_modules',
        '@google',
        'gemini-cli-core',
        'dist',
        'src',
        'code_assist',
        'oauth2.js',
      ),
      join(
        geminiCliDir,
        'node_modules',
        '@google',
        'gemini-cli-core',
        'dist',
        'code_assist',
        'oauth2.js',
      ),
    ];

    let content: string | null = null;
    for (const p of searchPaths) {
      if (existsSync(p)) {
        content = readFileSync(p, 'utf8');
        break;
      }
    }

    if (!content) {
      const found = findFile(geminiCliDir, 'oauth2.js', 10);
      if (found) {
        content = readFileSync(found, 'utf8');
      }
    }

    if (!content) {
      return null;
    }

    const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
    const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
    if (idMatch && secretMatch) {
      cachedGeminiCliCredentials = { clientId: idMatch[1], clientSecret: secretMatch[1] };
      return cachedGeminiCliCredentials;
    }
  } catch {
    return null;
  }

  return null;
}

function extractFromLocalInstall(): { clientId: string; clientSecret: string } | null {
  const coreDir = join(LOCAL_GEMINI_DIR, 'node_modules', '@google', 'gemini-cli-core');
  if (!existsSync(coreDir)) {
    return null;
  }

  const searchPaths = [
    join(coreDir, 'dist', 'src', 'code_assist', 'oauth2.js'),
    join(coreDir, 'dist', 'code_assist', 'oauth2.js'),
  ];

  let content: string | null = null;
  for (const p of searchPaths) {
    if (existsSync(p)) {
      content = readFileSync(p, 'utf8');
      break;
    }
  }

  if (!content) {
    const found = findFile(coreDir, 'oauth2.js', 10);
    if (found) {
      content = readFileSync(found, 'utf8');
    }
  }

  if (!content) {
    return null;
  }

  const idMatch = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/);
  const secretMatch = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
  if (idMatch && secretMatch) {
    return { clientId: idMatch[1], clientSecret: secretMatch[1] };
  }

  return null;
}

async function installViaNpm(onProgress?: (msg: string) => void): Promise<boolean> {
  const npmBin = findInPath('npm');
  if (!npmBin) {
    return false;
  }

  onProgress?.('Installing Gemini OAuth helper...');

  return await new Promise((resolve) => {
    const useShell = process.platform === 'win32';
    const child = execFile(
      npmBin,
      ['install', '--prefix', LOCAL_GEMINI_DIR, '@google/gemini-cli'],
      { timeout: 120_000, shell: useShell, env: { ...process.env, NODE_ENV: '' } },
      (err) => {
        if (err) {
          onProgress?.(`Gemini helper install failed, falling back to direct download...`);
          resolve(false);
        } else {
          cachedGeminiCliCredentials = null;
          onProgress?.('Gemini OAuth helper installed');
          resolve(true);
        }
      },
    );
    child.stderr?.on('data', () => {
      // Suppress npm noise.
    });
  });
}

async function installViaDirectDownload(onProgress?: (msg: string) => void): Promise<boolean> {
  try {
    onProgress?.('Downloading Gemini OAuth helper...');
    const metaRes = await proxyAwareFetch('https://registry.npmjs.org/@google/gemini-cli-core/latest');
    if (!metaRes.ok) {
      onProgress?.(`Failed to fetch Gemini package metadata: ${metaRes.status}`);
      return false;
    }

    const meta = (await metaRes.json()) as { dist?: { tarball?: string } };
    const tarballUrl = meta.dist?.tarball;
    if (!tarballUrl) {
      onProgress?.('Gemini package tarball URL missing');
      return false;
    }

    const tarRes = await proxyAwareFetch(tarballUrl);
    if (!tarRes.ok) {
      onProgress?.(`Failed to download Gemini package: ${tarRes.status}`);
      return false;
    }

    const buffer = Buffer.from(await tarRes.arrayBuffer());
    const targetDir = join(LOCAL_GEMINI_DIR, 'node_modules', '@google', 'gemini-cli-core');
    mkdirSync(targetDir, { recursive: true });

    const tmpFile = join(LOCAL_GEMINI_DIR, '_tmp_gemini-cli-core.tgz');
    writeFileSync(tmpFile, buffer);
    try {
      execFileSync('tar', ['xzf', tmpFile, '-C', targetDir, '--strip-components=1'], {
        timeout: 30_000,
      });
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }

    cachedGeminiCliCredentials = null;
    onProgress?.('Gemini OAuth helper ready');
    return true;
  } catch (err) {
    onProgress?.(`Direct Gemini helper download failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function ensureOAuthClientConfig(
  onProgress?: (msg: string) => void,
): Promise<{ clientId: string; clientSecret?: string }> {
  const envClientId = resolveEnv(CLIENT_ID_KEYS);
  const envClientSecret = resolveEnv(CLIENT_SECRET_KEYS);
  if (envClientId) {
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  const extracted = extractGeminiCliCredentials();
  if (extracted) {
    return extracted;
  }

  const localExtracted = extractFromLocalInstall();
  if (localExtracted) {
    return localExtracted;
  }

  mkdirSync(LOCAL_GEMINI_DIR, { recursive: true });
  const installed = await installViaNpm(onProgress) || await installViaDirectDownload(onProgress);
  if (installed) {
    const installedExtracted = extractFromLocalInstall();
    if (installedExtracted) {
      return installedExtracted;
    }
  }

  throw new Error(
    'Unable to prepare Gemini OAuth credentials automatically. Set GEMINI_CLI_OAUTH_CLIENT_ID or try again later.',
  );
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthUrl(clientId: string, challenge: string, verifier: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function waitForLocalCallback(params: {
  expectedState: string;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ code: string; state: string }> {
  const port = 8085;
  const hostname = '127.0.0.1';
  const expectedPath = '/oauth2callback';

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', `http://${hostname}:${port}`);
        if (requestUrl.pathname !== expectedPath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error');
        const code = requestUrl.searchParams.get('code')?.trim();
        const state = requestUrl.searchParams.get('state')?.trim();

        if (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end(`Authentication failed: ${error}`);
          finish(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end('Missing code or state');
          finish(new Error('Missing OAuth code or state'));
          return;
        }

        if (state !== params.expectedState) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            "<!doctype html><html><head><meta charset='utf-8'/></head><body><h2>Session expired</h2><p>This authorization link is from a previous attempt. Please go back to ClawX and try again.</p></body></html>",
          );
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          "<!doctype html><html><head><meta charset='utf-8'/></head><body><h2>Gemini CLI OAuth complete</h2><p>You can close this window and return to ClawX.</p></body></html>",
        );

        finish(undefined, { code, state });
      } catch (err) {
        finish(err instanceof Error ? err : new Error('OAuth callback failed'));
      }
    });

    const finish = (err?: Error, result?: { code: string; state: string }) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      try {
        server.close();
      } catch {
        // ignore
      }
      if (err) {
        reject(err);
      } else if (result) {
        resolve(result);
      }
    };

    server.once('error', (err) => {
      finish(err instanceof Error ? err : new Error('OAuth callback server error'));
    });

    server.listen(port, hostname, () => {
      params.onProgress?.(`Waiting for OAuth callback on ${REDIRECT_URI}...`);
    });

    timeout = setTimeout(() => {
      finish(new DetailedError(
        'OAuth login timed out. The browser did not redirect back. Check if localhost:8085 is blocked.',
        `Waited ${params.timeoutMs / 1000}s for callback on ${hostname}:${port}`,
      ));
    }, params.timeoutMs);
  });
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await proxyAwareFetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const data = (await response.json()) as { email?: string };
      return data.email;
    }
  } catch {
    // ignore
  }

  return undefined;
}

function getDefaultTier(
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>,
): { id?: string } | undefined {
  if (!allowedTiers?.length) {
    return { id: TIER_LEGACY };
  }
  return allowedTiers.find((tier) => tier.isDefault) ?? { id: TIER_LEGACY };
}

function isVpcScAffected(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return false;
  }
  const details = (error as { details?: unknown[] }).details;
  if (!Array.isArray(details)) {
    return false;
  }
  return details.some(
    (item) =>
      typeof item === 'object'
      && item
      && (item as { reason?: string }).reason === 'SECURITY_POLICY_VIOLATED',
  );
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
): Promise<{ done?: boolean; response?: { cloudaicompanionProject?: { id?: string } } }> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await proxyAwareFetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operationName}`, { headers });
    if (!response.ok) {
      continue;
    }
    const data = (await response.json()) as {
      done?: boolean;
      response?: { cloudaicompanionProject?: { id?: string } };
    };
    if (data.done) {
      return data;
    }
  }

  throw new Error('Operation polling timeout');
}

async function discoverProject(accessToken: string): Promise<string> {
  const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'gl-node/clawx',
  };

  const loadBody = {
    cloudaicompanionProject: envProject,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      duetProject: envProject,
    },
  };

  let data: {
    currentTier?: { id?: string };
    cloudaicompanionProject?: string | { id?: string };
    allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  } = {};

  const response = await proxyAwareFetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
    method: 'POST',
    headers,
    body: JSON.stringify(loadBody),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    if (isVpcScAffected(errorPayload)) {
      data = { currentTier: { id: TIER_STANDARD } };
    } else {
      throw new Error(`loadCodeAssist failed: ${response.status} ${response.statusText}`);
    }
  } else {
    data = (await response.json()) as typeof data;
  }

  if (data.currentTier) {
    const project = data.cloudaicompanionProject;
    if (typeof project === 'string' && project) {
      return project;
    }
    if (typeof project === 'object' && project?.id) {
      return project.id;
    }
    if (envProject) {
      return envProject;
    }
  }

  const hasExistingTierButNoProject = !!data.currentTier;
  const tier = hasExistingTierButNoProject ? { id: TIER_FREE } : getDefaultTier(data.allowedTiers);
  const tierId = tier?.id || TIER_FREE;
  if (tierId !== TIER_FREE && !envProject) {
    throw new DetailedError(
      'Your Google account requires a Cloud project. Please create one and set GOOGLE_CLOUD_PROJECT.',
      `tierId=${tierId}, currentTier=${JSON.stringify(data.currentTier ?? null)}, allowedTiers=${JSON.stringify(data.allowedTiers)}`,
    );
  }

  const onboardBody: Record<string, unknown> = {
    tierId,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
    },
  };
  if (tierId !== TIER_FREE && envProject) {
    onboardBody.cloudaicompanionProject = envProject;
    (onboardBody.metadata as Record<string, unknown>).duetProject = envProject;
  }

  const onboardResponse = await proxyAwareFetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    method: 'POST',
    headers,
    body: JSON.stringify(onboardBody),
  });

  if (!onboardResponse.ok) {
    const respText = await onboardResponse.text().catch(() => '');
    throw new DetailedError(
      'Google project provisioning failed. Please try again later.',
      `onboardUser ${onboardResponse.status} ${onboardResponse.statusText}: ${respText}`,
    );
  }

  let lro = (await onboardResponse.json()) as {
    done?: boolean;
    name?: string;
    response?: { cloudaicompanionProject?: { id?: string } };
  };

  if (!lro.done && lro.name) {
    lro = await pollOperation(lro.name, headers);
  }

  const projectId = lro.response?.cloudaicompanionProject?.id;
  if (projectId) {
    return projectId;
  }
  if (envProject) {
    return envProject;
  }

  throw new DetailedError(
    'Could not discover or provision a Google Cloud project. Set GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID.',
    `tierId=${tierId}, onboardResponse=${JSON.stringify(lro)}, currentTier=${JSON.stringify(data.currentTier ?? null)}`,
  );
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  clientConfig: { clientId: string; clientSecret?: string },
): Promise<GeminiCliOAuthCredentials> {
  const { clientId, clientSecret } = clientConfig;
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const response = await proxyAwareFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    throw new Error('No refresh token received. Please try again.');
  }

  const email = await getUserEmail(data.access_token);
  const projectId = await discoverProject(data.access_token);
  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: expiresAt,
    projectId,
    email,
  };
}

export async function loginGeminiCliOAuth(
  ctx: GeminiCliOAuthContext,
): Promise<GeminiCliOAuthCredentials> {
  if (ctx.isRemote) {
    throw new Error('Remote/manual Gemini OAuth is not implemented in ClawX yet.');
  }

  await ctx.note(
    [
      'Browser will open for Google authentication.',
      'Sign in with your Google account for Gemini CLI access.',
      'The callback will be captured automatically on 127.0.0.1:8085.',
    ].join('\n'),
    'Gemini CLI OAuth',
  );

  ctx.progress.update('Preparing Google OAuth...');
  const clientConfig = await ensureOAuthClientConfig((msg) => ctx.progress.update(msg));
  const { verifier, challenge } = generatePkce();
  const authUrl = buildAuthUrl(clientConfig.clientId, challenge, verifier);
  ctx.progress.update('Complete sign-in in browser...');

  try {
    await ctx.openUrl(authUrl);
  } catch {
    ctx.log(`\nOpen this URL in your browser:\n\n${authUrl}\n`);
  }

  try {
    const { code } = await waitForLocalCallback({
      expectedState: verifier,
      timeoutMs: 5 * 60 * 1000,
      onProgress: (msg) => ctx.progress.update(msg),
    });
    ctx.progress.update('Exchanging authorization code for tokens...');
    return await exchangeCodeForTokens(code, verifier, clientConfig);
  } catch (err) {
    if (
      err instanceof Error
      && (err.message.includes('EADDRINUSE')
        || err.message.includes('port')
        || err.message.includes('listen'))
    ) {
      throw new Error(
        'Port 8085 is in use by another process. Close the other application using port 8085 and try again.',
        { cause: err },
      );
    }
    throw err;
  }
}

// Best-effort check to help with diagnostics if the user claims gemini is installed but PATH is stale.
export function detectGeminiCliVersion(): string | null {
  try {
    const geminiPath = findInPath('gemini');
    if (!geminiPath) {
      return null;
    }
    return execFileSync(geminiPath, ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
