import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { getProviderAccount, getDefaultProviderAccountId } from '@electron/services/providers/provider-store';
import { getProviderSecret } from '@electron/services/secrets/secret-store';
import { getProviderDefaultModel } from '@electron/utils/provider-registry';
import type { ProviderAccount, ProviderSecret } from '@electron/shared/providers/types';
import { getCcConnectCodexHomeDir, getCcConnectProviderProfilePath } from './cc-connect-paths';

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
  providerKey: string;
  providerName: string;
  baseUrl: string;
  envKey: string;
  model?: string;
  envHttpHeaders?: Record<string, string>;
  modelReasoningEffort?: string;
}): Promise<string> {
  const codexHomeDir = getCcConnectCodexHomeDir();
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
    const baseKey = `CLAWX_CODEX_HEADER_${sanitizedEnvKeyPart(name)}`;
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
  const apiKeyEnvKey = 'BYTEDANCE_OPENAI_API_KEY';
  const extraHeaderEnvKey = 'CODEX_MODELHUB_EXTRA_HEADER';
  const stickySessionEnvKey = 'CODEX_MODELHUB_STICKY_SESSION_ID';
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

async function writeManagedOpenAIOAuthAuthFile(
  tokens: OpenAIOAuthTokenSet,
): Promise<string> {
  const codexHomeDir = getCcConnectCodexHomeDir();
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

async function resolveOpenAIOAuthTokens(
  account: ProviderAccount,
  secret: Extract<ProviderSecret, { type: 'oauth' }>,
): Promise<OpenAIOAuthTokenSet | undefined> {
  const stored = secret.idToken?.trim();
  if (stored) {
    return {
      idToken: stored,
      accessToken: secret.accessToken,
      refreshToken: secret.refreshToken,
      accountId: secret.subject?.trim() || account.id,
    };
  }

  const authPath = join(app.getPath('home'), '.codex', 'auth.json');
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

    const expectedAccountId = secret.subject?.trim();
    const userAccountId = typeof tokens.account_id === 'string' ? tokens.account_id.trim() : '';
    const accessMatches = typeof tokens.access_token === 'string' && tokens.access_token === secret.accessToken;
    const refreshMatches = typeof tokens.refresh_token === 'string' && tokens.refresh_token === secret.refreshToken;
    const accountMatches = Boolean(expectedAccountId && userAccountId && expectedAccountId === userAccountId);
    const providerIdMatches = Boolean(userAccountId && account.id === userAccountId);

    if (accessMatches || refreshMatches || accountMatches || providerIdMatches) {
      return {
        idToken: tokens.id_token.trim(),
        accessToken: tokens.access_token.trim(),
        refreshToken: tokens.refresh_token.trim(),
        accountId: tokens.account_id.trim(),
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
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
      if (secret?.type !== 'oauth' || !secret.accessToken || !secret.refreshToken) {
        return {
          ...base,
          supported: false,
          unsupportedReason: 'OpenAI OAuth credentials are missing. Sign in to OpenAI again before using cc-connect Codex runtime.',
          codexArgs: [],
        };
      }
      const tokens = await resolveOpenAIOAuthTokens(account, secret);
      if (!tokens) {
        return {
          ...base,
          supported: false,
          unsupportedReason: 'OpenAI OAuth credentials are missing an id_token required by Codex. Sign in to OpenAI again before using cc-connect Codex runtime.',
          codexArgs: [],
        };
      }
      const codexHomeDir = await writeManagedOpenAIOAuthAuthFile(tokens);
      return {
        ...base,
        supported: true,
        codexArgs: model ? ['--model', model] : [],
        env: { CODEX_HOME: codexHomeDir },
        codexHomeDir,
      };
    }

    const env: Record<string, string> = {};
    if ((secret?.type === 'api_key' || secret?.type === 'local') && secret.apiKey) {
      env.OPENAI_API_KEY = secret.apiKey;
    }
    return {
      ...base,
      supported: true,
      codexArgs: model ? ['--model', model] : [],
      env,
      ccConnectProvider: {
        name: 'openai',
        ...(env.OPENAI_API_KEY ? { apiKeyEnvKey: 'OPENAI_API_KEY' } : {}),
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
    const envKey = modelHubBaseUrl ? 'BYTEDANCE_OPENAI_API_KEY' : 'CLAWX_CODEX_CUSTOM_API_KEY';
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

export async function syncCcConnectProviderProfile(
  payload?: { providerId?: string; reason?: string },
): Promise<CodexProviderProfile> {
  const providerId = payload?.providerId?.trim() || await getDefaultProviderAccountId();
  const account = providerId ? await getProviderAccount(providerId) : null;
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
