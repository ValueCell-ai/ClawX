import { once } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAccountMock,
  getAccountMock,
  loginOpenAICodexOAuthMock,
  secretSetMock,
} = vi.hoisted(() => ({
  createAccountMock: vi.fn(),
  getAccountMock: vi.fn(),
  loginOpenAICodexOAuthMock: vi.fn(),
  secretSetMock: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/utils/openai-codex-oauth', () => ({
  loginOpenAICodexOAuth: (...args: unknown[]) => loginOpenAICodexOAuthMock(...args),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => ({
    createAccount: (...args: unknown[]) => createAccountMock(...args),
    getAccount: (...args: unknown[]) => getAccountMock(...args),
  }),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getSecretStore: () => ({
    set: (...args: unknown[]) => secretSetMock(...args),
  }),
}));

describe('BrowserOAuthManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountMock.mockResolvedValue(null);
    createAccountMock.mockImplementation(async (account) => account);
    loginOpenAICodexOAuthMock.mockResolvedValue({
      access: 'access-token',
      refresh: 'refresh-token',
      idToken: 'id-token',
      expires: 1_800_000_000_000,
      accountId: 'oauth-subject',
      email: 'developer@example.com',
    });
  });

  it('persists canonical credentials and awaits runtime projection before success', async () => {
    const { BrowserOAuthManager } = await import('@electron/utils/browser-oauth');
    const manager = new BrowserOAuthManager();
    const order: string[] = [];
    manager.setSuccessHandler(async (payload) => {
      order.push(`runtime:${payload.accountId}`);
    });
    manager.on('oauth:success', ({ accountId }) => {
      order.push(`event:${accountId}`);
    });

    const completed = once(manager, 'oauth:success');
    await manager.startFlow('openai', {
      accountId: 'openai-oauth',
      label: 'Work account',
    });
    await completed;

    expect(createAccountMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'openai-oauth',
      vendorId: 'openai',
      authMode: 'oauth_browser',
      label: 'Work account',
      model: 'gpt-5.5',
    }));
    expect(secretSetMock).toHaveBeenCalledWith({
      type: 'oauth',
      accountId: 'openai-oauth',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      expiresAt: 1_800_000_000_000,
      email: 'developer@example.com',
      subject: 'oauth-subject',
    });
    expect(order).toEqual([
      'runtime:openai-oauth',
      'event:openai-oauth',
    ]);
  });

  it('emits an error instead of success when runtime projection fails', async () => {
    const { BrowserOAuthManager } = await import('@electron/utils/browser-oauth');
    const manager = new BrowserOAuthManager();
    const success = vi.fn();
    manager.on('oauth:success', success);
    manager.setSuccessHandler(async () => {
      throw new Error('runtime projection failed');
    });

    const failed = once(manager, 'oauth:error');
    await manager.startFlow('openai', { accountId: 'openai-oauth' });
    await expect(failed).resolves.toEqual([{ message: 'runtime projection failed' }]);
    expect(success).not.toHaveBeenCalled();
  });
});
