import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loginOpenAICodexOAuthMock = vi.fn();
const loginMiniMaxPortalOAuthMock = vi.fn();

vi.mock('@electron/utils/runtime-flags', () => ({
  isOAuthEnabledByRuntime: () => false,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@electron/utils/openai-codex-oauth', () => ({
  loginOpenAICodexOAuth: loginOpenAICodexOAuthMock,
}));

vi.mock('@electron/utils/minimax-oauth', () => ({
  loginMiniMaxPortalOAuth: loginMiniMaxPortalOAuthMock,
}));

vi.mock('electron', () => ({
  BrowserWindow: class {},
}));

describe('oauth safe mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LAH_SAFE_MODE = '1';
  });

  afterEach(() => {
    delete process.env.LAH_SAFE_MODE;
  });

  it('blocks browser OAuth flows', async () => {
    const { browserOAuthManager } = await import('@electron/utils/browser-oauth');

    await expect(browserOAuthManager.startFlow('openai')).resolves.toBe(false);
    expect(loginOpenAICodexOAuthMock).not.toHaveBeenCalled();
  });

  it('blocks device OAuth flows', async () => {
    const { deviceOAuthManager } = await import('@electron/utils/device-oauth');

    await expect(deviceOAuthManager.startFlow('minimax-portal')).resolves.toBe(false);
    expect(loginMiniMaxPortalOAuthMock).not.toHaveBeenCalled();
  });
});
