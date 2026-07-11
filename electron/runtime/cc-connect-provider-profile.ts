import { access, chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { getProviderAccount, getDefaultProviderAccountId } from '@electron/services/providers/provider-store';
import { getProviderSecret, getSecretStore } from '@electron/services/secrets/secret-store';
import { getProviderDefaultModel } from '@electron/utils/provider-registry';
import type { ProviderAccount, ProviderSecret } from '@electron/shared/providers/types';
import {
  getCcConnectAccountCodexHomeDir,
  getCcConnectCodexHomeDir,
  getCcConnectProviderProfilePath,
} from './cc-connect-paths';

export type CodexProviderProfile = {
  providerId: string | null;
  vendorId: string | null;
  label?: string;
  authMode?: string;
  model?: string;
  modelRef?: string;
  supported: boolean;
  unsupportedReason?: string;
  codexArgs: string[];
  env?: Record<string, string>;
  envKeys?: string[];
  launcherEnv?: Record<string, string>;
  ccConnectProvider?: {
    name: string;
    apiKeyEnvKey?: string;
    baseUrl?: string;
    model?: string;
    wireApi?: 'responses';
  };
  secretAvailable: boolean;
  codexHomeDir?: string;
  updatedAt: string;
};

type OpenAIOAuthTokenSet = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string;
};

type OpenAIOAuthTokenResolution = {
  tokens: OpenAIOAuthTokenSet;
  source: 'managed' | 'secret';
};

export type CodexOAuthAuthFileSummary = {
  path: string;
  exists: boolean;
  complete: boolean;
  accountId?: string;
  authMode?: string;
  lastRefresh?: string;
  updatedAt?: string;
  error?: string;
};

export type CodexOAuthProviderSummary = {
  accountId: string;
  vendorId: string;
  authMode?: string;
  hasOAuthSecret: boolean;
  subject?: string;
  email?: string;
  managedMatchesAccount?: boolean;
  userMatchesAccount?: boolean;
};

export type CodexOAuthStatus = {
  success: true;
  managedCodexHome: string;
  authPath: string;
  managed: CodexOAuthAuthFileSummary;
  user: CodexOAuthAuthFileSummary;
  provider?: CodexOAuthProviderSummary;
};

function resolveModel(account: ProviderAccount): string | undefined {
  const model = account.model?.trim();
  if (model) return model;
  return getProviderDefaultModel(account.vendorId)?.trim() || undefined;
}

function publicProfile(profile: CodexProviderProfile): CodexProviderProfile {
  const { env, ...rest } = profile;
  return {
    ...rest,
    envKeys: Object.keys(env ?? {}),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlInlineStringMap(values: Record<string, string>): string {
  return `{ ${Object.entries(values).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`).join(', ')} }`;
}

function normalizeOpenAIResponsesBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/responses$/i, '');
}

function normalizeModelHubCodexResponsesBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'aidp.bytedance.net') return null;
    if (!url.pathname.startsWith('/api/modelhub/online')) return null;
    url.pathname = '/api/modelhub/online';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function writeManagedCodexResponsesConfig(options: {
  accountId: string;
  providerKey: string;
  providerName: string;
  baseUrl: string;
  envKey: string;
  model?: string;
  envHttpHeaders?: Record<string, string>;
  modelReasoningEffort?: string;
}): Promise<string> {
  const codexHomeDir = getCcConnectAccountCodexHomeDir(options.accountId);
  await mkdir(codexHomeDir, { recursive: true });
  const configPath = join(codexHomeDir, 'config.toml');
  const tableKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(options.providerKey)
    ? options.providerKey
    : tomlString(options.providerKey);
  const envHeaderEntries = Object.entries(options.envHttpHeaders ?? {});
  const lines = [
    ...(options.model ? [`model = ${tomlString(options.model)}`] : []),
    `model_provider = ${tomlString(options.providerKey)}`,
    ...(options.modelReasoningEffort ? [`model_reasoning_effort = ${tomlString(options.modelReasoningEffort)}`] : []),
    '',
    `[model_providers.${tableKey}]`,
    `name = ${tomlString(options.providerName)}`,
    `base_url = ${tomlString(options.baseUrl)}`,
    `env_key = ${tomlString(options.envKey)}`,
    'wire_api = "responses"',
    ...(envHeaderEntries.length > 0
      ? [`env_http_headers = ${tomlInlineStringMap(options.envHttpHeaders ?? {})}`]
      : []),
    '',
  ];
  await writeFile(configPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => {});
  return codexHomeDir;
}

function stableModelHubSessionId(account: ProviderAccount): string {
  return `clawx-cc-connect-${account.id}`;
}

function sanitizedEnvKeyPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return sanitized || 'HEADER';
}

function accountScopedEnvKey(accountId: string, purpose: string): string {
  return `CLAWX_CODEX_${sanitizedEnvKeyPart(accountId)}_${sanitizedEnvKeyPart(purpose)}`;
}

function buildCustomHeaderEnv(account: ProviderAccount, options?: { exclude?: Set<string> }): {
  env: Record<string, string>;
  envHttpHeaders: Record<string, string>;
} {
  const entries = Object.entries(account.headers ?? {})
    .map(([name, value]) => [name.trim(), String(value ?? '').trim()] as const)
    .filter(([name, value]) => name && value)
    .filter(([name]) => !options?.exclude?.has(name.toLowerCase()));
  const env: Record<string, string> = {};
  const envHttpHeaders: Record<string, string> = {};
  const used = new Set<string>();
  for (const [name, value] of entries) {
    const baseKey = accountScopedEnvKey(account.id, `HEADER_${name}`);
    let envKey = baseKey;
    let index = 2;
    while (used.has(envKey)) {
      envKey = `${baseKey}_${index}`;
      index += 1;
    }
    used.add(envKey);
    env[envKey] = value;
    envHttpHeaders[name] = envKey;
  }
  return { env, envHttpHeaders };
}

function extractSessionIdFromExtraHeader(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const sessionId = (parsed as Record<string, unknown>).session_id;
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
  } catch {
    return undefined;
  }
}

function buildModelHubEnv(account: ProviderAccount, apiKey: string): {
  env: Record<string, string>;
  envHttpHeaders: Record<string, string>;
} {
  const apiKeyEnvKey = accountScopedEnvKey(account.id, 'API_KEY');
  const extraHeaderEnvKey = accountScopedEnvKey(account.id, 'EXTRA_HEADER');
  const stickySessionEnvKey = accountScopedEnvKey(account.id, 'STICKY_SESSION_ID');
  const customHeaders = buildCustomHeaderEnv(account, { exclude: new Set(['api-key', 'extra']) });
  const existingExtraHeader = account.headers?.extra?.trim();
  const sessionId = existingExtraHeader
    ? extractSessionIdFromExtraHeader(existingExtraHeader) ?? stableModelHubSessionId(account)
    : stableModelHubSessionId(account);
  const extraHeader = existingExtraHeader || JSON.stringify({ session_id: sessionId });
  return {
    env: {
      [apiKeyEnvKey]: apiKey,
      ...customHeaders.env,
      [extraHeaderEnvKey]: extraHeader,
      [stickySessionEnvKey]: sessionId,
    },
    envHttpHeaders: {
      ...customHeaders.envHttpHeaders,
      'Api-Key': apiKeyEnvKey,
      extra: extraHeaderEnvKey,
    },
  };
}

function getUserCodexAuthPath(): string {
  const e2eOverride = process.env.CLAWX_E2E_USER_CODEX_AUTH_JSON?.trim();
  if (process.env.CLAWX_E2E === '1' && e2eOverride) {
    return e2eOverride;
  }
  return join(app.getPath('home'), '.codex', 'auth.json');
}

async function ensureAccountCodexHome(accountId: string): Promise<string> {
  const accountHome = getCcConnectAccountCodexHomeDir(accountId);
  await mkdir(accountHome, { recursive: true });
  return accountHome;
}

async function migrateLegacyCodexHomeToAccount(accountId: string): Promise<void> {
  const accountHome = getCcConnectAccountCodexHomeDir(accountId);
  const legacyHome = getCcConnectCodexHomeDir();
  const accountExists = await access(accountHome).then(() => true).catch(() => false);
  if (accountExists) return;
  const legacyExists = await access(legacyHome).then(() => true).catch(() => false);
  if (!legacyExists) return;
  await mkdir(dirname(accountHome), { recursive: true });
  try {
    await rename(legacyHome, accountHome);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      await cp(legacyHome, accountHome, { recursive: true, force: false, errorOnExist: false });
      await rm(legacyHome, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

async function writeManagedOpenAIOAuthAuthFile(
  tokens: OpenAIOAuthTokenSet,
  accountId: string,
): Promise<string> {
  const codexHomeDir = getCcConnectAccountCodexHomeDir(accountId);
  await mkdir(codexHomeDir, { recursive: true });
  const authPath = join(codexHomeDir, 'auth.json');

  await writeFile(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId,
    },
    last_refresh: new Date().toISOString(),
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  await chmod(authPath, 0o600).catch(() => {});
  return codexHomeDir;
}

async function readCompleteCodexAuthTokens(authPath: string): Promise<OpenAIOAuthTokenSet | undefined> {
  try {
    const auth = JSON.parse(await readFile(authPath, 'utf8')) as {
      tokens?: {
        id_token?: unknown;
        access_token?: unknown;
        refresh_token?: unknown;
        account_id?: unknown;
      };
    };
    const tokens = auth.tokens;
    if (
      !tokens ||
      typeof tokens.id_token !== 'string' ||
      typeof tokens.access_token !== 'string' ||
      typeof tokens.refresh_token !== 'string' ||
      typeof tokens.account_id !== 'string' ||
      !tokens.id_token.trim() ||
      !tokens.access_token.trim() ||
      !tokens.refresh_token.trim() ||
      !tokens.account_id.trim()
    ) {
      return undefined;
    }
    return {
      idToken: tokens.id_token.trim(),
      accessToken: tokens.access_token.trim(),
      refreshToken: tokens.refresh_token.trim(),
      accountId: tokens.account_id.trim(),
    };
  } catch {
    return undefined;
  }
}

async function readCodexAuthSummary(authPath: string): Promise<CodexOAuthAuthFileSummary> {
  let raw: string;
  try {
    raw = await readFile(authPath, 'utf8');
  } catch {
    return { path: authPath, exists: false, complete: false };
  }

  const updatedAt = await stat(authPath)
    .then((fileStat) => fileStat.mtime.toISOString())
    .catch(() => undefined);

  try {
    const parsed = JSON.parse(raw) as {
      auth_mode?: unknown;
      tokens?: { account_id?: unknown };
      last_refresh?: unknown;
    };
    const tokens = await readCompleteCodexAuthTokens(authPath);
    return {
      path: authPath,
      exists: true,
      complete: Boolean(tokens),
      accountId: tokens?.accountId ?? (
        typeof parsed.tokens?.account_id === 'string' && parsed.tokens.account_id.trim()
          ? parsed.tokens.account_id.trim()
          : undefined
      ),
      authMode: typeof parsed.auth_mode === 'string' ? parsed.auth_mode : undefined,
      lastRefresh: typeof parsed.last_refresh === 'string' ? parsed.last_refresh : undefined,
      updatedAt,
    };
  } catch {
    return {
      path: authPath,
      exists: true,
      complete: false,
      updatedAt,
      error: 'Invalid Codex auth.json',
    };
  }
}

function codexTokensMatchAccount(
  tokens: OpenAIOAuthTokenSet,
  account: ProviderAccount,
  secret?: Extract<ProviderSecret, { type: 'oauth' }>,
): boolean {
  if (!secret) return true;

  const expectedAccountId = secret.subject?.trim();
  const userAccountId = tokens.accountId.trim();
  const accessMatches = tokens.accessToken === secret.accessToken;
  const refreshMatches = tokens.refreshToken === secret.refreshToken;
  const accountMatches = Boolean(expectedAccountId && userAccountId && expectedAccountId === userAccountId);
  const providerIdMatches = Boolean(userAccountId && account.id === userAccountId);

  return accessMatches || refreshMatches || accountMatches || providerIdMatches;
}

async function resolveProviderAccount(accountId?: string): Promise<{
  account: ProviderAccount | null;
  secret?: Extract<ProviderSecret, { type: 'oauth' }>;
}> {
  const resolvedAccountId = accountId?.trim() || await getDefaultProviderAccountId();
  const account = resolvedAccountId ? await getProviderAccount(resolvedAccountId) : null;
  const secret = account ? await getProviderSecret(account.id) : null;
  return {
    account,
    secret: secret?.type === 'oauth' && secret.accessToken && secret.refreshToken ? secret : undefined,
  };
}

async function resolveOpenAIOAuthTokens(
  account: ProviderAccount,
  secret?: Extract<ProviderSecret, { type: 'oauth' }>,
): Promise<OpenAIOAuthTokenResolution | undefined> {
  const managedAuthPath = join(await ensureAccountCodexHome(account.id), 'auth.json');
  const managedTokens = await readCompleteCodexAuthTokens(managedAuthPath);
  if (managedTokens && codexTokensMatchAccount(managedTokens, account, secret)) {
    return { tokens: managedTokens, source: 'managed' };
  }

  if (!secret) return undefined;

  const stored = secret.idToken?.trim();
  if (stored) {
    return {
      tokens: {
        idToken: stored,
        accessToken: secret.accessToken,
        refreshToken: secret.refreshToken,
        accountId: secret.subject?.trim() || account.id,
      },
      source: 'secret',
    };
  }

  return undefined;
}

export async function getCcConnectCodexOAuthStatus(payload?: {
  accountId?: string;
}): Promise<CodexOAuthStatus> {
  const { account, secret } = await resolveProviderAccount(payload?.accountId);
  const resolvedAccountId = account?.id ?? payload?.accountId?.trim() ?? 'default';
  const managedCodexHome = await ensureAccountCodexHome(resolvedAccountId);
  const authPath = join(managedCodexHome, 'auth.json');
  const userAuthPath = getUserCodexAuthPath();
  const [managed, user] = await Promise.all([
    readCodexAuthSummary(authPath),
    readCodexAuthSummary(userAuthPath),
  ]);

  const managedTokens = account ? await readCompleteCodexAuthTokens(authPath) : undefined;
  const userTokens = account ? await readCompleteCodexAuthTokens(userAuthPath) : undefined;

  return {
    success: true,
    managedCodexHome,
    authPath,
    managed,
    user,
    ...(account ? {
      provider: {
        accountId: account.id,
        vendorId: account.vendorId,
        authMode: account.authMode,
        hasOAuthSecret: Boolean(secret),
        subject: secret?.subject,
        email: secret?.email,
        managedMatchesAccount: managedTokens ? codexTokensMatchAccount(managedTokens, account, secret) : undefined,
        userMatchesAccount: userTokens ? codexTokensMatchAccount(userTokens, account, secret) : undefined,
      },
    } : {}),
  };
}

export async function importUserCodexOAuthToManagedHome(payload?: {
  accountId?: string;
}): Promise<CodexOAuthStatus> {
  const { account, secret } = await resolveProviderAccount(payload?.accountId);
  const userAuthPath = getUserCodexAuthPath();
  const tokens = await readCompleteCodexAuthTokens(userAuthPath);
  if (!tokens) {
    throw new Error(`No complete Codex OAuth auth.json found at ${userAuthPath}`);
  }
  if (account && !codexTokensMatchAccount(tokens, account, secret)) {
    throw new Error('Local Codex OAuth credentials do not match the selected provider account');
  }
  await writeManagedOpenAIOAuthAuthFile(tokens, account?.id ?? payload?.accountId?.trim() ?? 'default');
  return getCcConnectCodexOAuthStatus({ accountId: account?.id ?? payload?.accountId });
}

export async function logoutCcConnectCodexOAuth(payload?: {
  accountId?: string;
  managedOnly?: boolean;
}): Promise<CodexOAuthStatus> {
  const { account } = await resolveProviderAccount(payload?.accountId);
  const accountId = account?.id ?? payload?.accountId?.trim() ?? 'default';
  const managedHome = await ensureAccountCodexHome(accountId);
  await rm(join(managedHome, 'auth.json'), { force: true });
  if (!payload?.managedOnly && account?.authMode === 'oauth_browser') {
    await getSecretStore().delete(account.id);
  }
  return getCcConnectCodexOAuthStatus({ accountId });
}

async function buildProfileForAccount(account: ProviderAccount): Promise<CodexProviderProfile> {
  const secret = await getProviderSecret(account.id);
  const model = resolveModel(account);
  const base = {
    providerId: account.id,
    vendorId: account.vendorId,
    label: account.label,
    authMode: account.authMode,
    model,
    modelRef: model ? `${account.vendorId}/${model}` : undefined,
    secretAvailable: Boolean(secret),
    updatedAt: new Date().toISOString(),
  };

  if (account.vendorId === 'openai') {
    if (account.authMode === 'oauth_browser') {
      const oauthSecret = secret?.type === 'oauth' && secret.accessToken && secret.refreshToken
        ? secret
        : undefined;
      const tokenResolution = await resolveOpenAIOAuthTokens(account, oauthSecret);
      if (!tokenResolution) {
        return {
          ...base,
          supported: false,
          unsupportedReason: 'Codex OAuth credentials are missing. Sign in to Codex using the ClawX-managed CODEX_HOME or sign in to OpenAI again before using cc-connect Codex runtime.',
          codexArgs: [],
        };
      }
      const codexHomeDir = tokenResolution.source === 'managed'
        ? await ensureAccountCodexHome(account.id)
        : await writeManagedOpenAIOAuthAuthFile(tokenResolution.tokens, account.id);
      return {
        ...base,
        supported: true,
        codexArgs: model ? ['--model', model] : [],
        env: { CODEX_HOME: codexHomeDir },
        codexHomeDir,
        secretAvailable: true,
      };
    }

    const env: Record<string, string> = {};
    const apiKeyEnvKey = accountScopedEnvKey(account.id, 'API_KEY');
    if ((secret?.type === 'api_key' || secret?.type === 'local') && secret.apiKey) {
      env[apiKeyEnvKey] = secret.apiKey;
    }
    if (!env[apiKeyEnvKey]) {
      return {
        ...base,
        supported: false,
        unsupportedReason: 'OpenAI API key credentials are missing. Add an OpenAI API key before using the cc-connect Codex runtime with this provider.',
        codexArgs: [],
      };
    }
    const baseUrl = account.baseUrl?.trim();
    if (baseUrl) {
      const providerKey = 'clawx-openai';
      const normalizedBaseUrl = normalizeOpenAIResponsesBaseUrl(baseUrl);
      const codexHomeDir = await writeManagedCodexResponsesConfig({
        accountId: account.id,
        providerKey,
        providerName: 'OpenAI',
        baseUrl: normalizedBaseUrl,
        envKey: apiKeyEnvKey,
        model,
      });
      return {
        ...base,
        supported: true,
        codexArgs: [
          '-c',
          `model_provider=${tomlString(providerKey)}`,
          '-c',
          `model_providers.${providerKey}.name="OpenAI"`,
          '-c',
          `model_providers.${providerKey}.base_url=${tomlString(normalizedBaseUrl)}`,
          '-c',
          `model_providers.${providerKey}.env_key=${tomlString(apiKeyEnvKey)}`,
          '-c',
          `model_providers.${providerKey}.wire_api="responses"`,
          ...(model ? ['--model', model] : []),
        ],
        env: {
          ...env,
          CODEX_HOME: codexHomeDir,
        },
        codexHomeDir,
        launcherEnv: { OPENAI_API_KEY: apiKeyEnvKey },
        ccConnectProvider: {
          name: providerKey,
          apiKeyEnvKey,
          baseUrl: normalizedBaseUrl,
          wireApi: 'responses',
          ...(model ? { model } : {}),
        },
      };
    }
    const codexHomeDir = await ensureAccountCodexHome(account.id);
    return {
      ...base,
      supported: true,
      codexArgs: model ? ['--model', model] : [],
      env: { ...env, CODEX_HOME: codexHomeDir },
      codexHomeDir,
      launcherEnv: { OPENAI_API_KEY: apiKeyEnvKey },
      ccConnectProvider: {
        name: 'openai',
        apiKeyEnvKey,
        ...(model ? { model } : {}),
      },
    };
  }

  if (account.vendorId === 'custom') {
    const protocol = account.apiProtocol || 'openai-completions';
    if (protocol !== 'openai-responses') {
      return {
        ...base,
        supported: false,
        unsupportedReason: `cc-connect Codex runtime cannot use custom provider "${account.label}" because Codex 0.137 only supports the Responses wire API. This provider is configured for Chat Completions.`,
        codexArgs: [],
      };
    }

    const baseUrl = account.baseUrl?.trim();
    if (!baseUrl) {
      return {
        ...base,
        supported: false,
        unsupportedReason: `cc-connect Codex runtime cannot use custom provider "${account.label}" because a Responses-compatible base URL is required.`,
        codexArgs: [],
      };
    }

    if ((secret?.type !== 'api_key' && secret?.type !== 'local') || !secret.apiKey) {
      return {
        ...base,
        supported: false,
        unsupportedReason: `cc-connect Codex runtime cannot use custom provider "${account.label}" because its API key is missing.`,
        codexArgs: [],
      };
    }

    const modelHubBaseUrl = normalizeModelHubCodexResponsesBaseUrl(baseUrl);
    const providerKey = modelHubBaseUrl ? 'modelhub_openapi' : 'clawx-custom';
    const envKey = accountScopedEnvKey(account.id, 'API_KEY');
    const normalizedBaseUrl = modelHubBaseUrl ?? normalizeOpenAIResponsesBaseUrl(baseUrl);
    const customHeaders = modelHubBaseUrl
      ? buildModelHubEnv(account, secret.apiKey)
      : buildCustomHeaderEnv(account);
    const env: Record<string, string> = modelHubBaseUrl
      ? customHeaders.env
      : { [envKey]: secret.apiKey, ...customHeaders.env };
    const envHttpHeaders = Object.keys(customHeaders.envHttpHeaders).length > 0
      ? customHeaders.envHttpHeaders
      : undefined;
    const codexHomeDir = await writeManagedCodexResponsesConfig({
      accountId: account.id,
      providerKey,
      providerName: modelHubBaseUrl ? 'ByteDance ModelHub OpenAPI' : (account.label || 'Custom'),
      baseUrl: normalizedBaseUrl,
      envKey,
      model,
      envHttpHeaders,
      ...(modelHubBaseUrl ? { modelReasoningEffort: 'none' } : {}),
    });
    return {
      ...base,
      supported: true,
      codexArgs: [
        '-c',
        `model_provider=${tomlString(providerKey)}`,
        '-c',
        `model_providers.${providerKey}.name=${tomlString(modelHubBaseUrl ? 'ByteDance ModelHub OpenAPI' : (account.label || 'Custom'))}`,
        '-c',
        `model_providers.${providerKey}.base_url=${tomlString(normalizedBaseUrl)}`,
        '-c',
        `model_providers.${providerKey}.env_key=${tomlString(envKey)}`,
        '-c',
        `model_providers.${providerKey}.wire_api="responses"`,
        ...(modelHubBaseUrl ? [
          '-c',
          'model_reasoning_effort="none"',
        ] : []),
        ...(envHttpHeaders ? [
          '-c',
          `model_providers.${providerKey}.env_http_headers=${tomlInlineStringMap(envHttpHeaders)}`,
        ] : []),
        ...(model ? ['--model', model] : []),
      ],
      env: {
        ...env,
        CODEX_HOME: codexHomeDir,
      },
      codexHomeDir,
      ccConnectProvider: {
        name: providerKey,
        apiKeyEnvKey: envKey,
        baseUrl: normalizedBaseUrl,
        wireApi: 'responses',
        ...(model ? { model } : {}),
      },
    };
  }

  if (account.vendorId === 'ollama') {
    return {
      ...base,
      supported: true,
      codexArgs: [
        '--oss',
        '--local-provider',
        'ollama',
        ...(model ? ['--model', model] : []),
      ],
    };
  }

  return {
    ...base,
    supported: false,
    unsupportedReason: `cc-connect Codex runtime currently supports OpenAI/Codex and Ollama provider accounts; "${account.vendorId}" is not supported yet.`,
    codexArgs: [],
  };
}

export async function buildCcConnectProviderProfileForAccount(
  accountId: string,
): Promise<CodexProviderProfile> {
  const account = await getProviderAccount(accountId);
  if (account) return buildProfileForAccount(account);
  return {
    providerId: accountId,
    vendorId: null,
    supported: false,
    unsupportedReason: `Provider account "${accountId}" was not found`,
    codexArgs: [],
    secretAvailable: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function syncCcConnectProviderProfile(
  payload?: { providerId?: string; reason?: string },
): Promise<CodexProviderProfile> {
  const providerId = payload?.providerId?.trim() || await getDefaultProviderAccountId();
  const account = providerId ? await getProviderAccount(providerId) : null;
  if (account?.vendorId === 'openai' && account.authMode === 'oauth_browser') {
    await migrateLegacyCodexHomeToAccount(account.id);
  }
  const profile: CodexProviderProfile = account
    ? await buildProfileForAccount(account)
    : {
        providerId: null,
        vendorId: null,
        supported: true,
        codexArgs: [],
        secretAvailable: false,
        updatedAt: new Date().toISOString(),
      };

  const profilePath = getCcConnectProviderProfilePath();
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(profilePath, JSON.stringify({
    ...publicProfile(profile),
    reason: payload?.reason ?? 'sync',
  }, null, 2), 'utf8');
  return profile;
}

export function toPublicCodexProviderProfile(profile: CodexProviderProfile): CodexProviderProfile {
  return publicProfile(profile);
}
