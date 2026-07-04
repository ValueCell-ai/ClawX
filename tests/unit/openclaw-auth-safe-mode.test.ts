import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withConfigLockMock } = vi.hoisted(() => ({
  withConfigLockMock: vi.fn(async (task: () => Promise<unknown>) => await task()),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/clawx-openclaw-safe-mode-user-data',
  },
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => '/tmp/clawx-openclaw-safe-mode-home',
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: withConfigLockMock,
}));

vi.mock('@electron/utils/runtime-flags', () => ({
  isOpenClawConfigMutationEnabled: () => false,
}));

describe('openclaw-auth safe mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LAH_SAFE_MODE = '1';
  });

  afterEach(() => {
    delete process.env.LAH_SAFE_MODE;
  });

  it('short-circuits config mutation entry points without locking or writes', async () => {
    const auth = await import('@electron/utils/openclaw-auth');

    await auth.saveOAuthTokenToOpenClaw('openai', {
      access: 'access',
      refresh: 'refresh',
      expires: Date.now() + 1000,
    });

    await auth.batchSyncConfigFields('token');
    await auth.sanitizeOpenClawConfig();

    expect(withConfigLockMock).not.toHaveBeenCalled();
  });
});
