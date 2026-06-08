// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appPath = new Map<string, string>();
const getDefaultProviderAccountIdMock = vi.fn();
const getProviderAccountMock = vi.fn();
const getProviderSecretMock = vi.fn();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => appPath.get(name) ?? tmpdir()),
  },
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getDefaultProviderAccountId: (...args: unknown[]) => getDefaultProviderAccountIdMock(...args),
  getProviderAccount: (...args: unknown[]) => getProviderAccountMock(...args),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: (...args: unknown[]) => getProviderSecretMock(...args),
}));

describe('cc-connect provider profile sync', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    getDefaultProviderAccountIdMock.mockReset();
    getProviderAccountMock.mockReset();
    getProviderSecretMock.mockReset();
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-provider-profile-'));
    appPath.set('userData', tempDir);
    appPath.set('home', tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('converts OpenAI provider accounts to Codex model args without writing secrets to disk', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('openai-main');
    getProviderAccountMock.mockResolvedValue({
      id: 'openai-main',
      vendorId: 'openai',
      label: 'OpenAI',
      authMode: 'api_key',
      model: 'gpt-5.5',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'openai-main',
      apiKey: 'sk-secret-value',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    const profile = await syncCcConnectProviderProfile({ reason: 'set-default' });

    expect(profile).toMatchObject({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-secret-value' },
      secretAvailable: true,
      supported: true,
    });
    const profileFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
    expect(profileFile).toContain('"envKeys"');
    expect(profileFile).toContain('OPENAI_API_KEY');
    expect(profileFile).not.toContain('sk-secret-value');
  });

  it('converts OpenAI OAuth accounts to a managed Codex auth home without writing tokens to the public profile', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('openai-oauth');
    getProviderAccountMock.mockResolvedValue({
      id: 'openai-oauth',
      vendorId: 'openai',
      label: 'OpenAI OAuth',
      authMode: 'oauth_browser',
      model: 'gpt-5.5',
      enabled: true,
      isDefault: true,
      metadata: { email: 'user@example.com', resourceUrl: 'openai-codex' },
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'oauth',
      accountId: 'openai-oauth',
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      idToken: 'oauth-id-token',
      expiresAt: 1_780_000_000_000,
      email: 'user@example.com',
      subject: 'acct_123',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    const profile = await syncCcConnectProviderProfile({ reason: 'oauth-login' });

    const codexHome = join(tempDir, 'runtimes', 'cc-connect', 'codex-home');
    expect(profile).toMatchObject({
      providerId: 'openai-oauth',
      vendorId: 'openai',
      authMode: 'oauth_browser',
      model: 'gpt-5.5',
      codexArgs: ['--model', 'gpt-5.5'],
      env: { CODEX_HOME: codexHome },
      secretAvailable: true,
      supported: true,
    });

    const authFile = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')) as {
      auth_mode?: string;
      OPENAI_API_KEY?: string | null;
      tokens?: Record<string, string>;
    };
    expect(authFile).toEqual({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'oauth-id-token',
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        account_id: 'acct_123',
      },
      last_refresh: expect.any(String),
    });

    const profileFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
    expect(profileFile).toContain('CODEX_HOME');
    expect(profileFile).not.toContain('oauth-access-token');
    expect(profileFile).not.toContain('oauth-refresh-token');
    expect(profileFile).not.toContain('oauth-id-token');
  });

  it('imports a matching Codex id token for existing OpenAI OAuth secrets that predate idToken storage', async () => {
    await mkdir(join(tempDir, '.codex'), { recursive: true });
    await writeFile(join(tempDir, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'imported-id-token',
        access_token: 'imported-access-token',
        refresh_token: 'imported-refresh-token',
        account_id: 'acct_123',
      },
      last_refresh: '2026-06-07T00:00:00.000Z',
    }, null, 2), 'utf8');
    getDefaultProviderAccountIdMock.mockResolvedValue('openai-oauth');
    getProviderAccountMock.mockResolvedValue({
      id: 'openai-oauth',
      vendorId: 'openai',
      label: 'OpenAI OAuth',
      authMode: 'oauth_browser',
      model: 'gpt-5.5',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'oauth',
      accountId: 'openai-oauth',
      accessToken: 'oauth-access-token',
      refreshToken: 'oauth-refresh-token',
      expiresAt: 1_780_000_000_000,
      subject: 'acct_123',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    const profile = await syncCcConnectProviderProfile({ reason: 'runtime-start' });

    expect(profile).toMatchObject({
      supported: true,
      env: { CODEX_HOME: join(tempDir, 'runtimes', 'cc-connect', 'codex-home') },
    });
    const authFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'codex-home', 'auth.json'), 'utf8');
    expect(authFile).toContain('"id_token": "imported-id-token"');
    expect(authFile).toContain('"access_token": "imported-access-token"');
    expect(authFile).toContain('"refresh_token": "imported-refresh-token"');
    const profileFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
    expect(profileFile).not.toContain('imported-id-token');
    expect(profileFile).not.toContain('imported-access-token');
    expect(profileFile).not.toContain('imported-refresh-token');
  });

  it('converts Ollama provider accounts to Codex OSS local-provider args', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('ollama-local');
    getProviderAccountMock.mockResolvedValue({
      id: 'ollama-local',
      vendorId: 'ollama',
      label: 'Ollama',
      authMode: 'local',
      model: 'qwen3:latest',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue(null);
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    await expect(syncCcConnectProviderProfile()).resolves.toMatchObject({
      providerId: 'ollama-local',
      vendorId: 'ollama',
      model: 'qwen3:latest',
      codexArgs: ['--oss', '--local-provider', 'ollama', '--model', 'qwen3:latest'],
      supported: true,
    });
  });

  it('converts OpenAI-compatible custom responses providers to Codex provider config args', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('custom-responses');
    getProviderAccountMock.mockResolvedValue({
      id: 'custom-responses',
      vendorId: 'custom',
      label: 'Custom Responses',
      authMode: 'api_key',
      baseUrl: 'https://gateway.example/openai/responses',
      apiProtocol: 'openai-responses',
      model: 'gpt-custom',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-responses',
      apiKey: 'custom-secret-value',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    const profile = await syncCcConnectProviderProfile();

    expect(profile).toMatchObject({
      providerId: 'custom-responses',
      vendorId: 'custom',
      model: 'gpt-custom',
      supported: true,
      env: { CLAWX_CODEX_CUSTOM_API_KEY: 'custom-secret-value' },
      codexHomeDir: join(tempDir, 'runtimes', 'cc-connect', 'codex-home'),
      ccConnectProvider: {
        name: 'clawx-custom',
        apiKeyEnvKey: 'CLAWX_CODEX_CUSTOM_API_KEY',
        baseUrl: 'https://gateway.example/openai',
        model: 'gpt-custom',
        wireApi: 'responses',
      },
      secretAvailable: true,
    });
    expect(profile.codexArgs).toEqual([
      '-c',
      'model_provider="clawx-custom"',
      '-c',
      'model_providers.clawx-custom.name="Custom Responses"',
      '-c',
      'model_providers.clawx-custom.base_url="https://gateway.example/openai"',
      '-c',
      'model_providers.clawx-custom.env_key="CLAWX_CODEX_CUSTOM_API_KEY"',
      '-c',
      'model_providers.clawx-custom.wire_api="responses"',
      '--model',
      'gpt-custom',
    ]);
    const profileFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
    expect(profileFile).toContain('CLAWX_CODEX_CUSTOM_API_KEY');
    expect(profileFile).not.toContain('custom-secret-value');
    const codexConfig = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'codex-home', 'config.toml'), 'utf8');
    expect(codexConfig).toContain('model_provider = "clawx-custom"');
    expect(codexConfig).toContain('base_url = "https://gateway.example/openai"');
    expect(codexConfig).not.toContain('custom-secret-value');
  });

  it('maps ByteDance ModelHub custom providers to the Codex Responses endpoint with env header refs', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('modelhub-responses');
    getProviderAccountMock.mockResolvedValue({
      id: 'modelhub-responses',
      vendorId: 'custom',
      label: 'modelhub-openai',
      authMode: 'api_key',
      baseUrl: 'https://aidp.bytedance.net/api/modelhub/online/v2/crawl',
      apiProtocol: 'openai-responses',
      model: 'gpt-5.5-2026-04-24',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'modelhub-responses',
      apiKey: 'modelhub-secret-value',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    const profile = await syncCcConnectProviderProfile();

    expect(profile).toMatchObject({
      providerId: 'modelhub-responses',
      vendorId: 'custom',
      supported: true,
      model: 'gpt-5.5-2026-04-24',
      env: {
        BYTEDANCE_OPENAI_API_KEY: 'modelhub-secret-value',
        CODEX_MODELHUB_EXTRA_HEADER: '{"session_id":"clawx-cc-connect-modelhub-responses"}',
        CODEX_HOME: join(tempDir, 'runtimes', 'cc-connect', 'codex-home'),
      },
      ccConnectProvider: {
        name: 'modelhub_openapi',
        apiKeyEnvKey: 'BYTEDANCE_OPENAI_API_KEY',
        baseUrl: 'https://aidp.bytedance.net/api/modelhub/online',
        model: 'gpt-5.5-2026-04-24',
        wireApi: 'responses',
      },
    });
    expect(profile.codexArgs).toContain('model_provider="modelhub_openapi"');
    expect(profile.codexArgs).toContain('model_providers.modelhub_openapi.base_url="https://aidp.bytedance.net/api/modelhub/online"');
    expect(profile.codexArgs).toContain('model_providers.modelhub_openapi.env_http_headers={ "Api-Key" = "BYTEDANCE_OPENAI_API_KEY", "extra" = "CODEX_MODELHUB_EXTRA_HEADER" }');

    const codexConfig = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'codex-home', 'config.toml'), 'utf8');
    expect(codexConfig).toContain('model_provider = "modelhub_openapi"');
    expect(codexConfig).toContain('base_url = "https://aidp.bytedance.net/api/modelhub/online"');
    expect(codexConfig).toContain('env_http_headers = { "Api-Key" = "BYTEDANCE_OPENAI_API_KEY", "extra" = "CODEX_MODELHUB_EXTRA_HEADER" }');
    expect(codexConfig).not.toContain('modelhub-secret-value');
    expect(codexConfig).not.toContain('clawx-cc-connect-modelhub-responses');

    const profileFile = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'provider-profile.json'), 'utf8');
    expect(profileFile).toContain('BYTEDANCE_OPENAI_API_KEY');
    expect(profileFile).toContain('CODEX_MODELHUB_EXTRA_HEADER');
    expect(profileFile).not.toContain('modelhub-secret-value');
    expect(profileFile).not.toContain('clawx-cc-connect-modelhub-responses');
  });

  it('marks custom chat completions providers unsupported because Codex only accepts responses wire api', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('custom-chat');
    getProviderAccountMock.mockResolvedValue({
      id: 'custom-chat',
      vendorId: 'custom',
      label: 'Custom Chat',
      authMode: 'api_key',
      baseUrl: 'https://gateway.example/openai',
      apiProtocol: 'openai-completions',
      model: 'gpt-custom',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'custom-chat',
      apiKey: 'custom-secret-value',
    });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    await expect(syncCcConnectProviderProfile()).resolves.toMatchObject({
      providerId: 'custom-chat',
      vendorId: 'custom',
      supported: false,
      unsupportedReason: expect.stringContaining('Chat Completions'),
      codexArgs: [],
    });
  });

  it('marks non-Codex-compatible providers unsupported without mutating OpenClaw', async () => {
    getDefaultProviderAccountIdMock.mockResolvedValue('anthropic-main');
    getProviderAccountMock.mockResolvedValue({
      id: 'anthropic-main',
      vendorId: 'anthropic',
      label: 'Anthropic',
      authMode: 'api_key',
      model: 'claude-opus-4-6',
      enabled: true,
      isDefault: true,
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({ type: 'api_key', accountId: 'anthropic-main', apiKey: 'sk-ant' });
    const { syncCcConnectProviderProfile } = await import('@electron/runtime/cc-connect-provider-profile');

    await expect(syncCcConnectProviderProfile()).resolves.toMatchObject({
      providerId: 'anthropic-main',
      vendorId: 'anthropic',
      supported: false,
      unsupportedReason: expect.stringContaining('not supported yet'),
    });
  });
});
