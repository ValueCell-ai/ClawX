import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const pendingTokenDanceFlows: Array<{
    resolve: (value: { apiKey: string }) => void;
    reject: (reason: Error) => void;
  }> = [];

  return {
    pendingTokenDanceFlows,
    loginTokenDanceOAuth: vi.fn(),
    loginOpenAICodexOAuth: vi.fn(),
    getAccount: vi.fn(),
    createAccount: vi.fn(),
    setDefaultAccount: vi.fn(),
    saveProviderKeyToOpenClaw: vi.fn(),
    setOpenClawDefaultModelWithOverride: vi.fn(),
    ensureOpenClawProviderAgentRuntimePins: vi.fn(),
    shellOpenExternal: vi.fn(),
  };
});

vi.mock('electron', () => ({
  shell: { openExternal: (...args: unknown[]) => mocks.shellOpenExternal(...args) },
}));

vi.mock('@electron/utils/openai-codex-oauth', () => ({
  loginOpenAICodexOAuth: (...args: unknown[]) => mocks.loginOpenAICodexOAuth(...args),
}));

vi.mock('@electron/utils/tokendance-oauth', () => ({
  TOKENDANCE_APP_HEADER: { 'X-App-URL': 'https://clawx.com.cn' },
  TOKENDANCE_DEFAULT_MODEL: 'qwen3.8-max',
  TOKENDANCE_GATEWAY_BASE_URL: 'https://tokendance.space/gateway/v1',
  loginTokenDanceOAuth: (...args: unknown[]) => mocks.loginTokenDanceOAuth(...args),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => ({
    getAccount: (...args: unknown[]) => mocks.getAccount(...args),
    createAccount: (...args: unknown[]) => mocks.createAccount(...args),
    setDefaultAccount: (...args: unknown[]) => mocks.setDefaultAccount(...args),
  }),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getSecretStore: () => ({ set: vi.fn() }),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  OPENAI_CODEX_OAUTH_PROVIDER_CONFIG: {
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-responses',
  },
  saveOAuthTokenToOpenClaw: vi.fn(),
  ensureOpenClawProviderAgentRuntimePins: (...args: unknown[]) => (
    mocks.ensureOpenClawProviderAgentRuntimePins(...args)
  ),
  saveProviderKeyToOpenClaw: (...args: unknown[]) => mocks.saveProviderKeyToOpenClaw(...args),
  setOpenClawDefaultModelWithOverride: (...args: unknown[]) => (
    mocks.setOpenClawDefaultModelWithOverride(...args)
  ),
}));

import { BrowserOAuthManager } from '@electron/utils/browser-oauth';

describe('BrowserOAuthManager TokenDance flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingTokenDanceFlows.length = 0;
    mocks.getAccount.mockResolvedValue(null);
    mocks.createAccount.mockImplementation(async (account) => account);
    mocks.setDefaultAccount.mockResolvedValue(undefined);
    mocks.saveProviderKeyToOpenClaw.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModelWithOverride.mockResolvedValue(undefined);
    mocks.ensureOpenClawProviderAgentRuntimePins.mockResolvedValue([]);
    mocks.loginTokenDanceOAuth.mockImplementation(({ signal }: { signal?: AbortSignal }) => (
      new Promise<{ apiKey: string }>((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('tokendanceOAuth.cancelled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
        mocks.pendingTokenDanceFlows.push({ resolve, reject });
      })
    ));
  });

  it('ignores duplicate starts and persists the default before emitting one success', async () => {
    const manager = new BrowserOAuthManager();
    const successes: unknown[] = [];
    const defaultWritesAtSuccess: number[] = [];
    manager.on('oauth:success', (payload) => {
      successes.push(payload);
      defaultWritesAtSuccess.push(mocks.setDefaultAccount.mock.calls.length);
    });

    await manager.startFlow('tokendance', { accountId: 'tokendance-one', label: 'TokenDance' });
    await manager.startFlow('tokendance', { accountId: 'tokendance-two', label: 'Duplicate' });

    expect(mocks.loginTokenDanceOAuth).toHaveBeenCalledTimes(1);
    mocks.pendingTokenDanceFlows[0].resolve({ apiKey: 'td-secret' });

    await vi.waitFor(() => {
      expect(successes).toEqual([{ provider: 'tokendance', accountId: 'tokendance-one' }]);
    });
    expect(mocks.setDefaultAccount).toHaveBeenCalledWith('tokendance-one');
    expect(defaultWritesAtSuccess).toEqual([1]);
    expect(mocks.saveProviderKeyToOpenClaw).toHaveBeenCalledTimes(1);
    expect(mocks.setOpenClawDefaultModelWithOverride).toHaveBeenCalledTimes(1);
  });

  it('stops TokenDance persistence after cancellation during account creation', async () => {
    const manager = new BrowserOAuthManager();
    const successes: unknown[] = [];
    let resolveAccountCreation: (() => void) | undefined;
    mocks.createAccount.mockImplementationOnce((account) => (
      new Promise((resolve) => {
        resolveAccountCreation = () => resolve(account);
      })
    ));
    manager.on('oauth:success', (payload) => successes.push(payload));

    await manager.startFlow('tokendance', { accountId: 'tokendance-cancelled' });
    mocks.pendingTokenDanceFlows[0].resolve({ apiKey: 'td-cancelled-secret' });
    await vi.waitFor(() => expect(mocks.createAccount).toHaveBeenCalledTimes(1));

    await manager.stopFlow();
    resolveAccountCreation?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.saveProviderKeyToOpenClaw).not.toHaveBeenCalled();
    expect(mocks.setOpenClawDefaultModelWithOverride).not.toHaveBeenCalled();
    expect(mocks.setDefaultAccount).not.toHaveBeenCalled();
    expect(successes).toEqual([]);
  });

  it('does not let cancellation cleanup clear the next flow', async () => {
    const manager = new BrowserOAuthManager();
    const successes: unknown[] = [];
    manager.on('oauth:success', (payload) => successes.push(payload));

    await manager.startFlow('tokendance', { accountId: 'tokendance-old' });
    await manager.stopFlow();
    await manager.startFlow('tokendance', { accountId: 'tokendance-current' });
    await Promise.resolve();

    await manager.startFlow('tokendance', { accountId: 'tokendance-duplicate' });
    expect(mocks.loginTokenDanceOAuth).toHaveBeenCalledTimes(2);

    mocks.pendingTokenDanceFlows[1].resolve({ apiKey: 'td-current-secret' });
    await vi.waitFor(() => {
      expect(successes).toEqual([{ provider: 'tokendance', accountId: 'tokendance-current' }]);
    });
  });
});
