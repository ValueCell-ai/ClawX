import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  getProvider: vi.fn(),
  saveProvider: vi.fn(),
  saveToken: vi.fn(),
  setRuntimeModel: vi.fn(),
}));

vi.mock('@electron/utils/minimax-oauth', () => ({ loginMiniMaxPortalOAuth: mocks.login }));
vi.mock('@electron/utils/secure-storage', () => ({
  getProvider: mocks.getProvider,
  saveProvider: mocks.saveProvider,
}));
vi.mock('@electron/utils/provider-registry', () => ({ getProviderDefaultModel: () => 'default-model' }));
vi.mock('@electron/utils/openclaw-auth', () => ({
  saveOAuthTokenToOpenClaw: mocks.saveToken,
  setOpenClawDefaultModelWithOverride: mocks.setRuntimeModel,
}));

import { deviceOAuthManager } from '@electron/utils/device-oauth';

const credentials = { access: 'fixture-access', refresh: 'fixture-refresh', expires: 1234 };

beforeEach(async () => {
  await deviceOAuthManager.stopFlow();
  vi.resetAllMocks();
});

it('persists the submitted MiniMax model ID for both the account and runtime', async () => {
  mocks.login.mockResolvedValueOnce(credentials);

  await expect(deviceOAuthManager.startFlow('minimax-portal-cn', undefined, {
    accountId: 'minimax-cn-fixture',
    modelId: 'minimax-portal-cn/my-model',
  })).resolves.toBe(true);

  expect(mocks.saveProvider).toHaveBeenCalledWith(expect.objectContaining({
    id: 'minimax-cn-fixture',
    model: 'my-model',
  }));
  expect(mocks.setRuntimeModel).toHaveBeenCalledWith(
    'minimax-portal',
    'minimax-portal/my-model',
    expect.objectContaining({ baseUrl: 'https://api.minimaxi.com/anthropic' }),
  );
});

it('aborts a cancelled device flow and drops credentials returned after the next flow starts', async () => {
  let resolveCancelled!: (token: typeof credentials) => void;
  mocks.login.mockImplementationOnce(() => new Promise(resolve => { resolveCancelled = resolve; }));
  mocks.login.mockResolvedValueOnce(credentials);

  const cancelled = deviceOAuthManager.startFlow('minimax-portal', undefined, {
    accountId: 'cancelled',
    modelId: 'discarded-model',
  });
  const { signal } = mocks.login.mock.calls[0][0] as { signal: AbortSignal };
  await deviceOAuthManager.stopFlow();
  const current = deviceOAuthManager.startFlow('minimax-portal', undefined, {
    accountId: 'current',
    modelId: 'current-model',
  });
  resolveCancelled(credentials);

  expect(signal.aborted).toBe(true);
  await expect(cancelled).resolves.toBe(false);
  await expect(current).resolves.toBe(true);
  expect(mocks.saveProvider).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    id: 'current',
    model: 'current-model',
  }));
});
