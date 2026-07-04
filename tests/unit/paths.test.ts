import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testUserDataDir = '/tmp/clawx-paths-test-user-data';
const testHomeDir = '/tmp/clawx-paths-test-home';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHomeDir,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserDataDir,
    getAppPath: () => '/tmp/clawx-app',
  },
}));

describe('path utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLAWX_USER_DATA_DIR = '/tmp/clawx-override-user-data';
  });

  afterEach(() => {
    delete process.env.CLAWX_USER_DATA_DIR;
  });

  it('prefers CLAWX_USER_DATA_DIR for data dir resolution', async () => {
    const { getDataDir } = await import('@electron/utils/paths');

    expect(getDataDir()).toBe('/tmp/clawx-override-user-data');
  });

  it('keeps OpenClaw config rooted under the isolated home directory', async () => {
    const { getOpenClawConfigDir } = await import('@electron/utils/paths');

    expect(getOpenClawConfigDir()).toBe('/tmp/clawx-paths-test-home/.openclaw');
    expect(getOpenClawConfigDir()).not.toContain('/home/deploy/.openclaw');
  });
});
